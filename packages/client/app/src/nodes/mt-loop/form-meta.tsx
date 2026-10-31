/**
 * 循环节点的表单（中文）。
 */
import { Field, FormMeta, FormRenderProps, ValidateTrigger } from '@flowgram.ai/free-layout-editor'
import type { IFlowValue } from '@flowgram.ai/form-materials'
import { InputNumber } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

export const renderForm = ({ form }: FormRenderProps<FlowNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      <FormItem name="最多重复几次" required>
        <Field<IFlowValue | undefined> name="inputsValues.loopMax">
          {({ field }) => (
            <InputNumber
              value={Number(field.value?.type === 'constant' ? field.value.content : 3)}
              min={1}
              max={100}
              onChange={(v) =>
                field.onChange({ type: 'constant', content: Number(v) || 1 } as IFlowValue)
              }
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
    'inputsValues.loopMax': ({ value }: { value: IFlowValue }) =>
      (value?.type === 'constant' && Number(value.content) >= 1 ? undefined : '至少 1 次'),
  },
}
