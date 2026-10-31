import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebServer, HttpError } from './index.ts'

/**
 * WebServer 测试：只测外部行为（HTTP 语义、路由优先级、错误收敛），
 * 不测内部有没有调用某个函数。
 */

const servers: WebServer[] = []

async function start(config: { cors?: boolean } = {}): Promise<{ server: WebServer; base: string }> {
  const ctx = new Context()
  const server = new WebServer(ctx as never, { port: 0, ...config })
  servers.push(server)
  const port = await server.listen()
  return { server, base: `http://127.0.0.1:${port}` }
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

describe('WebServer — 基本路由', () => {
  it('GET 处理器返回值序列化成 JSON', async () => {
    const { server, base } = await start()
    server.get('/api/ping', () => ({ ok: true }))

    const res = await fetch(`${base}/api/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('未匹配返回 404', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/nope`)
    expect(res.status).toBe(404)
  })

  it('POST 能读到 JSON body', async () => {
    const { server, base } = await start()
    server.post('/api/echo', (context) => context.body)

    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试' }),
    })
    expect(await res.json()).toEqual({ name: '测试' })
  })

  it('处理器抛 HttpError 时用它的状态码', async () => {
    const { server, base } = await start()
    server.get('/api/missing', () => {
      throw new HttpError(404, '不存在')
    })

    const res = await fetch(`${base}/api/missing`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: '不存在' })
  })

  it('处理器抛普通错误时收敛成 502', async () => {
    const { server, base } = await start()
    server.get('/api/boom', () => {
      throw new Error('炸了')
    })

    const res = await fetch(`${base}/api/boom`)
    expect(res.status).toBe(502)
  })
})

describe('WebServer — 前缀路由与优先级', () => {
  it('前缀路由能取到 :name 参数', async () => {
    const { server, base } = await start()
    server.prefix('GET', '/api/workflows/:file', (context) => ({ file: context.params.file }))

    const res = await fetch(`${base}/api/workflows/a.json`)
    expect(await res.json()).toEqual({ file: 'a.json' })
  })

  it('精确路由优先于前缀路由', async () => {
    const { server, base } = await start()
    // 先注册前缀，再注册精确——精确仍必须赢
    server.prefix('GET', '/api/workflows/:file', () => ({ from: 'prefix' }))
    server.get('/api/workflows/rename', () => ({ from: 'exact' }))

    const res = await fetch(`${base}/api/workflows/rename`)
    expect(await res.json()).toEqual({ from: 'exact' })
  })

  it('同一路由重复注册会抛错', async () => {
    const { server } = await start()
    server.get('/api/dup', () => 1)
    expect(() => server.get('/api/dup', () => 2)).toThrow(/重复注册/u)
  })

  it('注销函数能移除路由', async () => {
    const { server, base } = await start()
    const off = server.get('/api/temp', () => ({ ok: true }))
    off()

    const res = await fetch(`${base}/api/temp`)
    expect(res.status).toBe(404)
  })
})

describe('WebServer — CORS', () => {
  it('OPTIONS 预检返回 204 且带 CORS 头', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/anything`, { method: 'OPTIONS' })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('普通响应也带 CORS 头', async () => {
    const { server, base } = await start()
    server.get('/api/x', () => ({ ok: true }))

    const res = await fetch(`${base}/api/x`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('WebServer — fallback', () => {
  it('未匹配路由时走 fallback', async () => {
    const ctx = new Context()
    const server = new WebServer(ctx as never, {
      port: 0,
      fallback: (context) => ({ fallback: context.pathname }),
    })
    servers.push(server)
    const port = await server.listen()

    const res = await fetch(`http://127.0.0.1:${port}/anything`)
    expect(await res.json()).toEqual({ fallback: '/anything' })
  })
})
