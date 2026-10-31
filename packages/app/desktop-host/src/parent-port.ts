/**
 * Electron utilityProcess 在宿主进程里额外挂载的 `process.parentPort`。
 *
 * 该 API 只存在于 Electron 运行时，Node 类型定义里没有，也没有可用的
 * schema（消息通道自身就是目标）。这里把方法取出为具体函数签名后窄化，
 * 避免以裸类型断言换取成员访问。
 */
export interface ParentPortMessageEvent {
  data?: { type?: string }
}

export interface ParentPortLike {
  postMessage: (message: unknown) => void
  on: (event: 'message', listener: (event: ParentPortMessageEvent) => void) => void
}

type AnyFunction = (...args: unknown[]) => unknown

function asFunction(value: unknown): value is AnyFunction {
  return typeof value === 'function'
}

/** 取 Electron 注入的父端口；普通 Node 进程返回 undefined。 */
export function getParentPort(): ParentPortLike | undefined {
  if (!('parentPort' in process)) return undefined
  const candidate: unknown = process.parentPort
  if (!candidate || typeof candidate !== 'object') return undefined
  if (!('postMessage' in candidate)) return undefined
  if (!('on' in candidate)) return undefined

  const postMessage = candidate.postMessage
  const on = candidate.on
  if (!asFunction(postMessage) || !asFunction(on)) return undefined

  return {
    postMessage: (message: unknown) => {
      postMessage.call(candidate, message)
    },
    on: (event, listener) => {
      on.call(candidate, event, (message: ParentPortMessageEvent) => listener(message))
    },
  }
}
