import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { DeviceControl } from '@myt/device';
import { DEFAULT_HUMAN_POLICY, Random, humanClickPoint, nextTapGap, pressDuration, sleep, } from '@myt/human';
const run = promisify(execFile);
/** 与 Python `shlex.quote` 等价的简易引号包裹。 */
function shellQuote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
/** Provider 内部诊断日志；不走业务事件流。 */
function log(message) {
    process.stderr.write(`[device-adb] ${message}\n`);
}
/** yadb 在设备上的路径与输出文件（与 auto_login.py 一致）。 */
const YADB_REMOTE = '/data/local/tmp/yadb';
const DEVICE_TMP = '/data/local/tmp';
/** POSIX 单引号转义（与 Python shlex.quote 等价）。 */
function quote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function remoteParent(path) {
    const idx = path.lastIndexOf('/');
    return idx > 0 ? path.slice(0, idx) : '/';
}
const YADB_DUMP = '/data/local/tmp/yadb_layout_dump.xml';
/** ADBKeyboard 的 IME id（与 auto_login.py 的 ADB_KEYBOARD_IME 一致）。 */
const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME';
/** 解析 `bounds="[x1,y1][x2,y2]"`；格式不符返回 null，由调用方显式失败。 */
function parseBounds(raw) {
    if (!raw)
        return null;
    const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(raw);
    if (!match)
        return null;
    const [, x1, y1, x2, y2] = match;
    return [Number(x1), Number(y1), Number(x2), Number(y2)];
}
/** 解析 uiautomator / yadb 的层级 XML；结构不合法时返回 null（由调用方重试）。 */
export function parseUiXml(xml) {
    const nodes = [];
    const stack = [];
    const tagPattern = /<(\/?)(node)\b([^>]*?)(\/?)>/g;
    let match;
    let root = null;
    while ((match = tagPattern.exec(xml)) !== null) {
        const [, closing, , attrs, selfClosing] = match;
        if (closing === '/') {
            stack.pop();
            continue;
        }
        const attr = (name) => {
            const found = new RegExp(`${name}="([^"]*)"`).exec(attrs ?? '');
            return found?.[1] ?? '';
        };
        // 保留全部原始属性：小红书自用属性（如 NAF）不在标准字段里，但业务判据依赖它。
        const rawAttrs = {};
        const attrPattern = /([\w:-]+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrPattern.exec(attrs ?? '')) !== null) {
            const [, name, value] = attrMatch;
            if (name && value !== undefined)
                rawAttrs[name] = value;
        }
        const bounds = parseBounds(attr('bounds'));
        if (!bounds)
            continue;
        const node = {
            path: [],
            className: attr('class'),
            packageName: attr('package'),
            text: attr('text'),
            contentDesc: attr('content-desc'),
            resourceId: attr('resource-id'),
            clickable: attr('clickable') === 'true',
            enabled: attr('enabled') !== 'false',
            checked: attr('checked') === 'true',
            focused: attr('focused') === 'true',
            selected: attr('selected') === 'true',
            scrollable: attr('scrollable') === 'true',
            longClickable: attr('long-clickable') === 'true',
            isPassword: attr('password') === 'true',
            attrs: rawAttrs,
            bounds,
            children: [],
        };
        const parent = stack[stack.length - 1];
        if (parent) {
            node.path = [...parent.node.path, parent.node.children.length];
            parent.node.children.push(node);
        }
        else {
            node.path = [0];
            if (!root)
                root = node;
        }
        if (selfClosing !== '/')
            stack.push({ node, depth: stack.length + 1 });
        nodes.push(node);
    }
    return root;
}
function walk(node, visit) {
    visit(node);
    for (const child of node.children)
        walk(child, visit);
}
/**
 * ADB 直连 Provider。
 *
 * 只做协议适配；不做重试、不做业务判断。命令失败一律抛错，
 * 由上层步骤决定是否重试（见 shared-steps §9 错误分类）。
 */
