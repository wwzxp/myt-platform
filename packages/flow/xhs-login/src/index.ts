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

import { ImportConfigStore, pickUnusedBindAccount, syncAllAccountsToFile, syncNicknameTxt, syncProxyTxt, updateBindAccountStatus } from './tabs/import-config.ts'
import { buildChainFlows, buildSingleTasks } from './tabs/login-tab.ts'
import type { SourceKind } from './tabs/login-tab.ts'
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
}

/**
 * 登录类 HTTP 接口。
 *
 * 认识「设备行」「登录源」「批导入配置」「批量登录」，不认识设备怎么连、
 * 流程怎么跑——那些由 devices / flow / deviceControl 各自负责。
 */
export class LoginApi extends Service {
  /** 依赖：Web 服务、宿主 SDK、设备注册表、任务记录。 */
  static inject = ['webServer', 'mytHost', 'mytHostV3', 'devices', 'runs', 'flows', 'deviceControl']

  private readonly sourceStore: SourceStore
  private readonly importConfigStore: ImportConfigStore
  private readonly config: LoginApiConfig
  /** 流程执行器；由 `runs` 与 `deviceControl` 组合而成。 */
  private readonly runner: FlowRunner

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: LoginApiConfig) {
    super(ctx, 'loginApi')
    this.config = config
    this.sourceStore = new SourceStore(join(config.dataDir, 'device-sources.json'))
    this.importConfigStore = new ImportConfigStore(join(config.dataDir, 'import-config.json'))
    this.runner = new FlowRunner(ctx.runs, ctx.deviceControl)
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
      path: '/api/tabs/login/llm',
      handler: (req, res) => void this.llm(req, res),
    })
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
    const actions = this.config.actions ?? []
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
    const actions = this.config.actions ?? []
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
    const actions = this.config.actions ?? []
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
        chainFlows: () => buildChainFlows(this.config.actions ?? []),
        yadbPath: this.config.yadbPath ?? 'yadb',
        runPreStep: (chain, action, signal) =>
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
            chainFlows: () => buildChainFlows(this.config.actions ?? []),
            startRun: (flowId, deviceId, serial) => this.ctx.runs.start({ flowId, deviceId, serial }),
            stepStarted: (runId, stepId, label) => this.ctx.runs.stepStarted(runId, stepId, label),
            stepSucceeded: (runId, stepId, ms, note) => this.ctx.runs.stepSucceeded(runId, stepId, ms, note),
            stepFailed: (runId, stepId, ms, kind, note) => this.ctx.runs.stepFailed(runId, stepId, ms, kind as 'precondition', note),
            finishRun: (runId, status, steps, error) => this.ctx.runs.finish(runId, status, steps, error),
            proxyPool: null,
            yadbPath: this.config.yadbPath ?? 'yadb',
          }),
        recordOrchestrationError: (msg) => {
          this.ctx.runs.start({ flowId: 'login-orchestration', deviceId: '', serial: '' })
          void msg
        },
        proxyPool: null,
        schedule: (delayMs, fn) => setTimeout(fn, delayMs),
      },
      this.config.recipe ?? null,
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
  }
}

export default LoginApi
