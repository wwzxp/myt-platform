/**
 * tsdown 配置：把 tsc 产物打包成 lib/index.js。
 *
 * 与 dsh 的 tsdown.config.ts 同构，两处调整：
 *   1. workspace 只包含 vendor 与 packages 下的包（dsh 还含 apps）
 *   2. 去掉 typertPlugin，我们当前不使用该 RPC 层
 *
 * 前置：必须先跑 tsc -b tsconfig.vendor.json 生成 lib/types/。
 */
import { globSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/** 把 manifest 路径列表转成包目录列表。 */
function workspacePackageGlobs(manifests: readonly string[]): string[] {
  return manifests.map((path) => {
    const normalized = path.replaceAll('\\', '/')
    const idx = normalized.lastIndexOf('/')
    return idx === -1 ? '.' : normalized.slice(0, idx)
  })
}

export default defineConfig(() => {
  const packages = workspacePackageGlobs(
    globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/*/package.json'], {
      cwd: import.meta.dirname,
    }),
  )
  return {
    workspace: packages,
    entry: ['lib/types/{index,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})
