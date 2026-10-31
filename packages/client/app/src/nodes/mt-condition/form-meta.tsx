/**
 * 条件节点的表单（中文）。
 *
 * 我们的条件语义与 demo 不同：demo 是「动态条件行」，我们是三种固定判断：
 * 页面是否属于某组 / 元素是否存在 / 参数是否非空。
 *
 * 数据存在 `data.inputsValues` 里，与画布其它节点同构。
 */
import { Field, FormMeta, FormRenderProps, ValidateTrigger } from '@flowgram.ai/free-layout-editor'
import type { IFlowValue } from '@flowgram.ai/form-materials'
import { Input, Select } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

/** 条件类型。 */
const CONDITION_KINDS = [
  { value: 'page', label: '页面是' },
  { value: 'exists', label: '元素存在' },
  { value: 'param', label: '参数非空' },
]

/** 读常量内容；非常量（引用 / 模板）返回 undefined。 */
function constOf(value: IFlowValue | undefined): unknown {
  return value?.type === 'constant' ? value.content : undefined
}

/** 包成常量值。 */
function asConst(content: unknown): IFlowValue {
  return { type: 'constant', content } as IFlowValue
}

/** 绑一个常量到 `inputsValues[key]`。 */
function constantField(
  key: string,
  render: (args: { value: unknown; set: (content: unknown) => void }) => React.ReactElement,
) {
  return (
    <Field<IFlowValue | undefined> name={`inputsValues.${key}`}>
      {({ field }) =>
        render({
          value: constOf(field.value),
          set: (content) => field.onChange(asConst(content)),
        })
      }
    </Field>
  )
}

export const renderForm = (_props: FormRenderProps<FlowNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      {constantField('judgeKind', ({ value, set }) => {
        const kind = String(value ?? 'page')
        return (
          <>
            <FormItem name="判断方式" required description="先判断一下，再决定走哪条路">
              <Select
                value={kind}
                onChange={(v) => set(String(v))}
                optionList={CONDITION_KINDS}
              />
            </FormItem>

            {kind === 'page' &&
              constantField('judgeExpect', ({ value: expect, set: setExpect }) => (
                <FormItem name="页面 id" description="多个用英文逗号分隔">
                  <Input
                    value={String(expect ?? '')}
                    onChange={(v) => setExpect(String(v))}
                    placeholder="如 permission,album"
                    title="当前页面属于其中任意一个时走「成立」出口"
                  />
                </FormItem>
              ))}

            {kind === 'param' &&
              constantField('judgeKey', ({ value: key, set: setKey }) => (
                <FormItem name="参数名">
                  <Input
                    value={String(key ?? '')}
                    onChange={(v) => setKey(String(v))}
                    placeholder="如 title"
                    title="该参数非空时走「成立」出口"
                  />
                </FormItem>
              ))}

            {kind === 'exists' &&
              constantField('judgeLocateIntent', ({ value: intent, set: setIntent }) => (
                <FormItem name="找什么" description="屏幕上能看到的文字">
                  <Input
                    value={String(intent ?? '')}
                    onChange={(v) => setIntent(String(v))}
                    placeholder="如在屏幕上找「允许」"
                    title="找到该元素走「成立」出口，找不到走「不成立」"
                  />
                </FormItem>
              ))}
          </>
        )
      })}
    </FormContent>
  </>
)

export const formMeta: FormMeta<FlowNodeJSON> = {
  render: renderForm,
  validateTrigger: ValidateTrigger.onChange,
  validate: {
    title: ({ value }: { value: string }) => (value ? undefined : '请填写节点名称'),
  },
}
