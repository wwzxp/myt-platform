/**
 * `@myt/kernel` 的包入口。
 *
 * 内核启动器：`startKernel(options)` 创建 Cordis 容器、装配插件树、起 HTTP 服务。
 * 具体实现在 `kernel.ts`；这里只做导出，让 `main` / `exports` 指向标准的 `index`。
 */

export { startKernel } from './kernel.ts'
export type { KernelOptions, KernelHandle } from './kernel.ts'
export { FlowTaskRunner } from './flow-task.ts'
