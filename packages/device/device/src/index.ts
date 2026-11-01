import { Service } from '@deepseek-ai/cordis'

/** UI 节点（uiautomator dump 的收敛形态，只保留流程需要的字段）。 */
export interface UiNode {
  /** 层级路径，如 `[0,1,2]`；仅用于 fallback，命名策略优先。 */
  path: number[]
  className: string
  /** 所属应用包名（旧 UI XML 的 `package` 属性；`_first_package_name` 依赖它）。 */
  packageName: string
  text: string
  contentDesc: string
  resourceId: string
  clickable: boolean
  enabled: boolean
  /** 复选框/开关的选中态；非可选控件为 false。 */
  checked: boolean
  /** 输入框是否处于聚焦状态（`get_focused_input_content` 依赖它）。 */
  focused: boolean
  /** 节点是否被选中（安全验证网格判定依赖它）。 */
  selected: boolean
  /** 是否可滚动（区域分类与滚动容器识别依赖它）。 */
  scrollable: boolean
  /** 是否可长按。 */
  longClickable: boolean
  /** 是否密码输入框（避免把密码值写进事件日志）。 */
  isPassword: boolean
  /**
   * 节点的全部原始 XML 属性。
   *
   * 小红书自用属性（如 `NAF`）不在标准字段里，但图库页判定依赖它，
   * 必须原样保留才能与旧实现一致。
   */
  attrs: Record<string, string>
  /** 屏幕坐标 [x1, y1, x2, y2]。 */
  bounds: [number, number, number, number]
  children: UiNode[]
}

/** 一次 UI 抓取的结果。 */
export interface UiSnapshot {
  serial: string
  /** 抓取通道：uiautomator 或 yadb，流程里必须显式记录（shared-steps §3）。 */
  channel: 'uiautomator' | 'yadb'
  capturedAt: number
  root: UiNode
  /** 节点总数，用于快速判断 dump 是否有效。 */
  nodeCount: number
}

export interface TapOptions {
  /** 高斯抖动半径（像素）；0 表示精确点击。 */
  jitterPx?: number
}

/**
 * 设备能力接缝：一台已连接的安卓设备（对应平台 `DeviceId`，不是坑位端点）。
 *
 * 消费方（步骤原语、流程）只依赖本接口；ADB 直连、relay、未来的云手机 SDK
 * 都是不同 Provider（见 ADR-0001 D2）。
 */
