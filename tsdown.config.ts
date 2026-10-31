/**
 * tsdown 配置：把 tsc 产物打包成 lib/index.js。
 *
 * 与 dsh 的 tsdown.config.ts 同构：vendor / packages / apps / native 全量构建，
 * 并挂 typertPlugin 生成 Host→Client 的类型化 RPC 反射产物。
 *
 * 前置：必须先跑 tsc -b tsconfig.host.json 生成 lib/types/。
 */
import { globSync } from 'node:fs'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'
import { WORKSPACE_TYPERT_FACES } from './scripts/typert-faces.ts'

/** 把 manifest 路径列表转成包目录列表。 */
function workspacePackageGlobs(manifests: readonly string[]): string[] {
  return manifests.map((path) => {
    const normalized = path.replaceAll('\\', '/')
    const idx = normalized.lastIndexOf('/')
    return idx === -1 ? '.' : normalized.slice(0, idx)
  })
}

export default defineConfig(() => {
  // 我们的 Electron 壳（myt-desktop）用 src/main.cjs 直接跑，不参与 TS 打包
  // 不参与 tsdown 打包的包：Electron 壳（.cjs）与 rsbuild 构建的前端应用
  const SKIP = new Set(['packages/app/desktop', 'packages/client/app'])
  const packages = workspacePackageGlobs(
    globSync(['vendor/*/package.json', 'packages/*/*/package.json'], {
      cwd: import.meta.dirname,
    }),
  ).filter((dir) => !SKIP.has(dir))
  return {
    // 与 dsh 一致：apps 里只有 cli 与 desktop-host 参与 tsdown 打包
    workspace: [...packages, 'apps/cli', 'apps/desktop-host'],
    entry: ['lib/types/{index,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: [typertPlugin({ mode: 'workspace', faces: WORKSPACE_TYPERT_FACES })],
  }
})
