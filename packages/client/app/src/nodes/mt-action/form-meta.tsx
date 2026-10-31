/**
 * 动作节点的表单（节点内直接编辑 + 右侧面板）。
 *
 * 中文文案 + 悬浮释义（界面设计规范）：标签用大众词，专业词配 title 解释。
 *
 * 数据存在 `data.inputsValues` 里，与画布其它节点同构（常量 / 引用 / 模板）。
 * 本表单只编辑「常量」；`ref` / `template` 属于高级用法，这里只读展示，
 * 不覆盖用户手写的值。
 */
import { Field, FormMeta, FormRenderProps, ValidateTrigger } from '@flowgram.ai/free-layout-editor'
import type { IFlowValue } from '@flowgram.ai/form-materials'
import { Input, InputNumber, Select } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

/** 「怎么做」的中文名与释义。 */
const ACT_KINDS = [
  { value: 'tap', label: '点击' },
  { value: 'input', label: '输入文字' },
  { value: 'swipe', label: '滑动' },
  { value: 'back', label: '按返回键' },
  { value: 'openUri', label: '打开链接' },
  { value: 'sleep', label: '等待' },
  { value: 'custom', label: '自定义动作' },
]

/** 「怎么找」的三种方式。 */
const LOCATE_MODES = [
  { value: 'intent', label: '按文字找' },
  { value: 'ratio', label: '按屏幕比例' },
  { value: 'point', label: '按像素坐标' },
]

/** 读常量内容；非常量（引用 / 模板）返回 undefined。 */
function constOf(value: IFlowValue | undefined): unknown {
  return value?.type === 'constant' ? value.content : undefined
}

/** 包成常量值。 */
function asConst(content: unknown): IFlowValue {
  return { type: 'constant', content } as IFlowValue
}

/** 非常量值的可读展示（如 `{{start.keyword}}`）。 */
function displayOf(value: IFlowValue | undefined): string {
  if (!value) return ''
  if (value.type === 'ref') return `{{${(value.content as string[]).join('.')}}}`
  if (value.type === 'template') return String(value.content)
  return ''
}

/** 绑一个常量到 `inputsValues[key]`。 */
function constantField(key: string, render: (args: {
  value: unknown
  set: (content: unknown) => void
  /** 非空表示当前是引用/模板，表单只读。 */
  lockedHint: string | undefined
}) => React.ReactElement) {
  return (
    <Field<IFlowValue | undefined> name={`inputsValues.${key}`}>
      {({ field }) => {
        const locked = field.value !== undefined && field.value.type !== 'constant'
        return render({
          value: constOf(field.value),
          set: (content) => field.onChange(asConst(content)),
          lockedHint: locked ? displayOf(field.value) : undefined,
        })
      }}
    </Field>
  )
}

