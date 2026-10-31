/**
 * 动作节点的表单（节点内直接编辑 + 右侧面板）。
 *
 * 中文文案 + 悬浮释义（界面设计规范）：标签用大众词，专业词配 title 解释。
 */
import { Field, FormMeta, FormRenderProps, ValidateTrigger } from '@flowgram.ai/free-layout-editor'
import { Input, Select } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

/** 执行方式的中文名与释义。 */
const ACT_KINDS = [
  { value: 'tap', label: '点击' },
  { value: 'input', label: '输入文字' },
  { value: 'swipe', label: '滑动' },
  { value: 'back', label: '按返回键' },
  { value: 'openUri', label: '打开链接' },
  { value: 'sleep', label: '等待' },
  { value: 'custom', label: '自定义动作' },
]

export const renderForm = ({ form }: FormRenderProps<FlowNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      <FormItem name="找什么" description="界面上能看到的文字">
        <Field<string> name="locate.intent">
          {({ field }) => (
            <Input
              value={field.value ?? ''}
              onChange={(v) => field.onChange(String(v))}
              placeholder="界面上能看到的文字，如：添加标题"
              title="填写界面上真实显示的文字，AI 会按这段文字在屏幕上找目标"
            />
          )}
        </Field>
      </FormItem>

      <FormItem name="做什么" required description="这一步在手机上执行的动作">
        <Field<string> name="act.kind">
          {({ field }) => (
            <Select
              value={field.value ?? 'tap'}
              onChange={(v) => field.onChange(String(v))}
              optionList={ACT_KINDS}
            />
          )}
        </Field>
      </FormItem>

      <FormItem name="输入内容">
        <Field<string> name="act.text">
          {({ field }) => (
            <Input
              value={field.value ?? ''}
              onChange={(v) => field.onChange(String(v))}
              placeholder="要输入的文字；填流程参数名则取参数值"
              title="可以直接写文字，也可以写流程参数名（运行时从参数取）"
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
