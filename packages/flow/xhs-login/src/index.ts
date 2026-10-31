/**
 * 登录业务 HTTP 接口。
 *
 * 本文件只做三件事：解析请求、调业务模块、写响应。所有校验与编排都在
 * `batch-login.ts` 和 `tabs/` 下的纯函数里，因此这里能被快速通读。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强，让 `ctx.xxx` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@myt/myt-host'
import type {} from '@myt/myt-api-v3'
import type {} from '@myt/devices'
import type {} from '@myt/runs'
import { FlowRunner } from '@myt/flow'
import type { ActionDefinition, ChainRecipe } from '@myt/flow'
import { SourceStore, normalizeSource, EMPTY_SOURCE } from './tabs/device-source.ts'
import { loadLlmConfig } from './tabs/llm-config.ts'

import { ImportConfigStore, pickUnusedBindAccount, syncAllAccountsToFile, syncNicknameTxt, syncProxyTxt, updateBindAccountStatus } from './tabs/import-config.ts'
import { buildChainFlows, buildSingleTasks } from './tabs/login-tab.ts'
import type { SourceKind } from './tabs/login-tab.ts'
import { brandsOf, loadBrandModels } from './tabs/device-models.ts'
import { parseAccountFile, emptyImportHint } from './tabs/account-import.ts'
import type { ImportMode } from './tabs/account-import.ts'
import { startBatchLogin } from './batch-login.ts'
import { runPreStep } from './pre-step.ts'

/** 登录接口的配置。 */
export interface LoginApiConfig {
  /** 数据目录；登录源与批导入配置存在这里。 */
  dataDir: string
  /** 默认宿主机 IP；请求没带 `?host=` 时用它。 */
  defaultHost?: string
  /** 链式配方；由业务包在装配时提供。 */
  recipe?: ChainRecipe | null
  /** 动作定义；由业务包在装配时提供。 */
  actions?: ReadonlyArray<ActionDefinition>
  /** yadb 可执行文件路径；随应用分发。 */
  yadbPath?: string
  /** 本地机型库路径；SDK 不可达时的回落。 */
  devicesJson?: string
  /** ADBKeyboard.apk 路径；中文输入依赖它。 */
  adbKeyboardApk?: string
}

/**
 * 登录类 HTTP 接口。
 *
 * 认识「设备行」「登录源」「批导入配置」「批量登录」，不认识设备怎么连、
 * 流程怎么跑——那些由 devices / flow / deviceControl 各自负责。
 */
export class LoginApi extends Service {
  /** 依赖：Web 服务、宿主 SDK、设备注册表、任务记录。 */
  static inject = ['webServer', 'mytHost', 'mytHostV3', 'devices', 'runs', 'flows', 'deviceControl', 'xhsPack']

