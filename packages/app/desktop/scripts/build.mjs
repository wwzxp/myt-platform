import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * 把主进程的 TypeScript 模块编译成 CJS。
 *
 * `main.cjs` 是 Electron 直接加载的入口，无法 require TypeScript；
 * 这里把纯逻辑模块（目前只有 `data-dir.ts`）打成 `data-dir.cjs`，
 * 主进程用 `require('./data-dir.cjs')` 使用。
 *
 * 为什么不把 main.cjs 也改成 TS：它是 Electron 的 `main` 字段，
 * 保持 .cjs 可以让 `electron .` 直接跑，不需要先构建。
 */
await build({
  entryPoints: [src + 'data-dir.ts'],
  outfile: src + 'data-dir.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'info',
})
