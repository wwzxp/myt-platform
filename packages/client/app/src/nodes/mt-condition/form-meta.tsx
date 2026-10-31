/**
 * 条件节点的表单（中文）。
 *
 * 我们的条件语义与 demo 不同：demo 是「动态条件行」，我们是三种固定判断：
 * 页面是否属于某组 / 元素是否存在 / 参数是否非空。
 */
import { Field, FormMeta, FormRenderProps, ValidateTrigger } from '@flowgram.ai/free-layout-editor'
import { Input, Select } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

/** 条件类型。 */
const CONDITION_KINDS = [
  { value: 'page', label: '页面是' },
  { value: 'exists', label: '元素存在' },
  { value: 'param', label: '参数非空' },
]

export const renderForm = ({ form }: FormRenderProps<FlowNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      <FormItem name="判断方式" required description="先判断一下，再决定走哪条路">
        <Field<string> name="judge.kind">
          {({ field }) => (
            <Select
              value={field.value ?? 'page'}
              onChange={(v) => field.onChange(String(v))}
              optionList={CONDITION_KINDS}
            />
          )}
        </Field>
      </FormItem>

      <FormItem name="页面 / 参数">
        <Field<string> name="judge.value">
          {({ field }) => (
            <Input
              value={field.value ?? ''}
              onChange={(v) => field.onChange(String(v))}
              placeholder="页面 id（如 post-editor）或参数名（如 title）"
              title="判断方式为「页面是」时填页面 id；为「参数非空」时填参数名"
            />
          )}
        </Field>
      </FormItem>
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
