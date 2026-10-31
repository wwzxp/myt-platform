/**
 * 循环节点的表单（中文）。
 */
import { Field, FormMeta, FormRenderProps, ValidateTrigger } from '@flowgram.ai/free-layout-editor'
import { InputNumber } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

export const renderForm = ({ form }: FormRenderProps<FlowNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      <FormItem name="最多重复几次" required>
        <Field<number> name="loopFor.max">
          {({ field }) => (
            <InputNumber
              value={field.value ?? 3}
              min={1}
              max={100}
              onChange={(v) => field.onChange(Number(v) || 1)}
              title="循环体最多执行几轮"
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
    'loopFor.max': ({ value }: { value: number }) => (value && value >= 1 ? undefined : '至少 1 次'),
  },
}
