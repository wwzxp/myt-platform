/**
 * 小红书业务包装配。
 *
 * 三个包各自注册自己的流程到 `ctx.flows`，并把 UI 动作与链配方暴露成本
 * 服务的属性，供 `@myt/xhs-login` 与 HTTP 层读取。
 *
 * 为什么单独成一个插件：流程注册有依赖顺序（设备原语 → 登录 → 发布），
 * 且需要宿主能力（识图 / S5 代理）。这些是「装配」而不是「业务逻辑」，
 * 放在 HTTP 插件里会让后者认识具体流程 id。
 */

import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强
import type {} from '@myt/flow'
import type {} from '@myt/myt-host'
import type { ActionDefinition, ChainRecipe, FlowPack } from '@myt/flow'
import { xhsPack as basePack } from '@myt/flow-xhs/pack'
import { xhsDevicePack } from '@myt/flow-xhs-device/pack'
import { xhsPublishPack } from '@myt/flow-xhs-publish/pack'
import { solveSafetyVerification } from '@myt/xhs-login/tabs/llm-config'
import { loadLlmConfig } from '@myt/xhs-login/tabs/llm-config'

/** 业务包服务的对外形状。 */
export interface XhsPackService {
  /** 全部 UI 动作（设备包 + 登录包）。发布包不暴露动作。 */
  readonly actions: ReadonlyArray<ActionDefinition>
  /** 登录链配方。 */
  readonly chain: ChainRecipe
  /** 三个包，供诊断与列表。 */
  readonly packs: ReadonlyArray<FlowPack>
}

/** 装配配置。 */
export interface XhsPackConfig {
  /** 数据目录；LLM 配置存在这里。 */
  dataDir: string
}

/**
 * 小红书业务装配。
 *
 * 注册全部流程并暴露业务数据；不认识 HTTP，也不执行任何流程。
 */
export class XhsPack extends Service implements XhsPackService {
  static inject = ['flows', 'mytHost']

  readonly actions: ReadonlyArray<ActionDefinition>
  readonly chain: ChainRecipe
  readonly packs: ReadonlyArray<FlowPack>

  private readonly llmConfigFile: string

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: XhsPackConfig) {
    super(ctx, 'xhsPack')
    this.llmConfigFile = join(config.dataDir, 'llm-config.json')

    // 设备包：clear / backup / modify-profile / follow / bind-phone 等。
    xhsDevicePack.register(ctx.flows, {})

    // 登录包：需要识图与 S5 代理两个宿主能力。
    basePack.register(ctx.flows, {
      solveSafety: async (image, params) => {
        const llm = await loadLlmConfig(this.llmConfigFile)
        return solveSafetyVerification(
          {
            baseUrl: params['llmBaseUrl'] || llm.baseUrl,
            model: params['llmModel'] || llm.model,
            apiKey: params['llmApiKey'] || llm.apiKey,
          },
          image,
        )
      },
      host: {
        setS5Proxy: (options) => ctx.mytHost.setS5Proxy(options),
      },
    })

    // 发布包：与上号完全解耦，只注册流程。
    xhsPublishPack.register(ctx.flows, {})

    this.actions = [...(xhsDevicePack.actions ?? []), ...(basePack.actions ?? [])]
    this.chain = basePack.chain as ChainRecipe
    this.packs = [xhsDevicePack, basePack, xhsPublishPack]
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    xhsPack: XhsPack
  }
}

export default XhsPack
