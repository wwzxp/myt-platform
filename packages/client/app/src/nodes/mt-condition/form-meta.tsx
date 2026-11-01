/**
 * 条件节点的表单（中文）。
 *
 * 我们的条件语义与 demo 不同：demo 是「动态条件行」，我们是三种固定判断：
 * 页面是否属于某组 / 元素是否存在 / 参数是否非空。
 *
 * 数据存在 `data.inputsValues` 里，与画布其它节点同构。
 */
import { useEffect, useState } from 'react'

import {
  Field,
  FormMeta,
  FormRenderProps,
  GlobalScope,
  ValidateTrigger,
  useService,
  WorkflowDocument,
} from '@flowgram.ai/free-layout-editor'
import type { IFlowValue } from '@flowgram.ai/form-materials'
import { Input, Select } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem } from '../../form-components'
import { FlowNodeJSON } from '../../typings'
import { WorkflowNodeType } from '../constants'
import { GetGlobalVariableSchema } from '../../plugins/variable-panel-plugin'

/**
 * 「页面是」的页面选择。
 *
 * 页面 id 来自流程的**页面表**（`globalVariable.app.pages`），不是自由文本，
 * 所以做成多选下拉；页面表里加一条，这里就多一个选项。
 * 长解释放标签的悬浮提示里，不占表单空间。
 */
function PageSelectField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const getSchema = useService(GetGlobalVariableSchema) as () => unknown
  const globalScope = useService(GlobalScope)
  const [, bump] = useState(0)

  // 页面表改了要立刻反映到选项上；节点不订阅全局变量就不会重渲染。
  useEffect(() => {
    const disposable = globalScope.output.onListOrAnyVarChange(() => bump((n) => n + 1))
    return () => disposable.dispose()
  }, [globalScope])
  const schema = getSchema() as
    | { properties?: Record<string, { default?: { pages?: Array<{ id?: string; title?: string }> } }> }
    | undefined
  const pages = (schema?.properties?.['app']?.default?.pages ?? []).filter(
    (page): page is { id: string; title?: string } => typeof page?.id === 'string' && page.id.trim() !== '',
  )

  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const title = pages.length
    ? `可填：${pages.map((page) => (page.title ? `${page.title} ${page.id}` : page.id)).join('、')}
要加新界面，得先在「页面表」里登记它（页面 id + 识别特征），否则这里填了也认不出。`
    : '还没有页面表；先到「变量面板 → 页面表」里加一条'

  return (
    <FormItem name="页面" title={title} description="可多选，命中任一即成立">
      <Select
        multiple
        value={selected}
        onChange={(v) => onChange((v as string[]).join(','))}
        optionList={pages.map((page) => ({
          value: page.id,
          label: page.title ? `${page.title}（${page.id}）` : page.id,
        }))}
        placeholder={pages.length ? '选择一个或多个页面' : '页面表是空的'}
        emptyContent="页面表是空的"
        style={{ width: '100%' }}
      />
    </FormItem>
  )
}

/**
 * 「参数名」字段。
 *
 * 参数由「开始」节点声明；这里显示**中文名**，不再把 `imagePaths` 这种键名摆在用户面前。
 * 参数的值由用户在「试运行」面板里填（那里有对应输入框）。
 */
function ParamNameField({
  paramKey,
  onKeyChange,
}: {
  paramKey: string
  onKeyChange: (value: string) => void
}) {
  const document = useService(WorkflowDocument)
  const key = paramKey.trim()
  const startNode = document.root.blocks.find((node) => node.flowNodeType === WorkflowNodeType.Start)
  const schema = startNode?.form?.getValueIn<{
    properties?: Record<string, { title?: string; description?: string }>
  }>('outputs')
  const property = key ? schema?.properties?.[key] : undefined

  if (property) {
    return (
      <FormItem name="看哪个输入" description="这个判断检查的输入项">
        <Input value={property.title ?? key} disabled />
        <div style={{ fontSize: 11, opacity: 0.65 }}>
          {property.description ? `${property.description}；` : ''}在「试运行」里填它
        </div>
      </FormItem>
    )
  }

  return (
    <FormItem name="看哪个输入" description="「开始」里声明的参数">
      <Input
        value={String(paramKey ?? '')}
        onChange={onKeyChange}
        placeholder="如 imagePaths"
        title="该参数非空时走「成立」出口"
      />
      {key ? (
        <div style={{ fontSize: 11, color: 'var(--semi-color-warning)' }}>
          「{key}」没有在「开始」里声明，运行时可能取不到值
        </div>
      ) : null}
    </FormItem>
  )
}

/** 条件类型。 */
const CONDITION_KINDS = [
  { value: 'page', label: '页面是' },
  { value: 'exists', label: '元素存在' },
  { value: 'param', label: '参数非空' },
  { value: 'apkInstalled', label: '设备已装某应用' },
  { value: 'fileExists', label: '设备上有某文件' },
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
                <PageSelectField value={String(expect ?? '')} onChange={(v) => setExpect(v)} />
              ))}

            {kind === 'param' &&
              constantField('judgeKey', ({ value: key, set: setKey }) => (
                <ParamNameField paramKey={String(key ?? '')} onKeyChange={(v) => setKey(v)} />
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

            {kind === 'apkInstalled' &&
              constantField('judgePackage', ({ value: pkg, set: setPkg }) => (
                <FormItem name="应用名" description="包名或其中一段都行">
                  <Input
                    value={String(pkg ?? '')}
                    onChange={(v) => setPkg(String(v))}
                    placeholder="如 adbkeyboard"
                    title="执行 pm list packages <应用名>，输出里有它就走「成立」出口"
                  />
                </FormItem>
              ))}

            {kind === 'fileExists' &&
              constantField('judgePath', ({ value: path, set: setPath }) => (
                <FormItem name="文件路径" description="设备上的绝对路径">
                  <Input
                    value={String(path ?? '')}
                    onChange={(v) => setPath(String(v))}
                    placeholder="如 /data/local/tmp/yadb"
                    title="执行 ls <路径>，不报错就走「成立」出口"
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
