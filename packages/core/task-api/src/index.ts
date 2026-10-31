/**
 * flowgram 运行时 HTTP 接口。
 *
 * 前端把 `runtime-plugin` 切到 `mode:'server'` 后直接打这 5 个端点，
 * 不需要任何适配层——所以路径与参数名必须与 flowgram 的约定完全一致。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强，让 `ctx.webServer` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseSmsCodeLogin } from '@myt/xhs-login'
import { createStepContext } from '@myt/flow'
import type {} from '@myt/devices'
import type {} from '@myt/runs'
import type {} from '@myt/device-adb'
import type {} from '@myt/model'
import { createModelLocate } from '@myt/ui-decide'
import { FlowTaskRunner } from './flow-task.ts'
import type { FlowTaskDeps } from './flow-task.ts'

/** 任务接口的配置。 */
export interface TaskApiConfig {
  /** yadb 可执行文件路径；随应用分发。 */
  yadbPath?: string
}

/**
 * 流程图运行时的 HTTP 门面。
 *
 * 认识「任务」这一概念（validate / run / report / result / cancel），
 * 不认识流程图里有什么节点——那是 `FlowTaskRunner` 的事。
 */
export class TaskApi extends Service {
  /** 依赖：只有 Web 服务。 */
  static inject = ['webServer', 'devices', 'runs', 'deviceControl', 'modelControl']

  private readonly runner: FlowTaskRunner

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: TaskApiConfig = {}) {
    super(ctx, 'taskApi')
    const yadbPath = config.yadbPath ?? 'yadb'
    const deps: FlowTaskDeps = {
      createContext: ({ serial, deviceId, runId, app, abortSignal, params }) =>
        createStepContext(ctx.deviceControl, ctx.runs, {
          serial,
          deviceId,
          runId,
          app,
          // 定位用本机模型：没有它只能走「兜底定位器」，intent 模式会失败。
          options: { abortSignal, params, yadbPath, model: createModelLocate(ctx.modelControl) },
        }),
      pickDevice: (deviceId) => pickDevice(ctx.devices.list(), deviceId),
    }
    this.runner = new FlowTaskRunner(deps)
  }

  [Service.init](): void {
    const server = this.ctx.webServer

    server.register({
      kind: 'exact',
      path: '/api/task/validate',
      handler: (req, res) => {
        if (req.method !== 'POST') return methodNotAllowed(res, req.method)
        void readJson(req).then((body) => {
          const schema = String(body['schema'] ?? '')
          if (!schema) return sendJson(res, 400, { error: '缺少 schema' })
          sendJson(res, 200, this.runner.validate(schema))
        })
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/task/run',
      handler: (req, res) => {
        if (req.method !== 'POST') return methodNotAllowed(res, req.method)
        void readJson(req).then((body) => {
          const schema = String(body['schema'] ?? '')
          if (!schema) return sendJson(res, 400, { error: '缺少 schema' })
          const inputs = (body['inputs'] ?? {}) as Record<string, unknown>
          try {
            sendJson(res, 200, this.runner.run({ inputs, schema }))
          } catch (error) {
            sendJson(res, 400, { error: message(error) })
          }
        })
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/task/report',
      handler: (req, res) => {
        if (req.method !== 'GET') return methodNotAllowed(res, req.method)
        const taskID = queryOf(req).searchParams.get('taskID') ?? ''
        const report = this.runner.report(taskID)
        if (!report) return sendJson(res, 404, { error: `任务不存在：${taskID}` })
        sendJson(res, 200, report)
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/task/result',
      handler: (req, res) => {
        if (req.method !== 'GET') return methodNotAllowed(res, req.method)
        const taskID = queryOf(req).searchParams.get('taskID') ?? ''
        const result = this.runner.result(taskID)
        if (!result) return sendJson(res, 404, { error: `任务未完成或不存在：${taskID}` })
        sendJson(res, 200, result)
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/task/cancel',
      handler: (req, res) => {
        if (req.method !== 'PUT') return methodNotAllowed(res, req.method)
        const taskID = queryOf(req).searchParams.get('taskID') ?? ''
        sendJson(res, 200, this.runner.cancel(taskID))
      },
    })

    // 账号解析：手机号/验证码登录文本 → 区号、手机号、链接。
    server.register({
      kind: 'exact',
      path: '/api/accounts/parse-sms',
      handler: (req, res) => {
        if (req.method !== 'POST') return methodNotAllowed(res, req.method)
        void readJson(req).then((body) => {
          const parsed = parseSmsCodeLogin(String(body['value'] ?? ''))
          sendJson(res, parsed ? 200 : 400, parsed ?? { error: '区号-手机号----链接 格式错误' })
        })
      },
    })
  }
}

/** 取请求的 URL 对象。 */
function queryOf(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://x')
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
    taskApi: TaskApi
  }
}

export default TaskApi

/**
 * 从设备清单里挑一台执行设备。
 *
 * 三种来源，按优先级：直接给 ADB serial、给注册表里的 deviceId、
 * 不传时取第一台运行中的容器。
 * @param devices - 设备注册表快照。
 * @param deviceId - 调用方给的标识；可为空。
 */
export function pickDevice(
  devices: ReadonlyArray<{ deviceId: string; state: string; hostIp: string; adbPort: number | null }>,
  deviceId?: string,
): { deviceId: string; serial: string } {
  // ① 直接给 ADB serial（含 `ip:port`）：本地模拟器或已 connect 的真机。
  if (deviceId && /^[\w.-]+:\d+$/u.test(deviceId)) return { deviceId, serial: deviceId }
  // ② 注册表里的 deviceId：换算成 `${hostIp}:${adbPort}`。
  const known = deviceId ? devices.find((d) => d.deviceId === deviceId) : undefined
  if (known) {
    const serial = known.state === 'running' && known.adbPort ? `${known.hostIp}:${known.adbPort}` : ''
    if (!serial) throw new Error(`设备 ${deviceId} 不在运行状态，无法执行流程`)
    return { deviceId: known.deviceId, serial }
  }
  // ③ 兜底：不传时取第一台运行中的容器（开发期单机场景）。
  const first = devices.find((d) => d.state === 'running' && d.adbPort)
  if (first) return { deviceId: first.deviceId, serial: `${first.hostIp}:${first.adbPort}` }
  throw new Error('未指定可用设备：请在流程参数里带 deviceId（ADB serial 或容器 deviceId）')
}
