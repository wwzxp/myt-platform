import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { DeviceRegistry } from '@myt/devices'
import { AdbDeviceControl } from '@myt/device-adb'
import { FlowRegistry, FlowRunner, createStepContext } from '@myt/flow'
import { xhsPack } from '@myt/flow-xhs/pack'
import { xhsPublishPack } from '@myt/flow-xhs-publish/pack'
import { xhsDevicePack } from '@myt/flow-xhs-device/pack'
import { FlowTaskRunner } from './flow-task.ts'
import { loadLlmConfig, saveLlmConfig, solveSafetyVerification } from './tabs/llm-config.ts'
import { emptyImportHint, parseAccountFile, type ImportMode } from './tabs/account-import.ts'
import { SourceStore, normalizeSource, EMPTY_SOURCE } from './tabs/device-source.ts'
import { brandsOf, loadBrandModels } from './tabs/device-models.ts'
import {
  ImportConfigStore,
  pickUnusedBindAccount,
  syncAllAccountsToFile,
  syncNicknameTxt,
  syncProxyTxt,
  updateBindAccountStatus,
} from './tabs/import-config.ts'
import { hostIpOf, planIpBatches, waitForStableAdb } from './tabs/job-scheduler.ts'
import { ProxyPool, requiredProxyCount } from './tabs/proxy-pool.ts'
import {
  actionLabel,
  advanceChain,
  beginChain,
  type ChainRun,
  type ChainState,
  type ChainStep,
} from './tabs/login-chain.ts'
import { HeroSmsClient, loginWithHeroSms } from '@myt/flow-xhs'
import { MytApiV2 } from '@myt/myt-api-v2'
import { MytApiV3, parseAndroidVersion } from '@myt/myt-api-v3'
import { RunStore } from '@myt/runs'
import {
  DEFAULT_LOGIN_MODE,
  buildActionFlows,
  buildChainFlows,
  buildSingleTasks,
  checkBatchAction,
  parseSmsCodeLogin,
  type BatchAction,
  type DeviceRow,
  type LoginModeOptions,
  type RowStatus,
  type SourceKind,
} from './tabs/login-tab.ts'

export interface KernelOptions {
  /** 监听端口；壳会先探测可用端口再传入。 */
  port: number
  /** 监听地址；默认仅本机。 */
  host?: string
  /** MYT SDK 网关基址。 */
  sdkBase?: string
  /** 宿主 IP 列表。 */
  hosts: string[]
  /** 设备状态文件路径。 */
  stateFile: string
  /** 大模型配置文件路径（与设备状态分开，避免互相覆盖）。 */
  llmConfigFile?: string
  /** 机型库 JSON 路径（旧 `static/devices.json`）；缺省时新机配置不可用。 */
  devicesJson?: string
  /** 前端静态目录；缺省时只提供 API。 */
  uiDir?: string
  /** adb 可执行文件路径；缺省取 PATH。 */
  adbPath?: string
  /** yadb 本地文件路径；缺省取仓库内 apk/yadb。 */
  yadbPath?: string
  /** ADBKeyboard.apk 本地路径；设备未安装输入法时使用。 */
  adbKeyboardApk?: string
  /** HeroSMS 客户端；提供后可用 `activationId` 参数走 HeroSMS 取码。 */
  heroSmsClient?: {
    getStatus: (activationId: string) => Promise<{ status: string; code?: string }>
  }
  /** 拟人化随机种子（调试用）。 */
  seed?: number
  /** 就绪回调：HTTP 已在监听。 */
  onReady?: (info: { port: number; host: string }) => void
}


export interface KernelHandle {
  port: number
  close: () => Promise<void>
}

/** 可注入的等待；测试里可替换，生产走真实定时器。 */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...CORS_HEADERS,
  })
  res.end(JSON.stringify(body))
}

/**
 * 跨域头。
 *
 * 开发期前端跑在 `127.0.0.1:3000`（rsbuild dev server），内核对端在 `:7788`，
 * 属跨域。缺这些头时浏览器直接拦截，前端只会显示 "Internal Server Error"，
 * 而内核日志里连请求都看不到（实测踩过——排查了很久才定位到是 CORS 而非业务错误）。
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
} as const

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

/**
 * 启动内核。
 *
 * 变更类接口只调用一次、随后回查状态；超时返回真实状态而不是假装成功
 * （见 STYLE.md §5 与 docs/spec/runtime-and-storage.md）。
 */