export class AdbDeviceControl extends DeviceControl {
    adbPath;
    timeoutMs;
    adbKeyboardApk;
    /** 拟人化：随机源、策略、上次点击时间（对应 `HumanLikeOperator._last_tap_time`）。 */
    random;
    policy;
    lastTapAt = 0;
    constructor(ctx, config = {}) {
        super(ctx);
        this.adbPath = config.adbPath ?? 'adb';
        this.timeoutMs = config.timeoutMs ?? 20_000;
        this.adbKeyboardApk = config.adbKeyboardApk;
        this.random = new Random(config.seed);
        this.policy = config.humanPolicy ?? DEFAULT_HUMAN_POLICY;
    }
    async runShell(serial, args, timeoutMs) {
        const { stdout } = await run(this.adbPath, ['-s', serial, ...args], {
            timeout: timeoutMs ?? this.timeoutMs,
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true,
        });
        return stdout;
    }
    async disconnect(serial) {
        // 旧 `adb_client.disconnect`：失败不抛（设备本来就没连时 adb 会报 not found）。
        await run(this.adbPath, ['disconnect', serial], {
            timeout: this.timeoutMs,
            windowsHide: true,
        }).catch(() => undefined);
    }
    /**
     * 连接 ADB 设备。
     *
     * 与旧 `adb_connect` 一致：**先 disconnect 再 connect**，再随机延迟 1–2s。
     * 断连这步很关键——设备重启/换机型后会残留陈旧 socket，
     * 只 connect 可能连上但状态是 offline。
     */
    async connect(serial) {
        await this.disconnect(serial);
        const { stdout } = await run(this.adbPath, ['connect', serial], {
            timeout: this.timeoutMs,
            windowsHide: true,
        });
        if (/cannot|failed|unable/i.test(stdout))
            throw new Error(`ADB 连接失败：${stdout.trim()}`);
        // 旧 `HumanLikeOperator.random_delay(1, 2)`：给 adbd 一点时间就绪。
        await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
        return stdout.trim();
    }
    async ensureIme(serial) {
        // 移植自 ensure_adb_keyboard（auto_login.py:147-199）。失败不抛错，只记录。
        const listOutput = await this.runShell(serial, ['shell', 'ime', 'list', '-s']);
        if (!listOutput.includes(ADB_KEYBOARD_IME)) {
            if (!this.adbKeyboardApk) {
                log(`设备未安装 ADBKeyboard，且未配置 MYT_ADB_KEYBOARD_APK，跳过输入法设置`);
                return;
            }
            await run(this.adbPath, ['-s', serial, 'push', this.adbKeyboardApk, '/data/local/tmp/ADBKeyboard.apk'], {
                timeout: 60_000,
                windowsHide: true,
            });
            await this.runShell(serial, ['shell', 'pm', 'install', '-r', '-t', '/data/local/tmp/ADBKeyboard.apk'], 60_000);
        }
        await this.runShell(serial, ['shell', 'ime', 'enable', ADB_KEYBOARD_IME]);
        await this.runShell(serial, ['shell', 'ime', 'set', ADB_KEYBOARD_IME]);
        let current = (await this.runShell(serial, ['shell', 'settings', 'get', 'secure', 'default_input_method'])).trim();
        if (current === ADB_KEYBOARD_IME)
            return;
        // —— root 兜底（旧实现 168-197）——
        const enabledOutput = await this.runShell(serial, ['shell', 'settings', 'get', 'secure', 'enabled_input_methods']);
        const ids = enabledOutput.split(':').filter((item) => item.length > 0);
        if (!ids.includes(ADB_KEYBOARD_IME))
            ids.push(ADB_KEYBOARD_IME);
        await this.shellAsRoot(serial, `settings put secure enabled_input_methods ${shellQuote(ids.join(':'))}`);
        const currentPackage = current.split('/')[0] ?? '';
        const adbPackage = ADB_KEYBOARD_IME.split('/')[0] ?? '';
        if (!currentPackage || currentPackage === adbPackage)
            return;
        let switched = '';
        try {
            await this.shellAsRoot(serial, `pm disable-user --user 0 ${shellQuote(currentPackage)}`);
            switched = (await this.runShell(serial, ['shell', 'settings', 'get', 'secure', 'default_input_method'])).trim();
        }
        finally {
            await this.shellAsRoot(serial, `pm enable --user 0 ${shellQuote(currentPackage)}`);
        }
        current = (await this.runShell(serial, ['shell', 'settings', 'get', 'secure', 'default_input_method'])).trim();
        if (!(switched === ADB_KEYBOARD_IME && current === ADB_KEYBOARD_IME)) {
            log(`输入法切换失败，当前=${current || '未知'}，继续登录`);
        }
    }
    /** 以 root 执行 shell 命令（等价 `shell(..., { root: true })`）。 */
    async shellAsRoot(serial, command) {
        return this.shell(serial, command, { root: true });
    }
    async ensureYadb(serial, localPath) {
        // 旧实现每次登录都会 push（幂等，覆盖即可），这里保持一致。
        await run(this.adbPath, ['-s', serial, 'push', localPath, YADB_REMOTE], {
            timeout: 60_000,
            windowsHide: true,
        });
        await this.runShell(serial, ['shell', 'chmod', '755', YADB_REMOTE]);
    }
    async dumpViaYadb(serial) {
        // 与 auto_login.adb_ui_yadb 完全一致的调用方式。
        await this.runShell(serial, [
            'shell',
            `app_process -Djava.class.path=${YADB_REMOTE} /data/local/tmp com.ysbing.yadb.Main -layout ${YADB_DUMP}`,
        ], 60_000);
        return this.runShell(serial, ['shell', 'cat', YADB_DUMP], 60_000);
    }
    async dumpUi(serial, options = {}) {
        const channel = options.channel ?? 'uiautomator';
        // 空内容重试 3 次后仍失败即抛错（不返回空树）。
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const xml = channel === 'yadb'
                ? await this.dumpViaYadb(serial)
                : await (async () => {
                    await this.runShell(serial, ['shell', 'uiautomator', 'dump', '/sdcard/myt_ui.xml']);
                    return this.runShell(serial, ['shell', 'cat', '/sdcard/myt_ui.xml']);
                })();
            const root = parseUiXml(xml);
            if (root) {
                let nodeCount = 0;
                walk(root, () => {
                    nodeCount += 1;
                });
                return { serial, channel, capturedAt: Date.now(), root, nodeCount };
            }
        }
        throw new Error(`UI dump 为空：${serial}（channel=${channel}）`);
    }
    async tap(serial, x, y, options = {}) {
        const jitter = options.jitterPx ?? 0;
        const offsetX = jitter > 0 ? Math.round((Math.random() * 2 - 1) * jitter) : 0;
        const offsetY = jitter > 0 ? Math.round((Math.random() * 2 - 1) * jitter) : 0;
        await this.runShell(serial, ['shell', 'input', 'tap', String(x + offsetX), String(y + offsetY)]);
    }
    async tapLikeHuman(serial, x, y, options = {}) {
        // 移植自 tap_with_human_like（auto_login.py:704-746），行为必须逐项一致：
        // 1) 点击前三档等待  2) rightBoundary-20  3) 高斯偏移 + bounds 内缩 3px
        // 4) 按压 70/20/10 加权  5) 微移 uniform(-2,2)  6) 用 swipe 而非 tap
        const gap = nextTapGap(this.random, this.policy, Date.now() - this.lastTapAt);
        await sleep(gap);
        const clickX = options.rightBoundary !== undefined ? options.rightBoundary - 20 : x;
        const point = humanClickPoint(this.random, this.policy, { x: clickX, y }, options.bounds);
        const press = pressDuration(this.random, this.policy);
        const microX = this.random.int(-2, 2);
        const microY = this.random.int(-2, 2);
        await this.runShell(serial, [
            'shell',
            'input',
            'swipe',
            String(point.x),
            String(point.y),
            String(point.x + microX),
            String(point.y + microY),
            String(press),
        ]);
        this.lastTapAt = Date.now();
    }
    async swipe(serial, from, to, durationMs = 300) {
        await this.runShell(serial, [
            'shell',
            'input',
            'swipe',
            String(from.x),
            String(from.y),
            String(to.x),
            String(to.y),
            String(durationMs),
        ]);
    }
    async typeText(serial, text) {
        // 纯 ASCII（手机号、英文）走 `input text`：同步、有序，与旧实现的
        // `simulate_typing` 一致。中文/表情必须用 ADBKeyboard 广播（input text 不支持）。
        if (/^[\x20-\x7e]+$/.test(text)) {
            // 特殊字符需转义，避免被 shell 解释。
            const escaped = text.replace(/([\\"'`$&|;<>()[\]{}*?~!#])/g, '\\$1').replace(/ /g, '%s');
            await this.runShell(serial, ['shell', 'input', 'text', escaped]);
            return;
        }
        // 广播是异步的，连续调用会乱序；由调用方保证串行并留出间隔。
        await this.runShell(serial, [
            'shell',
            'am',
            'broadcast',
            '-a',
            'ADB_INPUT_TEXT',
            '--es',
            'msg',
            text,
        ]);
    }
    async back(serial) {
        await this.runShell(serial, ['shell', 'input', 'keyevent', '4']);
    }
    async pressKey(serial, key) {
        await this.runShell(serial, ['shell', 'input', 'keyevent', key]);
    }
    async shell(serial, command, options = {}) {
        // root 命令必须整体加引号：`su -c pm clear x` 会被拆成 `su -c pm` + `clear x`。
        // 旧实现用 adb_client 的 root=True 封装，同样是一次性字符串传递。
        const args = options.root
            ? ['shell', `su -c ${shellQuote(command)}`]
            : ['shell', command];
        try {
            const { stdout } = await run(this.adbPath, ['-s', serial, ...args], {
                timeout: options.timeoutMs ?? this.timeoutMs,
                maxBuffer: 32 * 1024 * 1024,
                windowsHide: true,
            });
            return stdout;
        }
        catch (error) {
            if (options.check === false)
                return '';
            throw error;
        }
    }
    async pullPrivateFile(serial, remotePath) {
        // 旧实现 `pull_private_file`：先拷到 /data/local/tmp（root 可写），再普通 pull。
        const tmp = `/data/local/tmp/myt_pull_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        try {
            const copied = await this.shell(serial, `cp "${remotePath}" ${tmp} && chmod 644 ${tmp}`, {
                root: true,
                check: false,
                timeoutMs: 30_000,
            });
            void copied;
            // 先确认文件确实存在，避免 pull 报错被当成空文件。
            const stat = await this.shell(serial, `stat -c %s ${tmp}`, { check: false, timeoutMs: 10_000 });
            if (!/^\d+$/.test(stat.trim()))
                return null;
            const { stdout } = await run(this.adbPath, ['-s', serial, 'exec-out', `cat ${tmp}`], {
                timeout: 60_000,
                encoding: 'buffer',
                maxBuffer: 64 * 1024 * 1024,
                windowsHide: true,
            });
            return { size: stdout.length, content: stdout };
        }
        catch {
            return null;
        }
        finally {
            // 旧实现在 tmp 里也做清理；失败不影响主流程。
            await this.shell(serial, `rm -f ${tmp}`, { root: true, check: false, timeoutMs: 5000 });
        }
    }
    async pushPrivateFile(serial, localPath, remotePath, options = {}) {
        // 移植自 AdbDevice.push_private_file：tmp 中转，避免 App 目录权限/属主被 push 破坏。
        const tmp = `${DEVICE_TMP}/myt_state_${process.pid}_${basename(localPath)}`;
        try {
            await run(this.adbPath, ['-s', serial, 'push', localPath, tmp], {
                timeout: 60_000,
                windowsHide: true,
            });
            await this.shell(serial, `mkdir -p ${quote(remoteParent(remotePath))}`, { root: true });
            if (options.ownerUid) {
                const owner = `${options.ownerUid}:${options.ownerUid}`;
                await this.shell(serial, `chown ${owner} ${quote(remoteParent(remotePath))}`, {
                    root: true,
                    check: false,
                });
            }
            await this.shell(serial, `cp ${quote(tmp)} ${quote(remotePath)}`, { root: true });
            if (options.ownerUid) {
                const owner = `${options.ownerUid}:${options.ownerUid}`;
                await this.shell(serial, `chown ${owner} ${quote(remotePath)}`, { root: true });
            }
            await this.shell(serial, `chmod ${options.mode ?? '600'} ${quote(remotePath)}`, { root: true });
        }
        finally {
            await this.shell(serial, `rm -f ${quote(tmp)}`, { root: true, check: false });
        }
    }
    async readRemoteFile(serial, remotePath) {
        // 用 base64 过 adb 管道：MMKV 是二进制，直接 cat 会被换行/编码破坏。
        const encoded = await this.shell(serial, `base64 -w0 ${quote(remotePath)}`, {
            root: true,
            check: false,
        });
        const cleaned = encoded.replace(/\s+/g, '');
        if (!cleaned || cleaned.includes('No such file'))
            return null;
        try {
            return Buffer.from(cleaned, 'base64');
        }
        catch {
            return null;
        }
    }
    async appUid(serial, pkg) {
        const out = await this.shell(serial, `stat -c %u /data/data/${pkg}`, {
            root: true,
            check: false,
        });
        const uid = out.trim();
        return /^\d+$/.test(uid) ? uid : null;
    }
    async pushToGallery(serial, localPath, targetDir = '') {
        // 移植自 upload_img.upload_image_to_gallery：目录优先级 + MediaStore 注册。
        const fileName = basename(localPath);
        const candidates = targetDir
            ? [targetDir]
            : ['/sdcard/Download', '/sdcard/DCIM/Camera', '/sdcard/Pictures', '/sdcard/DCIM'];
        let chosen = candidates[0] ?? '/sdcard/Download';
        for (const dir of candidates) {
            const out = await this.shell(serial, `test -d ${dir} && echo yes`, { check: false });
            if (out.includes('yes')) {
                chosen = dir;
                break;
            }
        }
        const devicePath = `${chosen.replace(/\/+$/, '')}/${fileName}`;
        await run(this.adbPath, ['-s', serial, 'push', localPath, devicePath], {
            timeout: 60_000,
            windowsHide: true,
        });
        const lower = fileName.toLowerCase();
        const isVideo = /\.(mp4|mkv|avi|mov|webm|3gp)$/.test(lower);
        const mime = isVideo
            ? 'video/mp4'
            : lower.endsWith('.png')
                ? 'image/png'
                : lower.endsWith('.gif')
                    ? 'image/gif'
                    : lower.endsWith('.webp')
                        ? 'image/webp'
                        : 'image/jpeg';
        const uri = `content://media/external/${isVideo ? 'video' : 'images'}/media`;
        const mediaPath = devicePath.replace('/sdcard/', '/storage/emulated/0/');
        const now = Math.floor(Date.now() / 1000);
        const registered = await this.shell(serial, `content insert --uri ${uri} ` +
            `--bind _display_name:s:'${fileName}' ` +
            `--bind _data:s:'${mediaPath}' ` +
            `--bind mime_type:s:${mime} ` +
            `--bind date_modified:i:${now} ` +
            `--bind is_pending:i:0`, { check: false });
        if (!registered || registered.includes('Error')) {
            // 旧实现的回落：广播扫描整个目录。
            await this.shell(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${chosen}`, { check: false });
        }
        return devicePath;
    }
    async pushImagesToGallery(serial, localPaths, targetDir = '') {
        // 旧 `upload_images_to_gallery`：逐张上传，失败的跳过。
        const results = [];
        for (const path of localPaths) {
            try {
                const devicePath = await this.pushToGallery(serial, path, targetDir);
                if (devicePath)
                    results.push(devicePath);
            }
            catch {
                // 单张失败不影响其余（旧版同样不中断）。
            }
        }
        return results;
    }
    async screenshot(serial) {
        const { stdout } = await run(this.adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: this.timeoutMs, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
        return stdout;
    }
    async openUri(serial, uri, pkg = 'com.xingin.xhs') {
        // 不指定 `-n`：让系统按 deeplink 路由到正确的 Activity。
        //
        // 旧实现写死 `-n pkg/com.xingin.xhs.routers.RouterPageActivity`，
        // 对 `xhsdiscover://profile` 有效，但 `xhsdiscover://post_note/` 会被这个
        // 强制指定的 Activity 拦截、页面根本不跳转（实测停在首页）。
        // 去掉 `-n` 后两种深链都能正常路由。
        await this.runShell(serial, [
            'shell',
            'am',
            'start',
            '-a',
            'android.intent.action.VIEW',
            '-d',
            uri,
            pkg,
        ]);
    }
    async forceStop(serial, pkg) {
        await this.runShell(serial, ['shell', 'am', 'force-stop', pkg]);
    }
    async launchApp(serial, pkg) {
        // 与旧实现一致：用 monkey 拉起启动 Activity，不依赖具体 Activity 名。
        await this.runShell(serial, [
            'shell',
            'monkey',
            '-p',
            pkg,
            '-c',
            'android.intent.category.LAUNCHER',
            '1',
        ]);
    }
}
/** Cordis Loader 按包名导入时要求默认导出。 */
export default AdbDeviceControl;
//# sourceMappingURL=index.js.map