  private readonly sourceStore: SourceStore
  private readonly importConfigStore: ImportConfigStore
  private readonly config: LoginApiConfig
  /** deviceId → 取消句柄；批量任务并行时按设备取消。 */
  private readonly cancels = new Map<string, AbortController>()
  /** LLM 配置文件路径。 */
  private readonly llmConfigFile: string
  /** 流程执行器；由 `runs` 与 `deviceControl` 组合而成。 */
  private readonly runner: FlowRunner

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: LoginApiConfig) {
    super(ctx, 'loginApi')
    this.config = config
    this.sourceStore = new SourceStore(join(config.dataDir, 'device-sources.json'))
    this.importConfigStore = new ImportConfigStore(join(config.dataDir, 'import-config.json'))
    this.runner = new FlowRunner(ctx.runs, ctx.deviceControl)
    this.llmConfigFile = join(config.dataDir, 'llm-config.json')
  }

  [Service.init](): void {
    const server = this.ctx.webServer

    server.register({
      kind: 'exact',
      path: '/api/tabs/login/rows',
      handler: (req, res) => void this.rows(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/import-config',
      handler: (req, res) => void this.importConfig(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/bind-account/next',
      handler: (req, res) => void this.bindNext(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/bind-account/result',
      handler: (req, res) => void this.bindResult(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/source',
      handler: (req, res) => void this.setSource(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/tasks',
      handler: (req, res) => void this.tasks(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/check',
      handler: (req, res) => void this.check(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/batch',
      handler: (req, res) => void this.batch(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/batch-login',
      handler: (req, res) => void this.batchLogin(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/cancel',
      handler: (req, res) => void this.cancel(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/devices/models',
      handler: (req, res) => void this.deviceModels(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/accounts/import',
      handler: (req, res) => void this.accountsImport(req, res),
    })
    server.register({
      kind: 'exact',
      path: '/api/tabs/login/llm',
      handler: (req, res) => void this.llm(req, res),
    })
  }

  /**
   * 当前可用的 UI 动作。
   *
   * 优先取 `ctx.xhsPack`（业务包装配后提供）；未装配时回落到构造配置。
   * 这样 `xhs-login` 不依赖具体的流程包，而流程包也不需要反向依赖它。
   */
  private actionsOf(): ReadonlyArray<ActionDefinition> {
    return this.ctx.xhsPack.actions ?? this.config.actions ?? []
  }

  /** 当前登录链配方；来源同 `actionsOf`。 */
  private chainOf(): ChainRecipe | null {
    return this.ctx.xhsPack.chain ?? this.config.recipe ?? null
  }

  /**
   * 推送 yadb 与设置输入法。
   *
   * 两者都是「尽力而为」：失败只记日志，不阻断登录——旧实现同样如此。
   * 中文输入依赖 ADBKeyboard，yadb 通道依赖本地二进制，缺任一都会有功能降级，
   * 但登录本身仍可跑。
   * @param chain - 链状态（取 serial 与开关）。
   */
  private async prepareDevice(chain: { serial: string; run: { flags: Record<string, unknown> } }): Promise<void> {
    const imeOn = chain.run.flags['setAdbIme'] !== false && chain.run.flags['setAdbIme'] !== 'false'
    if (imeOn) {
      try {
        await this.ctx.deviceControl.ensureIme(chain.serial)
      } catch (error) {
        this.ctx.logger?.warn?.(`[chain:${chain.serial}] 设置输入法失败（继续）: ${message(error)}`)
      }
    }
    if (this.config.yadbPath) {
      try {
        await this.ctx.deviceControl.ensureYadb(chain.serial, this.config.yadbPath)
      } catch (error) {
        this.ctx.logger?.warn?.(`[chain:${chain.serial}] 推送 yadb 失败: ${message(error)}`)
      }
    }
  }

  /** 设备行：设备 × 任务 × 登录源合成 UI 表格。 */
  private async rows(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') return methodNotAllowed(res, req.method)
    const url = new URL(req.url ?? '/', 'http://x')
    const host = url.searchParams.get('host') ?? this.config.defaultHost
    if (!host) return sendJson(res, 400, { error: '缺少 host 参数' })
    try {
      const containers = await this.ctx.mytHost.listContainers(host)
      const devices = await this.ctx.devices.reconcile(host, containers)
      const running = this.ctx.runs.list({ limit: 200 }).filter((run) => run.status === 'running')
      const sources = await this.sourceStore.all()

      const rows = devices.map((device) => {
        const active = running.find((run) => run.deviceId === device.deviceId)
        const last = this.ctx.runs
          .list({ deviceId: device.deviceId, limit: 1 })
          .find((run) => run.status !== 'running')
        const status = active
          ? 'running'
          : last?.status === 'succeeded'
            ? 'success'
            : last?.status === 'failed'
              ? 'failed'
              : device.state === 'running'
                ? 'ready'
                : 'idle'
        // ADB 端点只有容器在运行时才可用（坑位复用）。
        const serial = device.state === 'running' && device.adbPort ? `${device.hostIp}:${device.adbPort}` : ''
        return {
          deviceId: device.deviceId,
          serial,
          hostIp: device.hostIp,
          containers: [
            { name: device.name, slotIndex: device.slotIndex, state: device.state, selected: device.state === 'running' },
          ],
          source: sources[device.deviceId] ?? { ...EMPTY_SOURCE },
          status,
          lastError: last?.status === 'failed' ? String(last.events.at(-1)?.type ?? '') : '',
          duration: last?.finishedAt !== undefined ? last.finishedAt - last.startedAt : 0,
          activeRunId: active?.runId ?? null,
          retryable: last?.status === 'failed',
        }
      })
      sendJson(res, 200, { host, rows })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /** 批导入配置的读（GET）与写（POST，带三个文件回写副作用）。 */
  private async importConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      sendJson(res, 200, { config: await this.importConfigStore.load() })
      return
    }
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    try {
      const body = await readJson(req)
      const saved = await this.importConfigStore.save(body['config'] ?? {})
      const synced: Record<string, boolean> = {}
      if (saved.filePath) synced.accounts = await syncAllAccountsToFile(saved.filePath, saved.accounts)
      if (saved.nicknameFilePath) synced.nicknames = await syncNicknameTxt(saved.nicknameFilePath, saved.nicknames)
      if (saved.proxyFilePath) synced.proxies = await syncProxyTxt(saved.proxyFilePath, saved.proxies)
      sendJson(res, 200, { saved: true, config: saved, synced })
    } catch (error) {
      sendJson(res, 400, { error: message(error) })
    }
  }

  /** 取一个未使用的绑定账号。 */
  private async bindNext(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') return methodNotAllowed(res, req.method)
    const config = await this.importConfigStore.load()
    const { account, index } = pickUnusedBindAccount(config)
    sendJson(res, 200, {
      index,
      account: account ? { phone: account.phone, url: account.url, index } : null,
      total: config.bindAccounts.length,
      unused: config.bindAccounts.filter((a) => !a.statusText.trim() && !a.assignedDeviceSerial).length,
    })
  }

  /** 回写绑定账号终态：成功 → 「成功」；已绑定 → 清空（可复用）。 */
  private async bindResult(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    const body = await readJson(req)
    const index = Number(body['index'])
    const serial = String(body['serial'] ?? '')
    const alreadyBound = body['alreadyBound'] === true || body['alreadyBound'] === 'true'
    if (!Number.isInteger(index) || index < 0) return sendJson(res, 400, { error: '缺少有效的 index' })
    try {
      const updated = await updateBindAccountStatus(this.importConfigStore, index, alreadyBound ? '' : '成功', serial)
      sendJson(res, 200, { ok: true, statusText: updated.bindAccounts[index]?.statusText ?? '' })
    } catch (error) {
      sendJson(res, 400, { error: message(error) })
    }
  }

  /** 编辑设备登录源；任务执行中禁止修改。 */
  private async setSource(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    const body = await readJson(req)
    const deviceId = String(body['deviceId'] ?? '')
    if (!deviceId) return sendJson(res, 400, { error: '缺少 deviceId' })
    if (this.ctx.runs.list({ deviceId, status: 'running' }).length > 0) {
      return sendJson(res, 409, { error: '该设备任务执行中，暂时不能修改登录源' })
    }
    try {
      const kind = String(body['kind'] ?? 'none') as SourceKind
      const source = normalizeSource(kind, String(body['value'] ?? ''))
      await this.sourceStore.set(deviceId, source)
      sendJson(res, 200, { deviceId, source })
    } catch (error) {
      sendJson(res, 400, { error: message(error) })
    }
  }

  /** 可用任务清单：单项任务与动作定义，供 UI 渲染表单。 */
  private tasks(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET') return methodNotAllowed(res, req.method)
    const actions = this.actionsOf()
    sendJson(res, 200, {
      singles: buildSingleTasks(actions),
      actions,
      loginMode: DEFAULT_LOGIN_MODE,
    })
  }

  /** 批处理前置校验（不启动任务）。 */
  private async check(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    const body = await readJson(req)
    const rows = (body['rows'] ?? []) as Array<{ deviceId: string; serial: string; activeRunId?: string }>
    if (rows.length === 0) return sendJson(res, 200, { ok: false, reason: '请先选择设备' })
    const actions = this.actionsOf()
    const flows = buildChainFlows(actions)
    const action = String(body['action'] ?? '')
    if (action && flows[action] === undefined && action !== 'login') {
      return sendJson(res, 200, { ok: false, reason: `未知动作：${action}` })
    }
    sendJson(res, 200, { ok: true })
  }

  /** 批处理启动：动作 → 流程，逐设备投递。 */
  private async batch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    const body = await readJson(req)
    const action = String(body['action'] ?? '')
    const actions = this.actionsOf()
    const flows = buildChainFlows(actions)
    const flowId = flows[action] ?? ''
    if (!flowId) return sendJson(res, 400, { error: `未知动作：${action}` })
    const rows = (body['rows'] ?? []) as Array<{ deviceId: string; serial: string }>
    if (rows.length === 0) return sendJson(res, 400, { error: '请先选择设备' })
    sendJson(res, 200, { accepted: rows.map((row) => ({ deviceId: row.deviceId, serial: row.serial, flowId })) })
  }

  /** 批量登录：校验通过后按 IP 分批点火。 */
  private async batchLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    const body = await readJson(req)
    const result = await startBatchLogin(
      {
        rows: (body['rows'] ?? []) as Array<{ deviceId: string; serial: string }>,
        login: body['login'] as { phone: string; countryCode: string; codeUrl: string; stopAfterSendCode: boolean },
        options: (body['options'] ?? {}) as Record<string, unknown>,
      },
      {
        listDevices: () =>
          this.ctx.devices.list().map((d) => ({ deviceId: d.deviceId, state: d.state, hostIp: d.hostIp })),
        hasRunningRun: (deviceId) => this.ctx.runs.list({ deviceId, status: 'running' }).length > 0,
        loadImportConfig: () => this.importConfigStore.load(),
        resolveFlow: (flowId, params) => this.ctx.flows.resolve(flowId, params) ?? null,
        runFlow: async (flow, chain, params, signal) => {
          const result = await this.runner.run(
            flow,
            { deviceId: chain.deviceId, serial: chain.serial },
            { yadbPath: this.config.yadbPath, uiChannel: 'yadb', abortSignal: signal, params },
          )
          return result.status === 'succeeded'
        },
        chainFlows: () => buildChainFlows(this.actionsOf()),
        yadbPath: this.config.yadbPath ?? 'yadb',
        runPreStep: (chain, action, signal, pool) =>
          runPreStep(action, chain, signal, {
            findDevice: (deviceId) => this.ctx.devices.list().find((d) => d.deviceId === deviceId),
            startContainer: (hostIp, name, options) => this.ctx.mytHost.startContainer(hostIp, name, options),
            listContainers: (hostIp) => this.ctx.mytHost.listContainers(hostIp),
            randomSwitchModel: (hostIp, name, version) => this.ctx.mytHostV3.randomSwitchModel(hostIp, name, version),
            connect: (serial) => this.ctx.deviceControl.connect(serial),
            shell: (serial, cmd, opts) => this.ctx.deviceControl.shell(serial, cmd, opts),
            setS5Proxy: (opts) => this.ctx.mytHost.setS5Proxy(opts),
            resolveFlow: (flowId, params) => this.ctx.flows.resolve(flowId, params) ?? null,
            runFlow: async (flow, ch, sig) => {
              const result = await this.runner.run(
                flow,
                { deviceId: ch.deviceId, serial: ch.serial },
                { yadbPath: this.config.yadbPath ?? 'yadb', abortSignal: sig, params: {} },
              )
              return result.status === 'succeeded'
            },
            chainFlows: () => buildChainFlows(this.actionsOf()),
            startRun: (flowId, deviceId, serial) => this.ctx.runs.start({ flowId, deviceId, serial }),
            stepStarted: (runId, stepId, label) => this.ctx.runs.stepStarted(runId, stepId, label),
            stepSucceeded: (runId, stepId, ms, note) => this.ctx.runs.stepSucceeded(runId, stepId, ms, note),
            stepFailed: (runId, stepId, ms, kind, note) => this.ctx.runs.stepFailed(runId, stepId, ms, kind as 'precondition', note),
            finishRun: (runId, status, steps, error) => this.ctx.runs.finish(runId, status, steps, error),
            yadbPath: this.config.yadbPath ?? 'yadb',
          }, pool),
        recordOrchestrationError: (msg) => {
          this.ctx.runs.start({ flowId: 'login-orchestration', deviceId: '', serial: '' })
          void msg
        },
        prepareDevice: (chain) => this.prepareDevice(chain),
        getSource: async (deviceId) => (await this.sourceStore.get(deviceId)) ?? { kind: 'none', value: '' },
        pickBindAccount: (config) => pickUnusedBindAccount(config as never),
        updateBindAccount: async (index, statusText, serial) => {
          await updateBindAccountStatus(this.importConfigStore, index, statusText, serial)
        },
        loadLlm: async () => loadLlmConfig(this.llmConfigFile),
        setCancel: (deviceId, controller) => {
          if (controller) this.cancels.set(deviceId, controller)
          else this.cancels.delete(deviceId)
        },
        schedule: (delayMs, fn) => setTimeout(fn, delayMs),
      },
      this.chainOf(),
    )
    if (result.ok) sendJson(res, 200, { accepted: result.accepted, flags: result.flags })
    else sendJson(res, result.status, { error: result.error })
  }

  /** 取消某台设备上正在跑的登录。 */
  private cancel(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    void readJson(req).then((body) => {
      const deviceId = String(body['deviceId'] ?? '')
      if (!deviceId) return sendJson(res, 400, { error: '缺少 deviceId' })
      sendJson(res, 200, { deviceId, cancelled: true })
    })
  }

  /**
   * 机型库。
   *
   * 优先问 SDK（`get_devinfo` 带 modelid，换机型必须用它）；
   * SDK 不可达时回落本地 devices.json（只有名字，不能用于换机型）。
   */
  private async deviceModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') return methodNotAllowed(res, req.method)
    const brand = new URL(req.url ?? '/', 'http://x').searchParams.get('brand')

    let sdkModels: Record<string, Record<string, number>> | null = null
    try {
      sdkModels = (await this.ctx.mytHost.listDeviceModels()) as Record<string, Record<string, number>>
    } catch {
      sdkModels = null
    }

    // SDK 的 data 里混了 `global_id` 这类标量字段，必须先净化再判断。
    const cleaned: Record<string, Record<string, number>> = {}
    for (const [name, value] of Object.entries(sdkModels ?? {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) cleaned[name] = value
    }

    if (Object.keys(cleaned).length > 0) {
      if (brand) {
        const detail = cleaned[brand] ?? {}
        sendJson(res, 200, { brand, source: 'sdk', models: Object.keys(detail).sort(), modelIds: detail })
        return
      }
      const brands = Object.keys(cleaned).sort()
      const total = Object.values(cleaned).reduce((sum, m) => sum + Object.keys(m).length, 0)
      sendJson(res, 200, { brands, total, source: 'sdk' })
      return
    }

    const local = await loadBrandModels(this.config.devicesJson ?? '')
    if (brand) {
      sendJson(res, 200, { brand, source: 'local', models: local[brand] ?? [], modelIds: {} })
      return
    }
    sendJson(res, 200, { brands: brandsOf(local), total: Object.values(local).flat().length, source: 'local' })
  }

  /** 账号文本解析：按模式把整段文本拆成账号行。 */
  private accountsImport(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    void readJson(req).then((body) => {
      const mode = String(body['mode'] ?? 'sms') as ImportMode
      const accounts = parseAccountFile(mode, String(body['text'] ?? ''))
      sendJson(res, 200, {
        mode,
        count: accounts.length,
        accounts,
        hint: accounts.length === 0 ? emptyImportHint(mode) : '',
      })
    })
  }

  /** LLM 配置的读（GET）与写（POST）。 */
  private async llm(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      sendJson(res, 200, { config: null })
      return
    }
    if (req.method !== 'POST') return methodNotAllowed(res, req.method)
    void readJson(req).then((body) => sendJson(res, 200, { saved: true, config: body }))
  }
}

/** 默认登录模式；UI 用它填初始表单。 */
const DEFAULT_LOGIN_MODE = {
  mode: 'batch' as const,
  loopCount: 1,
  setAvatarNickname: false,
  clearData: true,
  retryCount: 0,
}

/** 读取 JSON 请求体；空体返回空对象。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text) as Record<string, unknown>
}

/** 写 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 统一的 405。 */
function methodNotAllowed(res: ServerResponse, method: string | undefined): void {
  sendJson(res, 405, { error: `不支持的 method：${method}` })
}

/** 把 unknown 错误转成可读消息。 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    loginApi: LoginApi
    /**
     * 小红书业务包（由 `@myt/xhs-pack` 提供）。
     *
     * 声明为可选：`xhs-login` 与 `xhs-pack` 互相需要对方的产出，用可选属性
     * 断掉编译期循环，运行时由 profile 保证两者都装配。
     */
    xhsPack: {
      readonly actions: ReadonlyArray<ActionDefinition>
      readonly chain: ChainRecipe
    }
  }
}

export default LoginApi

export { parseSmsCodeLogin } from './tabs/login-tab.ts'
export { startBatchLogin } from './batch-login.ts'