export const renderForm = (_props: FormRenderProps<FlowNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      {constantField('locateMode', ({ value, set }) => {
        const mode = String(value ?? 'intent')
        return (
          <>
            <FormItem name="怎么找" description="用哪种方式确定目标位置">
              <Select
                value={mode}
                onChange={(v) => set(String(v))}
                optionList={LOCATE_MODES}
              />
            </FormItem>

            {mode === 'intent' &&
              constantField('locateIntent', ({ value: intent, set: setIntent, lockedHint }) => (
                <FormItem name="找什么" description="界面上能看到的文字">
                  <Input
                    value={lockedHint ?? String(intent ?? '')}
                    disabled={lockedHint !== undefined}
                    onChange={(v) => setIntent(String(v))}
                    placeholder="界面上能看到的文字，如：添加标题"
                    title="填写界面上真实显示的文字，AI 会按这段文字在屏幕上找目标"
                  />
                </FormItem>
              ))}

            {mode === 'ratio' && (
              <>
                <FormItem name="横向位置" description="0 = 最左，1 = 最右">
                  {constantField('locateRatioX', ({ value: x, set }) => (
                    <InputNumber
                      value={Number(x ?? 0.5)}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => set(Number(v ?? 0))}
                      title="按屏幕宽度的比例定位，换机型也不会失效"
                    />
                  ))}
                </FormItem>
                <FormItem name="纵向位置" description="0 = 最上，1 = 最下">
                  {constantField('locateRatioY', ({ value: y, set }) => (
                    <InputNumber
                      value={Number(y ?? 0.5)}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => set(Number(v ?? 0))}
                      title="按屏幕高度的比例定位，换机型也不会失效"
                    />
                  ))}
                </FormItem>
              </>
            )}

            {mode === 'point' && (
              <>
                <FormItem name="横向像素" description="从屏幕左边缘算起">
                  {constantField('locatePointX', ({ value: x, set }) => (
                    <InputNumber
                      value={Number(x ?? 0)}
                      min={0}
                      onChange={(v) => set(Number(v ?? 0))}
                      title="绝对像素坐标；换机型可能失效，优先用「按屏幕比例」"
                    />
                  ))}
                </FormItem>
                <FormItem name="纵向像素" description="从屏幕顶边算起">
                  {constantField('locatePointY', ({ value: y, set }) => (
                    <InputNumber
                      value={Number(y ?? 0)}
                      min={0}
                      onChange={(v) => set(Number(v ?? 0))}
                      title="绝对像素坐标；换机型可能失效，优先用「按屏幕比例」"
                    />
                  ))}
                </FormItem>
              </>
            )}
          </>
        )
      })}

      {constantField('actKind', ({ value, set }) => (
        <FormItem name="做什么" required description="这一步在手机上执行的动作">
          <Select
            value={String(value ?? 'tap')}
            onChange={(v) => set(String(v))}
            optionList={ACT_KINDS}
          />
        </FormItem>
      ))}

      {constantField('actKind', ({ value }) => {
        const kind = String(value ?? 'tap')
        if (kind === 'input') {
          return constantField('actText', ({ value: text, set, lockedHint }) => (
            <FormItem name="输入内容">
              <Input
                value={lockedHint ?? String(text ?? '')}
                disabled={lockedHint !== undefined}
                onChange={(v) => set(String(v))}
                placeholder="要输入的文字"
                title="可以直接写文字，也可以在变量面板里改成引用上游节点的输出"
              />
            </FormItem>
          ))
        }
        if (kind === 'openUri') {
          return constantField('actUri', ({ value: uri, set, lockedHint }) => (
            <FormItem name="链接">
              <Input
                value={lockedHint ?? String(uri ?? '')}
                disabled={lockedHint !== undefined}
                onChange={(v) => set(String(v))}
                placeholder="如 xhsdiscover://profile"
                title="手机上的深链，点开直接进入对应页面"
              />
            </FormItem>
          ))
        }
        if (kind === 'custom') {
          return constantField('actName', ({ value: name, set, lockedHint }) => (
            <FormItem name="动作名">
              <Input
                value={lockedHint ?? String(name ?? '')}
                disabled={lockedHint !== undefined}
                onChange={(v) => set(String(v))}
                placeholder="如 prepareEnvironment"
                title="由业务包注册的动作标识，需与后端一致"
              />
            </FormItem>
          ))
        }
        return <></>
      })}

      {constantField('requires', ({ value, set }) => (
        <FormItem name="前置页面" description="不在这些页面就跳到「页面不对」">
          <Input
            value={String(value ?? '')}
            onChange={(v) => set(String(v))}
            placeholder="留空表示不检查；多个用英文逗号分隔"
            title="填页面 id，如 permission,album。当前页面不匹配时走「页面不对」出口"
          />
        </FormItem>
      ))}

      {constantField('settle', ({ value, set }) => (
        <FormItem name="执行后等待" description="秒，如 0.5,1.5">
          <Input
            value={String(value ?? '')}
            onChange={(v) => set(String(v))}
            placeholder="留空表示不额外等待"
            title="动作完成后随机等待这段区间，避免操作过快被风控"
          />
        </FormItem>
      ))}
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
