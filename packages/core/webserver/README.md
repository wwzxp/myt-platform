# @myt/webserver

HTTP 路由服务（Cordis 服务键 `ctx.http`）。

## 职责

- ✅ 监听端口、分发路由、CORS、JSON 编解码、错误收敛
- ❌ **不认识任何业务概念**（设备、流程、运行……都由插件自己注册）

## 为什么有这个包

原先 `packages/app/kernel/src/kernel.ts` 里硬编码了 47 个 `if (url.pathname === …)`，
任何插件想提供 API 都必须去改 kernel。这违背 ADR-0001「业务全部写成插件」。

本包把「注册路由」这一件事抽出来，对齐 dsh 的 `dsh-host-webserver`。

## 对外契约

```ts
ctx.http.get('/api/workflows', handler)
ctx.http.post('/api/workflows', handler)
ctx.http.put('/', handler)
ctx.http.delete('/', handler)
ctx.http.prefix('GET', '/api/workflows/:file', handler)   // 路径参数
ctx.http.setFallback(handler)                              // 未匹配时兜底
await ctx.http.listen()                                    // 由宿主调用
```

处理器签名：`(context: RouteContext) => unknown | Promise<unknown>`

- 返回值序列化为 JSON
- 抛 `HttpError(status, message)` 用它的状态码
- 抛普通错误收敛为 502
- 处理器自己写响应（SSE）时，框架不重复写

## 路由优先级

**先注册精确路由，再注册前缀路由。** 匹配时精确路由永远优先，
所以 `/api/workflows/rename` 不会被 `/api/workflows/:file` 抢走。

```ts
ctx.http.post('/api/workflows/rename', ...)      // 精确，先注册
ctx.http.prefix('GET', '/api/workflows/:file')   // 前缀，后注册
```

## CORS

默认开启。前端 dev server 在 `:3000`、内核在 `:7788`，缺 CORS 头时浏览器直接拦截
`OPTIONS` 预检，**内核日志里连请求都看不到**——排查时容易误判为业务错误。

## 依赖的接缝

- `@deepseek-ai/cordis`：`Service` 生命周期

## 失效模式

| 现象 | 原因 |
|---|---|
| 路由 404 但代码写对了 | 前缀路由注册在精确路由之前 |
| 浏览器报 `Internal Server Error` 但服务端无日志 | CORS 未开启 |
| `cannot get property "x" without inject` | 插件没写 `static inject = ['http']` |