export abstract class DeviceControl extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'deviceControl')
  }

  /** 抓取当前界面。失败必须抛错，不允许返回空树冒充成功。 */
  abstract dumpUi(serial: string, options?: { channel?: 'uiautomator' | 'yadb' }): Promise<UiSnapshot>

  /** 推送 yadb 到设备（首次运行需要）。 */
  abstract ensureYadb(serial: string, localPath: string): Promise<void>

  /**
   * 尽力启用 ADBKeyboard（安装/启用/set）。
   * 失败应抛错；调用方可选择不阻断流程（旧实现如此）。
   */
  abstract ensureIme(serial: string): Promise<void>

  /** 建立 ADB 连接（`adb connect`）；返回命令输出便于诊断。 */
  abstract connect(serial: string): Promise<string>

  /**
   * 断开 ADB 连接（旧 `adb_disconnect`）。
   *
   * 旧 `adb_connect` 是「先 disconnect 再 connect」，用于清掉坏连接；
   * 缺了这步在设备重启/换机型后可能连到陈旧 socket。
   */
  abstract disconnect(serial: string): Promise<void>

  abstract tap(serial: string, x: number, y: number, options?: TapOptions): Promise<void>

  /**
   * 拟人点击：同点位的短距离 swipe（按住 40–350ms）。
   *
   * 必须用于小红书的自定义控件：实测 `input tap`（瞬间按下抬起）对协议勾选框
   * 等控件无效，而旧项目验证过的 swipe 方式有效（见 human 包注释）。
   */
  abstract tapLikeHuman(
    serial: string,
    x: number,
    y: number,
    options?: { bounds?: [number, number, number, number]; rightBoundary?: number },
  ): Promise<void>

  abstract swipe(
    serial: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<void>

  /** 输入文本（中文需要 ADBKeyboard；Provider 负责前置检查）。 */
  abstract typeText(serial: string, text: string): Promise<void>

  abstract back(serial: string): Promise<void>

  /** 发送按键事件，如 `KEYCODE_DEL`（清空输入框依赖它）。 */
  abstract pressKey(serial: string, key: string): Promise<void>

  /**
   * 执行 shell 命令。
   *
   * `root=true` 走 `su -c`；`check=false` 时忽略非零退出码（旧实现的容错调用）。
   */
  abstract shell(
    serial: string,
    command: string,
    options?: { root?: boolean; check?: boolean; timeoutMs?: number },
  ): Promise<string>

  /**
   * 直接执行 adb 子命令（`adb -s <serial> <args…>`），返回 stdout。
   *
   * 供画布上的「设备命令」动作使用：`shell` 只能跑 `adb shell`，
   * 覆盖不到 `push` / `install` / `pull` 这类子命令。
   * **不做命令白名单**——调用方（画布配置者）自负后果。
   */
  abstract adb(serial: string, args: readonly string[]): Promise<string>

  /**
   * 拉取受保护路径下的文件（/data/data 需要 root）。
   *
   * 返回 `{ size }` 表示成功；文件不存在或不可读返回 null（旧实现记 `present=false`）。
   */
  abstract pullPrivateFile(serial: string, remotePath: string): Promise<{ size: number; content: Buffer } | null>

  /**
   * 推送文件到 App 私有目录（旧 `AdbDevice.push_private_file`）。
   *
   * 顺序：push 到 /data/local/tmp → cp 到目标 → chown → chmod → 清临时文件。
   * `ownerUid` 缺失时保留原属主（仅 chmod）。需要 root。
   */
  abstract pushPrivateFile(
    serial: string,
    localPath: string,
    remotePath: string,
    options?: { ownerUid?: string | undefined; mode?: string | undefined },
  ): Promise<void>

  /**
   * 读取设备上任意路径的文件（root）。用于解析 MMKV / 提取 SID。
   *
   * 与 `pullPrivateFile` 的区别：此方法返回完整 Buffer 且不关心存在性语义。
   */
  abstract readRemoteFile(serial: string, remotePath: string): Promise<Buffer | null>

  /** App 的 uid（旧 `get_xhs_uid`：`stat -c %u /data/data/<pkg>`）。 */
  abstract appUid(serial: string, pkg: string): Promise<string | null>

  /**
   * 推送本地图片到设备相册并注册媒体库（旧 `upload_image_to_gallery`）。
   *
   * 顺序：push 到 /sdcard/Download → MediaStore `content insert` 注册；
   * 注册失败时回落到 MEDIA_SCANNER_SCAN_FILE 广播。返回设备端路径。
   */
  abstract pushToGallery(serial: string, localPath: string, targetDir?: string): Promise<string>

  /**
   * 批量推送图片到相册（旧 `upload_images_to_gallery`）。
   *
   * 逐张调用 `pushToGallery`，失败的跳过（旧版同样只收集成功项）。
   *
   * @returns 成功上传的设备端路径（顺序与输入一致）
   */
  abstract pushImagesToGallery(
    serial: string,
    localPaths: string[],
    targetDir?: string,
  ): Promise<string[]>

  /** 截图，返回 PNG 字节。 */
  abstract screenshot(serial: string): Promise<Buffer>

  /** 通过 deep link 打开应用内页面。 */
  abstract openUri(serial: string, uri: string, pkg?: string): Promise<void>

  /** 直接拉起应用（旧实现的 `launch_one_click_authorization_app` 等）。 */
  abstract launchApp(serial: string, pkg: string): Promise<void>

  abstract forceStop(serial: string, pkg: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    deviceControl: DeviceControl
  }
}
