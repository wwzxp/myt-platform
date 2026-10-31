import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const outdir = fileURLToPath(new URL('../dist/', import.meta.url))

/**
 * 打包内核为单文件 ESM。
 *
 * Electron 的 utilityProcess 只能用 JS，而源码是 TS + workspace 包；
 * 这里把 `@myt/*` 与 Cordis 一并打进去，产物目录不再需要 node_modules。
 */
await build({
  entryPoints: [fileURLToPath(new URL('../src/host.ts', import.meta.url))],
  outfile: `${outdir}host.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // Electron utilityProcess 是 Node 环境，Node 内置模块保持外部依赖。
  external: ['electron'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