export async function startKernel(options: KernelOptions): Promise<KernelHandle> {
  const listenHost = options.host ?? '127.0.0.1'
  // 默认与设备状态同目录，但**独立文件**：devices.json 是数组，不能混写对象。
  const llmConfigFile = options.llmConfigFile ?? join(dirname(options.stateFile), 'llm-config.json')
  /** 登录源（旧版存内存，这里落盘）。 */
  const sourceStore = new SourceStore(join(dirname(options.stateFile), 'device-sources.json'))
  /** 批导入账号配置（旧 `AccountImportDialog.values()`，本版落盘）。 */
  const importConfigStore = new ImportConfigStore(
    join(dirname(options.stateFile), 'import-config.json'),
  )
  const sdkBase = options.sdkBase ?? 'http://127.0.0.1:7878'
  const hosts = options.hosts

  const ctx = new Context()
  await ctx.plugin(MytApiV2, { baseUrl: sdkBase })
  // v3 客户端：宿主机 8000 端口。当前环境可能没有 v3 宿主，
  // 注册后由能力探测决定是否可用（不在启动时探活，避免拖慢启动）。
  await ctx.plugin(MytApiV3, {})
  await ctx.plugin(DeviceRegistry, { stateFile: options.stateFile })
  await ctx.plugin(AdbDeviceControl, {
    adbPath: options.adbPath,
    adbKeyboardApk: options.adbKeyboardApk,
  })
  await ctx.plugin(RunStore, {})
  await ctx.plugin(FlowRegistry)
  // 业务包：内核只 load 包，不认识任何具体流程 id。
  xhsDevicePack.register(ctx.flows, {})
  xhsPack.register(ctx.flows, {
    // 识图：内核知道 LLM 配置来源，包只管传图。
    solveSafety: async (image: Buffer, params: Record<string, string>) => {
      const llm = await loadLlmConfig(llmConfigFile)
      return solveSafetyVerification(
        { baseUrl: String(params['llmBaseUrl'] || llm.baseUrl), model: String(params['llmModel'] || llm.model), apiKey: String(params['llmApiKey'] || llm.apiKey) },
        image,
      )
    },
    host: {
      setS5Proxy: (options: Parameters<typeof ctx.mytHost.setS5Proxy>[0]) => ctx.mytHost.setS5Proxy(options),
    },
  })

  // 发布包：与上号包完全解耦，只注册流程（不暴露 UI 动作）。
  xhsPublishPack.register(ctx.flows, {})

  // 动作表由业务包汇总；内核不持有任何具体动作 id。
  const actions = [...(xhsDevicePack.actions ?? []), ...(xhsPack.actions ?? [])]
  const actionFlows = buildActionFlows(actions)
  // 链动作映射同样来自业务包；未声明的链动作保持空串（内核直接执行或跳过）。
  const chainFlows = buildChainFlows(actions)
  // 链配方：内核只按配方跑，不认识具体动作。
  const chainRecipe = xhsPack.chain
  const singleTasks = buildSingleTasks(actions)

  const runner = new FlowRunner(ctx.runs, ctx.deviceControl)

  /**
   * 流程图任务调度：实现 flowgram 前端的 5 个运行时接口。
   *
   * 前端 `runtime-plugin` 切 `mode:'server'` 后调的就是这里。
   * 用 `createStepContext` 与步骤引擎共用上下文构造——两套引擎必须看到一致的 `ctx`。
   */
  /**
   * 流程库：`data/flows/*.json` 的业务配置（app / maxSteps）。
   *
   * 画布上的 schema 只有 `{nodes, edges}`，这些业务知识由内核对端补。
   * 启动时一次性读入，`validate` 是同步接口，不能临时读盘。
   */
  const flowDefaults = new Map<string, { app: unknown; maxSteps: number }>()
  /** 流程 id → 节点 id 集合，供画布反查。 */
  const flowNodeIds = new Map<string, Set<string>>()
  {
    const flowsDir = fileURLToPath(new URL('../../../../data/flows/', import.meta.url))
    const { readdirSync, readFileSync } = await import('node:fs')
    try {
      for (const file of readdirSync(flowsDir)) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(flowsDir, file), 'utf8')) as {
            id?: string
            nodes?: Array<{ id?: string }>
            data?: { app?: unknown; maxSteps?: number }
          }
          if (raw.id && raw.data?.app !== undefined) {
            flowDefaults.set(raw.id, { app: raw.data.app, maxSteps: raw.data.maxSteps ?? 200 })
            flowNodeIds.set(
              raw.id,
              new Set((raw.nodes ?? []).map((node) => node.id).filter((id): id is string => typeof id === 'string')),
            )
          }
        } catch {
          // 单个文件坏掉不影响其它流程
        }
      }
    } catch {
      // 目录不存在时保持空表，Test Run 会给出明确错误
    }
    console.log(`[myt] flow defaults ${flowDefaults.size} 张：${[...flowDefaults.keys()].join(', ') || '(无)'}`)
  }

  const flowTasks = new FlowTaskRunner({
    createContext: ({ serial, deviceId, runId, app, abortSignal, params }) =>
      createStepContext(ctx.deviceControl, ctx.runs, {
        serial,
        deviceId,
        runId,
        app,
        options: { abortSignal, params, yadbPath: options.yadbPath, model: undefined },
      }),
    defaultsOf: (flowId) => {
      // 内核启动时已扫描 data/flows/*.json（见下方 flowDefaults 构建）
      return flowDefaults.get(flowId)
    },
    matchByNodeIds: (nodeIds) => {
      let best: { id: string; score: number } | undefined
      for (const [flowId, known] of flowNodeIds) {
        if (known.size === 0) continue
        let hit = 0
        for (const id of nodeIds) if (known.has(id)) hit += 1
        const score = hit / Math.max(known.size, nodeIds.size)
        // 至少一半节点对得上才认为是同一张图，避免误配
        if (score >= 0.5 && (!best || score > best.score)) best = { id: flowId, score }
      }
      return best ? flowDefaults.get(best.id) : undefined
    },
    pickDevice: (deviceId) => {
      // ① 直接给 ADB serial（含 `ip:port` 形式）：本地模拟器/已 connect 的真机都走这里。
      //    开发者最常传的就是 `127.0.0.1:5565` 这种，不该要求先去魔云腾注册容器。
      if (deviceId && /^[\w.-]+:\d+$/.test(deviceId)) {
        return { deviceId, serial: deviceId }
      }
      // ② 给注册表里的 deviceId：换算成 `${hostIp}:${adbPort}`
      const known = deviceId ? ctx.devices.list().find((d) => d.deviceId === deviceId) : undefined
      if (known) {
        const serial = known.state === 'running' && known.adbPort ? `${known.hostIp}:${known.adbPort}` : ''
        if (!serial) throw new Error(`设备 ${deviceId} 不在运行状态，无法执行流程`)
        return { deviceId: known.deviceId, serial }
      }
      // ③ 兜底：不传时取第一台 running 容器（开发期单机场景）
      const first = ctx.devices.list().find((d) => d.state === 'running' && d.adbPort)
      if (first) return { deviceId: first.deviceId, serial: `${first.hostIp}:${first.adbPort}` }
      throw new Error('未指定可用设备：请在流程参数里带 deviceId（ADB serial 或容器 deviceId）')
    },
  })
  /** deviceId → 取消句柄；批量任务并行时按设备取消。 */
  const cancels = new Map<string, AbortController>()
  /** deviceId → 正在执行的登录链（旧 `job_context_by_id` 的等价物）。 */
  const chains = new Map<string, ChainState>()
  /** 当前批次的代理池（旧 `self._proxy_pool`）；未勾选代理时为 null。 */
  let proxyPool: ProxyPool | null = null

  /**
   * 推进登录链（旧 `on_job_finished` 的 SUCCEEDED 分支）。
   *
   * 链跑完或失败时清空状态；每一步都用同一个 `FlowRunner`，因此事件流连续。
   */
  /**
   * 登录前准备（旧 `main_login` 开头两步，`auto_login.py:3076-3078`）。
   *
   * ```
   * if set_adb_ime: ensure_adb_keyboard(ip)
   * ensure_yadb_pushed(ip)
   * ```
   *
   * 两者都是「尽力而为」：旧实现内部 try/except 后 print 继续，不阻断登录。
   * yadb 只在流程声明 `uiChannel: 'yadb'` 时需要，但旧版无条件推送（幂等）。
   */
  async function prepareYadbAndIme(chain: ChainState): Promise<void> {
    const imeOn = chain.run.flags['setAdbIme'] !== false && chain.run.flags['setAdbIme'] !== 'false'
    if (imeOn) {
      try {
        await ctx.deviceControl.ensureIme(chain.serial)
      } catch (error) {
        console.log(
          `[chain:${chain.serial}] 设置输入法失败（继续）: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (options.yadbPath) {
      try {
        await ctx.deviceControl.ensureYadb(chain.serial, options.yadbPath)
      } catch (error) {
        console.log(
          `[chain:${chain.serial}] 推送 yadb 失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  async function runChainStep(chain: ChainState, action: string): Promise<void> {
    const flowId = chainFlows[action] ?? ''
    if (!flowId) {
      chains.delete(chain.deviceId)
      return
    }
    const llm = await loadLlmConfig(llmConfigFile)
    const params: Record<string, string> = {
      phone: '',
      countryCode: '+86',
      codeUrl: '',
      stopAfterSendCode: 'false',
      llmBaseUrl: llm.apiKey ? llm.baseUrl : '',
      llmModel: llm.model,
      llmApiKey: llm.apiKey,
      nickname: chain.run.data['nickname'] ?? '',
    }
    // 绑定手机号需要号码：从登录源里取（`区号-手机号----URL`）。
    if (action === 'bind-phone') {
      // 优先用设备自己的登录源；没有则从「批导入 → 绑定账号」分配一个
      // （旧 `_sync_bind_account_status_to_file` 的上游：`find_imported_bind_account_by_index`）。
      const src = await sourceStore.get(chain.deviceId)
      const matched = /^\+?\d*-(\d{6,15})----(.+)$/.exec(src.value)
      if (matched) {
        params['phone'] = matched[1] ?? ''
        params['codeUrl'] = matched[2] ?? ''
      } else {
        const config = await importConfigStore.load()
        const { account, index } = pickUnusedBindAccount(config)
        if (account) {
          params['phone'] = account.phone
          params['codeUrl'] = account.url
          // 记住本次用的是第几条，任务结束后回写状态。
          chain.bindAccountIndex = index
          chain.bindAccountSerial = chain.serial
        }
      }
    }

    // yadb 通道只在登录类动作需要输入法与二进制；旧版每次 `main_login` 都做一次。
    if (flowId === chainFlows['login']) await prepareYadbAndIme(chain)

    const flow = ctx.flows.resolve(flowId, params)
    if (!flow) {
      ctx.runs.list({ deviceId: chain.deviceId, status: 'running' })
      chains.delete(chain.deviceId)
      return
    }

    const controller = new AbortController()
    cancels.set(chain.deviceId, controller)
    try {
      const result = await runner.run(flow, { deviceId: chain.deviceId, serial: chain.serial }, {
        yadbPath: options.yadbPath,
        uiChannel: flow.uiChannel ?? 'uiautomator',
        abortSignal: controller.signal,
        params,
      })
      // 绑定账号任务结束后回写状态（旧 `_sync_bind_account_status_to_file`）。
      if (action === 'bind-phone' && chain.bindAccountIndex !== undefined && chain.bindAccountIndex >= 0) {
        try {
          // 旧版按 errorCode `already_bound` 区分：已绑定 → 清空状态（账号可复用）。
          const alreadyBound = result.status === 'failed'
          await updateBindAccountStatus(
            importConfigStore,
            chain.bindAccountIndex,
            alreadyBound ? '' : '成功',
            chain.serial,
          )
        } catch {
          // 回写失败不阻断链（旧版同样只 log）。
        }
        chain.bindAccountIndex = -1
      }

      if (result.status !== 'succeeded') {
        chains.delete(chain.deviceId)
        return
      }
      const next = chainRecipe ? advanceChain(chainRecipe, chain, action) : null
      if (!next) {
        chains.delete(chain.deviceId)
        return
      }
      // 下一步继续跑（同一 chain 对象，history 会累加）。
      await runChainStep(chain, next.action)
    } finally {
      cancels.delete(chain.deviceId)
    }
  }

  async function waitForState(
    hostIp: string,
    name: string,
    accept: (state: string) => boolean,
    timeoutMs = 45_000,
    intervalMs = 2_000,
  ): Promise<{ ok: boolean; state: string; waitedMs: number }> {
    const startedAt = Date.now()
    let last = 'unknown'
    while (Date.now() - startedAt < timeoutMs) {
      const rows = await ctx.mytHost.listContainers(hostIp)
      const found = rows.find((row) => row.name === name)
      last = found?.state ?? 'missing'
      if (accept(last)) return { ok: true, state: last, waitedMs: Date.now() - startedAt }
      await delay(intervalMs)
    }
    return { ok: false, state: last, waitedMs: Date.now() - startedAt }
  }

  interface HostSummary {
    ip: string
    online: boolean
    version?: string
    devCode?: string
    cpu?: number
    memPercent?: number
    diskPercent?: number
    containerCount?: number
    runningCount?: number
    slotCount?: number
    error?: string
  }

  async function summarize(ip: string): Promise<HostSummary> {
    try {
      const [version, system, containers] = await Promise.all([
        ctx.mytHost.hostVersion(ip),
        ctx.mytHost.systemInfo(ip),
        ctx.mytHost.listContainers(ip),
      ])
      const slotCount = containers.reduce((max, item) => Math.max(max, item.slotIndex), 0)
      return {
        ip,
        online: true,
        version,
        devCode: system.devCode,
        cpu: system.cpu,
        memPercent: system.memPercent,
        diskPercent: system.diskPercent,
        containerCount: containers.length,
        runningCount: containers.filter((item) => item.state === 'running').length,
        slotCount,
      }
    } catch (error) {
      return { ip, online: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        // CORS 预检：浏览器在 POST 前先发 OPTIONS，必须直接 204 放行。
        if (req.method === 'OPTIONS') {
          res.writeHead(204, CORS_HEADERS)
          res.end()
          return
        }
      try {
        if (options.uiDir && (url.pathname === '/' || url.pathname === '/index.html')) {
          const html = await readFile(join(options.uiDir, 'index.html'))
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(html)
          return
        }
        if (options.uiDir && (url.pathname === '/login' || url.pathname === '/login.html')) {
          const html = await readFile(join(options.uiDir, 'login.html'))
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(html)
          return
        }
        if (url.pathname === '/api/tabs/login/rows') {
          const host = url.searchParams.get('host') ?? hosts[0]
          if (!host) {
            sendJson(res, 400, { error: '缺少 host 参数' })
            return
          }
          const containers = await ctx.mytHost.listContainers(host)
          const devices = await ctx.devices.reconcile(host, containers)
          const running = ctx.runs.list({ limit: 200 }).filter((run) => run.status === 'running')
          const sources = await sourceStore.all()

          const rows = devices.map((device) => {
            // device 本身就是某个容器（ADR-0002：Device = 容器）。
            const active = running.find((run) => run.deviceId === device.deviceId)
            const last = ctx.runs
              .list({ deviceId: device.deviceId, limit: 1 })
              .find((run) => run.status !== 'running')
            const status: RowStatus = active
              ? 'running'
              : last?.status === 'succeeded'
                ? 'success'
                : last?.status === 'failed'
                  ? 'failed'
                  : device.state === 'running'
                    ? 'ready'
                    : 'idle'
            // ADB 端点只有容器在运行时才可用（坑位复用，见 ADR-0002）。
            const serial =
              device.state === 'running' && device.adbPort
                ? `${device.hostIp}:${device.adbPort}`
                : ''
            return {
              deviceId: device.deviceId,
              serial,
              hostIp: device.hostIp,
              containers: [
                {
                  name: device.name,
                  slotIndex: device.slotIndex,
                  state: device.state,
                  selected: device.state === 'running',
                },
              ],
              // 旧 `DeviceRowState.source`：无值时 UI 显示占位文案。
              source: sources[device.deviceId] ?? { ...EMPTY_SOURCE },
              status,
              lastError: last?.status === 'failed' ? String(last.events.at(-1)?.type ?? '') : '',
              duration:
                last?.finishedAt !== undefined ? last.finishedAt - last.startedAt : 0,
              activeRunId: active?.runId ?? null,
              retryable: last?.status === 'failed',
            }
          })
          sendJson(res, 200, { host, rows })
          return
        }
        // 批导入账号配置（旧 `AccountImportDialog` 的 values()）。
        if (url.pathname === '/api/tabs/login/import-config' && req.method === 'GET') {
          sendJson(res, 200, { config: await importConfigStore.load() })
          return
        }
        if (url.pathname === '/api/tabs/login/import-config' && req.method === 'POST') {
          const body = await readJsonBody(req)
          try {
            const saved = await importConfigStore.save(body['config'] ?? {})
            // 旧 `AccountImportDialog` 保存后的三个回写副作用（失败不阻断）：
            // 账号状态 → 源 txt / 昵称 → 已使用前缀 / 代理 → 状态前缀。
            const synced: Record<string, boolean> = {}
            if (saved.filePath) {
              synced.accounts = await syncAllAccountsToFile(saved.filePath, saved.accounts)
            }
            if (saved.nicknameFilePath) {
              synced.nicknames = await syncNicknameTxt(saved.nicknameFilePath, saved.nicknames)
            }
            if (saved.proxyFilePath) {
              synced.proxies = await syncProxyTxt(saved.proxyFilePath, saved.proxies)
            }
            sendJson(res, 200, { saved: true, config: saved, synced })
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        // 绑定账号：取一个未使用的（旧 `find_imported_bind_account_by_index` 的分配端）。
        if (url.pathname === '/api/tabs/login/bind-account/next' && req.method === 'GET') {
          const config = await importConfigStore.load()
          const { account, index } = pickUnusedBindAccount(config)
          sendJson(res, 200, {
            index,
            account: account
              ? { phone: account.phone, url: account.url, index }
              : null,
            total: config.bindAccounts.length,
            unused: config.bindAccounts.filter(
              (a) => !a.statusText.trim() && !a.assignedDeviceSerial,
            ).length,
          })
          return
        }
        // 绑定账号：写回终态（旧 `_sync_bind_account_status_to_file`）。
        // 成功 → `成功`；已绑定 → 清空（账号可复用）。
        if (url.pathname === '/api/tabs/login/bind-account/result' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const index = Number(body['index'])
          const serial = String(body['serial'] ?? '')
          const alreadyBound = body['alreadyBound'] === true || body['alreadyBound'] === 'true'
          if (!Number.isInteger(index) || index < 0) {
            sendJson(res, 400, { error: '缺少有效的 index' })
            return
          }
          try {
            const updated = await updateBindAccountStatus(
              importConfigStore,
              index,
              alreadyBound ? '' : '成功',
              serial,
            )
            sendJson(res, 200, {
              ok: true,
              statusText: updated.bindAccounts[index]?.statusText ?? '',
            })
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        // 编辑设备登录源（旧 `edit_row_source`）。
        if (url.pathname === '/api/tabs/login/source' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const deviceId = String(body['deviceId'] ?? '')
          if (!deviceId) {
            sendJson(res, 400, { error: '缺少 deviceId' })
            return
          }
          // 旧实现：任务执行中不允许改登录源。
          const active = ctx.runs.list({ deviceId, status: 'running' })
          if (active.length > 0) {
            sendJson(res, 409, { error: '该设备任务执行中，暂时不能修改登录源' })
            return
          }
          try {
            const kind = String(body['kind'] ?? 'none') as SourceKind
            const source = normalizeSource(kind, String(body['value'] ?? ''))
            await sourceStore.set(deviceId, source)
            sendJson(res, 200, { deviceId, source })
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        // 机型库（旧 `_load_reset_device_models` / `_on_brand_changed`）。
        //
        // 优先问 SDK（`get_devinfo` 带 modelid，换机型必须用它）；
        // SDK 不可达时回落到本地 devices.json（只有名字，不能用于换机型）。
        if (url.pathname === '/api/devices/models' && req.method === 'GET') {
          const brand = url.searchParams.get('brand')
          let sdkModels: Record<string, Record<string, number>> | null = null
          try {
            sdkModels = await ctx.mytHost.listDeviceModels()
          } catch {
            // SDK 不可达：回退本地（调用方据 source 字段判断能力差异）。
            sdkModels = null
          }

          // SDK 的 `data` 里混了 `global_id` 这类标量字段（旧 `load_device_brand_model_map`
          // 用 `isinstance(v, dict)` 过滤）；这里必须先净化再判断。
          const cleaned: Record<string, Record<string, number>> = {}
          for (const [brand, value] of Object.entries(sdkModels ?? {})) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              cleaned[brand] = value as Record<string, number>
            }
          }
          if (Object.keys(cleaned).length > 0) {
            if (brand) {
              const detail = cleaned[brand] ?? {}
              sendJson(res, 200, {
                brand,
                source: 'sdk',
                // 同时给名字数组（UI 渲染）与 id 映射（换机型用）。
                models: Object.keys(detail).sort(),
                modelIds: detail,
              })
              return
            }
            const brands = Object.keys(cleaned).sort()
            const total = Object.values(cleaned).reduce((sum, m) => sum + Object.keys(m).length, 0)
            sendJson(res, 200, { brands, total, source: 'sdk' })
            return
          }

          const local = await loadBrandModels(options.devicesJson)
          if (brand) {
            sendJson(res, 200, { brand, source: 'local', models: local[brand] ?? [], modelIds: {} })
            return
          }
          sendJson(res, 200, {
            brands: brandsOf(local),
            total: Object.values(local).flat().length,
            source: 'local',
          })
          return
        }
        // HeroSMS 查询（旧 `_fetch_herosms_*`）。API Key 由请求体传入，不落盘。
        if (url.pathname === '/api/herosms/balance' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const apiKey = String(body['apiKey'] ?? '').trim()
          if (!apiKey) {
            sendJson(res, 400, { error: '缺少 apiKey' })
            return
          }
          try {
            const client = new HeroSmsClient(apiKey)
            sendJson(res, 200, { balance: await client.getBalance() })
          } catch (error) {
            sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        // HeroSMS：国家 / 价格 / 活动号码（旧 `_fetch_herosms_countries/prices/active`）。
        if (url.pathname.startsWith('/api/herosms/') && req.method === 'POST') {
          const body = await readJsonBody(req)
          const apiKey = String(body['apiKey'] ?? '').trim()
          if (!apiKey) {
            sendJson(res, 400, { error: '缺少 apiKey' })
            return
          }
          const client = new HeroSmsClient(apiKey)
          try {
            if (url.pathname === '/api/herosms/countries') {
              sendJson(res, 200, { countries: await client.getCountries() })
              return
            }
            if (url.pathname === '/api/herosms/prices') {
              const countryId = Number(body['countryId'])
              if (!Number.isInteger(countryId) || countryId < 0) {
                sendJson(res, 400, { error: '请先选择有效国家' })
                return
              }
              const service = String(body['service'] ?? 'qf')
              sendJson(res, 200, { prices: await client.getPrices(service, countryId) })
              return
            }
            if (url.pathname === '/api/herosms/activations') {
              sendJson(res, 200, { activations: await client.getActiveActivations() })
              return
            }
            // 取消购买（旧 `_confirm_cancel_herosms_activation` → setStatus 6）。
            if (url.pathname === '/api/herosms/cancel') {
              const activationId = String(body['activationId'] ?? '').trim()
              if (!activationId) {
                sendJson(res, 400, { error: '缺少 activationId' })
                return
              }
              await client.cancelActivation(activationId)
              sendJson(res, 200, { activationId, cancelled: true })
              return
            }
          } catch (error) {
            sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
            return
          }
          sendJson(res, 404, { error: '未知的 HeroSMS 接口' })
          return
        }
        if (url.pathname === '/api/tabs/login/tasks' && req.method === 'GET') {
          sendJson(res, 200, {
            singles: singleTasks,
            // 完整动作定义：UI 依据 params 动态渲染表单，不再写死 prompt 链。
            actions,
            loginMode: DEFAULT_LOGIN_MODE,
          })
          return
        }
        if (url.pathname === '/api/tabs/login/check' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const rows = (body['rows'] ?? []) as DeviceRow[]
          const check = checkBatchAction({
            action: String(body['action'] ?? 'login') as BatchAction,
            rows,
            multiContainer: body['multiContainer'] === true,
            loginMode: { ...DEFAULT_LOGIN_MODE, ...((body['loginMode'] ?? {}) as Partial<LoginModeOptions>) },
            herosmsEnabled: body['herosmsEnabled'] === true,
            herosmsReady: body['herosmsReady'] === true,
            avatarsAvailable: Number(body['avatarsAvailable'] ?? 0),
            nicknamesAvailable: Number(body['nicknamesAvailable'] ?? 0),
          })
          sendJson(res, 200, check)
          return
        }
        if (url.pathname === '/api/accounts/parse-sms' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const parsed = parseSmsCodeLogin(String(body['value'] ?? ''))
          sendJson(res, parsed ? 200 : 400, parsed ?? { error: '区号-手机号----链接 格式错误' })
          return
        }
        // ── flowgram 前端运行时接口（`WorkflowRuntimeServerClient` 调的 5 个端点）──
        // 前端把 runtime-plugin 切到 mode:'server' 后直接打这里，不需要任何适配层。
        if (url.pathname === '/api/task/validate' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const schema = String(body['schema'] ?? '')
          if (!schema) {
            sendJson(res, 400, { error: '缺少 schema' })
            return
          }
          sendJson(res, 200, flowTasks.validate(schema, String(body['flowId'] ?? '')))
          return
        }
        if (url.pathname === '/api/task/run' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const schema = String(body['schema'] ?? '')
          if (!schema) {
            sendJson(res, 400, { error: '缺少 schema' })
            return
          }
          const inputs = (body['inputs'] ?? {}) as Record<string, unknown>
          try {
            sendJson(res, 200, flowTasks.run({ inputs, schema }, String(inputs['flowId'] ?? '')))
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (url.pathname === '/api/task/report' && req.method === 'GET') {
          const taskID = url.searchParams.get('taskID') ?? ''
          const report = flowTasks.report(taskID)
          if (!report) {
            sendJson(res, 404, { error: `任务不存在：${taskID}` })
            return
          }
          sendJson(res, 200, report)
          return
        }
        if (url.pathname === '/api/task/result' && req.method === 'GET') {
          const taskID = url.searchParams.get('taskID') ?? ''
          const result = flowTasks.result(taskID)
          if (!result) {
            sendJson(res, 404, { error: `任务未完成或不存在：${taskID}` })
            return
          }
          sendJson(res, 200, result)
          return
        }
        if (url.pathname === '/api/task/cancel' && req.method === 'PUT') {
          const taskID = url.searchParams.get('taskID') ?? ''
          sendJson(res, 200, flowTasks.cancel(taskID))
          return
        }
        if (url.pathname === '/api/health') {
          sendJson(res, 200, { ok: true, hosts })
          return
        }
        if (url.pathname === '/api/hosts') {
          sendJson(res, 200, await Promise.all(hosts.map(summarize)))
          return
        }
        if (url.pathname === '/api/containers') {
          const host = url.searchParams.get('host') ?? hosts[0]
          if (!host) {
            sendJson(res, 400, { error: '缺少 host 参数' })
            return
          }
          const containers = await ctx.mytHost.listContainers(host)
          const devices = await ctx.devices.reconcile(host, containers)
          const byExternal = new Map(devices.map((device) => [device.externalId, device.deviceId]))
          sendJson(res, 200, {
            host,
            containers: containers.map((container) => ({
              ...container,
              deviceId: byExternal.get(container.externalId) ?? null,
            })),
          })
          return
        }
        if (url.pathname === '/api/devices') {
          const host = url.searchParams.get('host') ?? hosts[0]
          if (!host) {
            sendJson(res, 400, { error: '缺少 host 参数' })
            return
          }
          const containers = await ctx.mytHost.listContainers(host)
          const devices = await ctx.devices.reconcile(host, containers)
          sendJson(res, 200, { host, devices })
          return
        }
        if (url.pathname === '/api/actions/start' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const host = String(body['host'] ?? '')
          const name = String(body['name'] ?? '')
          const force = body['force'] === true
          if (!host || !name) {
            sendJson(res, 400, { error: '缺少 host 或 name' })
            return
          }
          await ctx.mytHost.startContainer(host, name, { force })
          const verify = await waitForState(host, name, (state) => state === 'running')
          sendJson(res, verify.ok ? 200 : 504, { action: 'start', host, name, force, ...verify })
          return
        }
        if (url.pathname === '/api/actions/stop' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const host = String(body['host'] ?? '')
          const name = String(body['name'] ?? '')
          if (!host || !name) {
            sendJson(res, 400, { error: '缺少 host 或 name' })
            return
          }
          await ctx.mytHost.stopContainer(host, name)
          const verify = await waitForState(host, name, (state) => state === 'exited' || state === 'created')
          sendJson(res, verify.ok ? 200 : 504, { action: 'stop', host, name, ...verify })
          return
        }
        if (url.pathname === '/api/tabs/login/batch' && req.method === 'POST') {
          const body = await readJsonBody(req)
          // 动作 id 由业务包声明，内核不枚举（合法性由 actionFlows 查表判定）。
          const action = String(body['action'] ?? '')
          const rows = (body['rows'] ?? []) as Array<{ deviceId: string; serial: string }>
          const login = body['login'] as
            | { phone: string; countryCode: string; codeUrl: string; stopAfterSendCode: boolean }
            | undefined
          // 单项任务的额外参数（昵称、关键词、手机号等）。
          const taskParams = (body['taskParams'] ?? {}) as Record<string, string>
          if (!rows.length) {
            sendJson(res, 400, { error: '没有可执行的设备' })
            return
          }
          const flowId = actionFlows[action] ?? ''
          if (!flowId) {
            sendJson(res, 400, { error: `动作「${action}」尚未实现` })
            return
          }
          if (action === 'login' && !login) {
            sendJson(res, 400, { error: '缺少登录参数' })
            return
          }

          // 旧实现：已有任务的设备直接跳过，不排队。
          const accepted: Array<Record<string, unknown>> = []
          for (const row of rows) {
            if (!row.serial) {
              accepted.push({ deviceId: row.deviceId, serial: '', error: '容器未运行，无 ADB 端点' })
              continue
            }
            const active = ctx.runs.list({ deviceId: row.deviceId, status: 'running' })
            if (active.length > 0) {
              accepted.push({ deviceId: row.deviceId, serial: row.serial, error: '已有任务在执行，已跳过' })
              continue
            }
            const llm = await loadLlmConfig(llmConfigFile)
            // 统一参数表：登录参数 + 单项任务参数 + LLM 配置（工厂从这里读）。
            const resolveParams: Record<string, string> = {
              phone: login?.phone ?? '',
              countryCode: login?.countryCode ?? '+86',
              codeUrl: login?.codeUrl ?? '',
              stopAfterSendCode: login?.stopAfterSendCode ? 'true' : 'false',
              llmBaseUrl: llm.apiKey ? llm.baseUrl : '',
              llmModel: llm.model,
              llmApiKey: llm.apiKey,
              // UI dump 落盘目录（旧 `logs_base_dir()/ui_dump`）。
              uiDumpDir: join(dirname(options.stateFile), 'logs', 'ui_dump'),
              ...taskParams,
            }
            const flow = ctx.flows.resolve(flowId, resolveParams)
            if (!flow) {
              accepted.push({ deviceId: row.deviceId, serial: row.serial, error: '流程不存在' })
              continue
            }
            // 不 await：批量任务并行跑，进度通过 /api/runs 轮询。
            const controller = new AbortController()
            cancels.set(row.deviceId, controller)
            void runner
              .run(flow, { deviceId: row.deviceId, serial: row.serial }, {
                yadbPath: options.yadbPath,
                uiChannel: flow.uiChannel ?? 'uiautomator',
                abortSignal: controller.signal,
                params: resolveParams,
              })
              .catch(() => {
                // 失败已写入事件流，这里不再冒泡。
              })
              .finally(() => {
                cancels.delete(row.deviceId)
              })
            accepted.push({ deviceId: row.deviceId, serial: row.serial })
          }
          sendJson(res, 200, { accepted })
          return
        }
        /**
         * 批量登录（旧 `run_batch_action(LOGIN)`）。
         *
         * 与 `/batch` 的差别：这是**链式**执行——登录前按需切换容器/设代理/换机型，
         * 登录成功后按配置继续 绑定手机号 / 仅关注可评论 / 改资料 / 关注 / 备份 / 清除 / 下一循环。
         */
        if (url.pathname === '/api/tabs/login/batch-login' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const rows = (body['rows'] ?? []) as Array<{ deviceId: string; serial: string }>
          const login = body['login'] as
            | { phone?: string; countryCode?: string; codeUrl?: string }
            | undefined
          const opts = (body['options'] ?? {}) as Record<string, unknown>

          if (!rows.length) {
            sendJson(res, 400, { error: '请先选择设备' })
            return
          }
          if (!login?.phone) {
            sendJson(res, 400, { error: '缺少手机号' })
            return
          }

          // 旧实现：已有任务的设备直接跳过，不排队。
          // 批导入配置：UI 传的 options 优先，缺的字段回落到持久化配置
          // （旧版这些状态都在 `self.*`，UI 关闭后仍生效）。
          const savedImport = await importConfigStore.load()

          const loopCount = Number(opts['loginLoopCount'] ?? 1) || 1
          /**
           * 一次运行的输入快照。
           *
           * 拆成 `flags`（开关，键名与 UI opts 同名）与 `data`（运行数据），
           * 条件表达式只引用这两者——不再有「配置默认值」这一层。
           */
          const runFlags: Record<string, unknown> = {
            autoBackupAfterLogin: opts['loginAndBackup'] === true || opts['loginAndBackup'] === 'true',
            autoClearAfterBackup: opts['clearData'] === true || opts['clearData'] === 'true',
            clearData: opts['clearData'] === true || opts['clearData'] === 'true',
            setAvatarNickname: opts['setAvatarNickname'] === true || opts['setAvatarNickname'] === 'true',
            onlyFollowingComments:
              opts['onlyFollowingComments'] === true || opts['onlyFollowingComments'] === 'true',
            enableBindPhone: opts['enableBindPhone'] === true || opts['enableBindPhone'] === 'true',
            followUsers: opts['followUsers'] === true || opts['followUsers'] === 'true',
            setProxyBeforeLogin:
              opts['setProxyBeforeLogin'] === true || opts['setProxyBeforeLogin'] === 'true',
            resetDeviceBeforeLogin:
              opts['resetDeviceBeforeLogin'] === true || opts['resetDeviceBeforeLogin'] === 'true',
            resetDeviceMode: opts['resetDeviceMode'] === 'specified' ? 'specified' : 'random',
            resetDeviceModels: Array.isArray(opts['resetDeviceModels'])
              ? (opts['resetDeviceModels'] as Array<{ brand: string; model: string }>)
              : [],
            resetOverseasRandom: opts['resetOverseasRandom'] !== false,
            setAdbIme: opts['setAdbIme'] !== false,
            sameIpBatchSize: Number(opts['sameIpBatchSize'] ?? 3) || 3,
            batchIntervalSeconds: Number(opts['batchIntervalSeconds'] ?? 10) || 10,
            smsProvider:
              opts['smsProvider'] === 'herosms' ||
              (opts['smsProvider'] === undefined && savedImport.heroSmsEnabled)
                ? 'herosms'
                : 'legacy',
            // UI 直接给 heroSms 就用它；否则从持久化配置拼。
            heroSms:
              (opts['heroSms'] as { apiKey: string; countryId: number; countryCode: string; maxPrice: number } | undefined) ??
              (savedImport.heroSmsEnabled
                ? {
                    apiKey: savedImport.heroSmsApiKey,
                    countryId: savedImport.heroSmsCountryId ?? 0,
                    countryCode: savedImport.heroSmsCountryCode,
                    maxPrice: savedImport.heroSmsMaxPrice ?? 0,
                  }
                : undefined),
          }

          /** 运行数据（条件表达式里 `has` 的取值来源）。 */
          const runData: Record<string, string> = {
            avatarPath: String(opts['avatarPath'] ?? ''),
            nickname: String(opts['nickname'] ?? ''),
            followKeywords: String(opts['followKeywords'] ?? ''),
          }

          // 旧版前置校验：SMS 多次循环必须勾选清除数据（否则第二次登录会复用已登录态）。
          const flagIsOn = (key: string): boolean =>
            runFlags[key] === true || runFlags[key] === 'true'
          if (loopCount > 1 && !flagIsOn('clearData')) {
            sendJson(res, 400, { error: 'SMS 多次循环登录必须勾选「清除数据」' })
            return
          }
          // 旧版前置校验：勾了改头像昵称就必须有足够的头像/昵称数量。
          if (flagIsOn('setAvatarNickname')) {
            const totalSlots = rows.length * loopCount
            const avatars = Number(opts['avatarsAvailable'] ?? 0)
            const nicknames = Number(opts['nicknamesAvailable'] ?? 0)
            if (avatars < totalSlots) {
              sendJson(res, 400, {
                error: `已勾选「设置头像、昵称」，但头像图片数量不足（需 ${totalSlots} 张，现有 ${avatars} 张）`,
              })
              return
            }
            if (nicknames < totalSlots) {
              sendJson(res, 400, {
                error: `已勾选「设置头像、昵称」，但昵称数量不足（需 ${totalSlots} 条，现有 ${nicknames} 条）`,
              })
              return
            }
          }
          // 旧版前置校验：勾了「登录前设置代理」但没有代理列表。
          if (flagIsOn('setProxyBeforeLogin')) {
            const proxyList = Array.isArray(opts['proxies']) ? (opts['proxies'] as string[]) : []
            if (proxyList.length === 0) {
              sendJson(res, 400, {
                error: '已勾选「登录前设置魔云腾代理ip」，但尚未导入代理 IP 列表',
              })
              return
            }
            const needed = requiredProxyCount(rows.length, Number(opts['proxyMachinesPerIp'] ?? 1) || 1)
            if (proxyList.length < needed) {
              sendJson(res, 400, {
                error: `代理 IP 数量不足：当前 ${proxyList.length} 条，需要 ${needed} 条`,
              })
              return
            }
            proxyPool = new ProxyPool(proxyList, Number(opts['proxyMachinesPerIp'] ?? 1) || 1)
          }

          const accepted: Array<Record<string, unknown>> = []
          /** 通过预检的设备（后续按 IP 分批提交，旧 `submit_login_jobs_in_ip_batches`）。 */
          const runnable: Array<{ row: { deviceId: string; serial: string }; chain: ChainState }> = []
          const llm = await loadLlmConfig(llmConfigFile)

          for (const row of rows) {
            if (!row.serial) {
              accepted.push({ deviceId: row.deviceId, serial: '', error: '容器未运行，无 ADB 端点' })
              continue
            }
            // 旧 `runnable_selected_rows`：已有任务的设备跳过。
            if (ctx.runs.list({ deviceId: row.deviceId, status: 'running' }).length > 0) {
              accepted.push({ deviceId: row.deviceId, serial: row.serial, error: '已有任务在执行，已跳过' })
              continue
            }

            // 多容器模式：目标容器不是当前运行的那个 → 需要先切换。
            const device = ctx.devices.list().find((d) => d.deviceId === row.deviceId)
            const switchNeeded = Boolean(device && device.state !== 'running')

            const chain: ChainState = {
              deviceId: row.deviceId,
              serial: row.serial,
              action: 'login',
              history: [],
              run: {
                // 容器是否需要切换是**运行期判定**，不来自 UI。
                flags: { ...runFlags, switchContainer: switchNeeded },
                data: { ...runData },
                loopRemaining: Math.max(0, loopCount - 1),
                retryRemaining: Number(opts['loginRetryCount'] ?? 0) || 0,
                done: new Set<string>(),
              },
            }
            chains.set(row.deviceId, chain)
            runnable.push({ row, chain })
            accepted.push({ deviceId: row.deviceId, serial: row.serial, chain: true })
          }

          /**
           * 执行一条链（前置动作 → 登录 → 后置动作），带失败重试。
           *
           * 旧版重试只对「批量 SMS / SID / OP / V」有效，且只在 `login` 动作上重试。
           */
          async function executeChain(chain: ChainState): Promise<void> {
            const controller = new AbortController()
            cancels.set(chain.deviceId, controller)
            try {
              // 登录前动作（容器切换 / 代理 / 一键新机），由配方的 before 阶段决定
              if (!chainRecipe) {
                chains.delete(chain.deviceId)
                return
              }
              let step: ChainStep | null = beginChain(chainRecipe, chain)
              while (step && step.action !== 'login') {
                const ok = await runPreStep(
                  chain,
                  step.action as 'switch-container' | 'set-proxy' | 'reset-device',
                  controller.signal,
                )
                if (!ok) {
                  chains.delete(chain.deviceId)
                  return
                }
                step = advanceChain(chainRecipe, chain, step.action)
              }
              if (!step) {
                chains.delete(chain.deviceId)
                return
              }

              await prepareYadbAndIme(chain)


              /** 跑一次登录 flow。 */
              const runLoginOnce = async (params: Record<string, string>): Promise<boolean> => {
                const loginFlowId = chainFlows['login'] ?? ''
                if (!loginFlowId) return false
                const flow = ctx.flows.resolve(loginFlowId, params)
                if (!flow) return false
                const result = await runner.run(
                  flow,
                  { deviceId: chain.deviceId, serial: chain.serial },
                  {
                    yadbPath: options.yadbPath,
                    uiChannel: 'yadb',
                    abortSignal: controller.signal,
                    params,
                  },
                )
                return result.status === 'succeeded'
              }

              /** 重试前清数据（旧版同样依赖 clear_data）。 */
              const clearBeforeRetry = async (): Promise<void> => {
                const clearData = chain.run.flags['clearData'] === true || chain.run.flags['clearData'] === 'true'
                if (!clearData) return

                const clearFlowId = chainFlows['clear'] ?? ''
                if (!clearFlowId) return
                const clearFlow = ctx.flows.resolve(clearFlowId, {})
                if (!clearFlow) return
                await runner.run(
                  clearFlow,
                  { deviceId: chain.deviceId, serial: chain.serial },
                  { yadbPath: options.yadbPath, abortSignal: controller.signal, params: {} },
                )
              }

              let succeeded = false

              // HeroSMS：走「取号 → 登录 → 置终态」编排（旧 `main_login` 的 herosms 分支）。
              // 编排内部自带 2 次重试与 finally 取消，故外层不再叠加 retryRemaining。
              const hero = chain.run.flags['heroSms'] as
                | { apiKey: string; countryId: number; countryCode: string; maxPrice: number }
                | undefined
              if (chain.run.flags['smsProvider'] === 'herosms' && hero?.apiKey) {
                const client = new HeroSmsClient(hero.apiKey)
                const outcome = await loginWithHeroSms({
                  client,
                  countryId: hero.countryId,
                  countryCode: hero.countryCode,
                  maxPrice: hero.maxPrice,
                  attemptLogin: async (phone: string, activationId: string) => {
                    // 号码来自 HeroSMS：手机号/区号用取号结果，验证码按 activationId 轮询。
                    return runLoginOnce({
                      ...buildLoginParams(chain),
                      phone,
                      countryCode: hero.countryCode,
                      codeUrl: '',
                      activationId,
                      heroSmsApiKey: hero.apiKey,
                      heroSmsCountryId: String(hero.countryId),
                      heroSmsMaxPrice: String(hero.maxPrice),
                    })
                  },
                  restartApp: async () => {
                    await ctx.deviceControl.forceStop(chain.serial, 'com.xingin.xhs')
                  },
                  logger: (line: string) => console.log(`[herosms:${chain.serial}] ${line}`),
                })
                succeeded = outcome.ok
                if (!succeeded) {
                  console.log(`[herosms:${chain.serial}] 登录失败: ${outcome.error}`)
                }
              } else {
                // 普通路径（可重试）
                let attempt = 0
                while (attempt <= chain.run.retryRemaining) {
                  if (controller.signal.aborted) return
                  if (await runLoginOnce(buildLoginParams(chain))) {
                    succeeded = true
                    break
                  }
                  attempt += 1
                  if (attempt > chain.run.retryRemaining) break
                  await clearBeforeRetry()
                }
              }

              if (!succeeded) {
                chains.delete(chain.deviceId)
                return
              }

              const next = chainRecipe ? advanceChain(chainRecipe, chain, 'login') : null
              if (!next) {
                chains.delete(chain.deviceId)
                return
              }
              await runChainStep(chain, next.action)
            } catch (error) {
              // 编排层异常（如 HeroSMS 取号失败）没有对应 run 记录，必须显式落一条，
              // 否则 UI 上只看到「什么都没有发生」。
              const message = error instanceof Error ? error.message : String(error)
              const run = ctx.runs.start({
                flowId: 'pre:login-chain',
                deviceId: chain.deviceId,
                serial: chain.serial,
              })
              ctx.runs.stepStarted(run.runId, 'login-chain', '登录链')
              ctx.runs.stepFailed(run.runId, 'login-chain', 0, 'precondition', message)
              ctx.runs.finish(run.runId, 'failed', 0, 'login-chain')
              console.log(`[chain:${chain.serial}] 异常: ${message}`)
              chains.delete(chain.deviceId)
            } finally {
              cancels.delete(chain.deviceId)
            }
          }

          /** 组装登录参数（HeroSMS 时 phone/codeUrl 由内核现取，不落 UI 输入）。 */
          function buildLoginParams(chain: ChainState): Record<string, string> {
            const hero = chain.run.flags['heroSms'] as { apiKey?: string; countryId?: number; countryCode?: string; maxPrice?: number } | undefined
            const useHero = chain.run.flags['smsProvider'] === 'herosms' && hero
            return {
              phone: useHero ? '' : (login?.phone ?? ''),
              countryCode: useHero ? (hero?.countryCode ?? '+86') : (login?.countryCode ?? '+86'),
              codeUrl: useHero ? '' : (login?.codeUrl ?? ''),
              stopAfterSendCode: useHero ? 'false' : login?.codeUrl ? 'false' : 'true',
              llmBaseUrl: llm.apiKey ? llm.baseUrl : '',
              llmModel: llm.model,
              llmApiKey: llm.apiKey,
              nickname: chain.run.data['nickname'] ?? '',
              heroSmsApiKey: useHero ? (hero?.apiKey ?? '') : '',
              heroSmsCountryId: useHero ? String(hero?.countryId ?? '') : '',
              heroSmsMaxPrice: useHero ? String(hero?.maxPrice ?? '') : '',
            }
          }

          /**
           * 执行登录前动作。
           *
           * @returns 是否继续（false 表示该设备失败，链终止）
           */
          async function runPreStep(
            chain: ChainState,
            action: 'switch-container' | 'set-proxy' | 'reset-device',
            signal: AbortSignal,
          ): Promise<boolean> {
            const device = ctx.devices.list().find((d) => d.deviceId === chain.deviceId)
            if (!device) return false

            // 前置动作不走 FlowRunner，但要让人在 UI 上看到发生了什么——
            // 这里开一个 run 记录失败原因（旧版是 log 到日志面板）。
            const run = ctx.runs.start({
              flowId: `pre:${action}`,
              deviceId: chain.deviceId,
              serial: chain.serial,
            })
            ctx.runs.stepStarted(run.runId, action, actionLabel(actions, action))
            const startedAt = Date.now()
            const finish = (ok: boolean, note: string): boolean => {
              if (ok) {
                ctx.runs.stepSucceeded(run.runId, action, Date.now() - startedAt, note)
                ctx.runs.finish(run.runId, 'succeeded', 1)
              } else {
                ctx.runs.stepFailed(run.runId, action, Date.now() - startedAt, 'precondition', note)
                ctx.runs.finish(run.runId, 'failed', 0, action)
              }
              return ok
            }

            if (action === 'switch-container') {
              // 旧 `CONTAINER_SWITCH`：起容器 → 等 ADB 持续稳定 → 再继续。
              try {
                await ctx.mytHost.startContainer(device.hostIp, device.name, { force: true })
              } catch {
                return finish(false, '启动容器失败')
              }
              const result = await waitForStableAdb({
                isOnline: async () => {
                  try {
                    await ctx.deviceControl.connect(chain.serial)
                    const out = await ctx.deviceControl.shell(chain.serial, 'getprop ro.serialno', {
                      check: false,
                    })
                    return out.trim().length > 0
                  } catch {
                    return false
                  }
                },
                reconnect: async () => {
                  await ctx.deviceControl.connect(chain.serial)
                },
                timeoutSeconds: 120,
                stableSeconds: 20,
                isCancelled: () => signal.aborted,
              })
              return finish(result === 'ok', result === 'ok' ? '容器已就绪' : `等待 ADB 超时（${result}）`)
            }

            if (action === 'set-proxy') {
              // 代理在批调度前已由 ProxyPool 分配，这里只做接口调用。
              const proxy = proxyPool?.getForDevice(chain.deviceId)
              // 没分配就跳过，不算失败（旧版同样 log 后继续）。
              if (!proxy) return finish(true, '未分配代理，跳过')
              try {
                const result = await ctx.mytHost.setS5Proxy({
                  deviceIp: device.hostIp,
                  apiPort: 10008,
                  proxyIp: proxy.ip,
                  proxyPort: Number(proxy.port) || 1080,
                  username: proxy.username,
                  password: proxy.password,
                  timeoutMs: 30_000,
                })
                return finish(result, result ? `代理已设置 ${proxy.ip}` : '代理设置失败')
              } catch {
                return finish(false, '代理设置异常')
              }
            }

            if (action === 'reset-device') {
              // 严格照搬旧 `_run_device_reset`（gui_device_worker.py:78-128）：
              //
              // | 条件 | 走哪条 |
              // |---|---|
              // | android_type ∈ {0, 12} | `One_click_new_device`（App UI 自动化） |
              // | android_type ∉ {0,12}   | V3 `random_switch_model`（8000 端口） |
              //
              // 注：旧代码从不使用 `set_custom_devinfo` / oem_data，本版也不再涉及。
              const container = (await ctx.mytHost.listContainers(device.hostIp)).find(
                (c) => c.name === device.name,
              )
              const androidType = parseAndroidVersion(container?.image ?? '')

              if (androidType !== null && androidType !== 0 && androidType !== 12) {
                // V3：随机切机型（旧 `random_switch_model(host, name, android_version)`）
                try {
                  const result = await ctx.mytHostV3.randomSwitchModel(
                    device.hostIp,
                    device.name,
                    String(androidType),
                  )
                  if (!result.ok) {
                    return finish(false, `V3 机型切换失败（Android ${androidType}）`)
                  }
                } catch (error) {
                  return finish(
                    false,
                    `V3 机型切换异常: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              } else {
                // 安卓 12 / 非魔云腾：旧一键新机（点 com.blue.backup）
                // 流程 id 由链配置决定，内核不再兜底到具体业务 id。
                const resetFlowId = chainFlows['reset-device']
                const flow = resetFlowId ? ctx.flows.resolve(resetFlowId, {
                  brand: ((chain.run.flags['resetDeviceModels'] as Array<{ brand: string; model: string }> | undefined) ?? [])[0]?.brand ?? '',
                  model: ((chain.run.flags['resetDeviceModels'] as Array<{ brand: string; model: string }> | undefined) ?? [])[0]?.model ?? '',
                  overseasRandom: chain.run.flags['resetOverseasRandom'] !== false && chain.run.flags['resetOverseasRandom'] !== 'false' ? 'true' : 'false',
                }) : undefined
                if (!flow) return finish(false, '一键新机流程未注册')
                const result = await runner.run(
                  flow,
                  { deviceId: chain.deviceId, serial: chain.serial },
                  {
                    yadbPath: options.yadbPath,
                    abortSignal: signal,
                    params: {},
                  },
                )
                if (result.status !== 'succeeded') {
                  return finish(false, '一键新机失败: 超时或 UI 节点未找到')
                }
              }

              // 换机型会改 MAC 导致网络中断，等 ADB 真正恢复。
              const recovered = await waitForStableAdb({
                isOnline: async () => {
                  try {
                    await ctx.deviceControl.connect(chain.serial)
                    const out = await ctx.deviceControl.shell(chain.serial, 'getprop ro.serialno', {
                      check: false,
                    })
                    return out.trim().length > 0
                  } catch {
                    return false
                  }
                },
                reconnect: async () => {
                  await ctx.deviceControl.connect(chain.serial)
                },
                timeoutSeconds: 120,
                stableSeconds: 15,
                isCancelled: () => signal.aborted,
              })
              return finish(
                recovered === 'ok',
                recovered === 'ok' ? '换机型完成，ADB 已恢复' : `换机型后 ADB 未恢复（${recovered}）`,
              )
            }

            return finish(true, '无需处理')
          }

          // 旧 `submit_login_jobs_in_ip_batches`：按 IP 分组、每组首块立即、后续延迟。
          const plan = planIpBatches(
            runnable.map((item) => ({ hostIp: hostIpOf(item.row.serial), payload: item })),
            Number(runFlags['sameIpBatchSize'] ?? 3) || 3,
            Number(runFlags['batchIntervalSeconds'] ?? 10) || 10,
          )
          for (const batch of plan) {
            const fire = () => {
              for (const job of batch.jobs) void executeChain(job.payload.chain)
            }
            if (batch.delayMs === 0) fire()
            else setTimeout(fire, batch.delayMs)
          }

          sendJson(res, 200, { accepted, flags: runFlags })
          return
        }
        if (url.pathname === '/api/tabs/login/cancel' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const deviceIds = (body['deviceIds'] ?? []) as string[]
          let signalled = 0
          for (const deviceId of deviceIds) {
            const controller = cancels.get(deviceId)
            if (!controller) continue
            controller.abort()
            signalled += 1
          }
          // 取消是协作式的：信号发出后，当前步骤结束才会停下（与旧实现杀进程不同）。
          sendJson(res, 200, { requested: deviceIds.length, signalled })
          return
        }
        if (url.pathname === '/api/tabs/login/llm' && req.method === 'GET') {
          const config = await loadLlmConfig(llmConfigFile)
          // 密钥不回传明文，只给掩码与是否已配置。
          sendJson(res, 200, {
            baseUrl: config.baseUrl,
            model: config.model,
            apiKeyMasked: config.apiKey
              ? `${config.apiKey.slice(0, 6)}****${config.apiKey.slice(-4)}`
              : '',
            configured: Boolean(config.apiKey),
          })
          return
        }
        if (url.pathname === '/api/tabs/login/llm' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const saved = await saveLlmConfig(llmConfigFile, {
            baseUrl: body['baseUrl'] === undefined ? undefined : String(body['baseUrl']),
            model: body['model'] === undefined ? undefined : String(body['model']),
            apiKey: body['apiKey'] === undefined ? undefined : String(body['apiKey']),
          })
          sendJson(res, 200, {
            baseUrl: saved.baseUrl,
            model: saved.model,
            configured: Boolean(saved.apiKey),
          })
          return
        }
        if (url.pathname === '/api/accounts/import' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const mode = String(body['mode'] ?? 'sms') as ImportMode
          const text = String(body['text'] ?? '')
          const accounts = parseAccountFile(mode, text)
          sendJson(res, 200, {
            mode,
            count: accounts.length,
            accounts,
            hint: accounts.length === 0 ? emptyImportHint(mode) : '',
          })
          return
        }
        if (url.pathname === '/api/flows') {
          sendJson(res, 200, ctx.flows.list())
          return
        }
        if (url.pathname === '/api/runs' && req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 20)
          sendJson(
            res,
            200,
            ctx.runs.list({ limit: Number.isInteger(limit) ? limit : 20 }).map((record) => ({
              runId: record.runId,
              flowId: record.flowId,
              deviceId: record.deviceId,
              serial: record.serial,
              status: record.status,
              startedAt: record.startedAt,
              finishedAt: record.finishedAt,
              steps: record.events.filter((event) => event.type === 'step/started').length,
            })),
          )
          return
        }
        if (url.pathname.startsWith('/api/runs/') && req.method === 'GET') {
          const runId = url.pathname.slice('/api/runs/'.length)
          const record = ctx.runs.get(runId)
          if (!record) {
            sendJson(res, 404, { error: '运行不存在' })
            return
          }
          sendJson(res, 200, record)
          return
        }
        if (url.pathname === '/api/runs' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const flowId = String(body['flowId'] ?? '')
          const serial = String(body['serial'] ?? '')
          const deviceId = String(body['deviceId'] ?? '')
          const dryRun = body['dryRun'] === true
          const params = (body['params'] ?? {}) as Record<string, unknown>
          if (!flowId || !serial) {
            sendJson(res, 400, { error: '缺少 flowId 或 serial' })
            return
          }
          let flow
          try {
            flow = ctx.flows.resolve(flowId, params)
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
            return
          }
          if (!flow) {
            sendJson(res, 404, { error: `流程不存在：${flowId}` })
            return
          }
          // 同一设备同时只允许一个运行；冲突直接拒绝而不是排队（避免抢占界面）。
          const active = ctx.runs.list({ deviceId, status: 'running' })
          if (active.length > 0) {
            sendJson(res, 409, { error: '该设备已有运行中的任务', runId: active[0]?.runId })
            return
          }
          const result = await runner.run(
            flow,
            { deviceId: deviceId || serial, serial },
            {
              dryRun,
              yadbPath: options.yadbPath,
              seed: typeof body['seed'] === 'number' ? body['seed'] : undefined,
              // 登录类流程必须用 yadb：旧实现在真机上验证过，uiautomator 结构不同。
              uiChannel: flow.uiChannel ?? 'uiautomator',
            },
          )
          sendJson(res, result.status === 'succeeded' ? 200 : 500, result)
          return
        }
        if (url.pathname === '/api/device/connect' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const serial = String(body['serial'] ?? '')
          if (!serial) {
            sendJson(res, 400, { error: '缺少 serial' })
            return
          }
          const output = await ctx.deviceControl.connect(serial)
          sendJson(res, 200, { ok: true, serial, output })
          return
        }
        if (url.pathname === '/api/device/dump' && req.method === 'GET') {
          const serial = url.searchParams.get('serial') ?? ''
          if (!serial) {
            sendJson(res, 400, { error: '缺少 serial' })
            return
          }
          const snapshot = await ctx.deviceControl.dumpUi(serial)
          sendJson(res, 200, {
            serial: snapshot.serial,
            channel: snapshot.channel,
            nodeCount: snapshot.nodeCount,
            capturedAt: snapshot.capturedAt,
            root: snapshot.root,
          })
          return
        }
        if (url.pathname === '/api/device/tap' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const serial = String(body['serial'] ?? '')
          const x = Number(body['x'])
          const y = Number(body['y'])
          if (!serial || !Number.isFinite(x) || !Number.isFinite(y)) {
            sendJson(res, 400, { error: '缺少 serial 或坐标' })
            return
          }
          await ctx.deviceControl.tap(serial, x, y)
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 404, { error: 'not found' })
      } catch (error) {
        sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    const { promise, resolve: done, reject: fail } = Promise.withResolvers<void>()
    server.once('error', fail)
    server.listen(options.port, listenHost, () => {
      server.off('error', fail)
      done()
    })
    void promise.then(resolve, reject)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  options.onReady?.({ port, host: listenHost })

  return {
    port,
    close: async () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      server.close(() => resolve())
      await promise
      await ctx.fiber.dispose()
    },
  }
}
