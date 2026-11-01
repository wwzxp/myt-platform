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
import { Input, InputNumber, Select, TextArea } from '@douyinfe/semi-ui'

import { FormHeader, FormContent, FormItem, PageMultiSelect } from '../../form-components'
import { FlowNodeJSON } from '../../typings'

/** 「怎么做」的中文名与释义。 */
const ACT_KINDS = [
  { value: 'tap', label: '点击' },
  { value: 'input', label: '输入文字' },
  { value: 'swipe', label: '滑动' },
  { value: 'back', label: '按返回键' },
  { value: 'openUri', label: '打开链接' },
  { value: 'sleep', label: '等待' },
  { value: 'waitPage', label: '等页面出现' },
  { value: 'waitElement', label: '等元素出现' },
  { value: 'tapLocator', label: '点（按定位器）' },
  { value: 'tapText', label: '点（按文字）' },
  { value: 'pickImages', label: '按数量选图' },
  { value: 'push', label: '推送文件' },
  { value: 'pushToGallery', label: '推送到相册' },
  { value: 'installApp', label: '安装应用' },
  { value: 'enableIme', label: '启用输入法' },
  { value: 'adb', label: '设备命令' },
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
      {/* 只有「点击」「输入文字」需要先在屏幕上找目标。
          其余动作（按返回键/打开链接/等待/滑动/自定义动作）由引擎直接执行，
          根本不走定位——之前照样显示「怎么找」「找什么」，会让人以为必须填。 */}
      {constantField('actKind', ({ value: kindValue }) => {
        const kind = String(kindValue ?? 'tap')
        if (kind !== 'tap' && kind !== 'input') return <></>
        return (
          <>
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
        if (kind === 'adb') {
          return constantField('actArgs', ({ value: args, set, lockedHint }) => (
            <FormItem
              name="设备命令"
              description="adb -s 设备 后面的部分，原样执行"
            >
              <Input
                value={lockedHint ?? String(args ?? '')}
                disabled={lockedHint !== undefined}
                onChange={(v) => set(String(v))}
                placeholder="如 shell pm list packages adbkeyboard"
                title="直接执行 adb 子命令，不做限制：可以是 shell …、push 本地 远端、install … 等。路径带空格用引号包起来。"
              />
            </FormItem>
          ))
        }
        if (kind === 'push') {
          return (
            <>
              {constantField('actSrc', ({ value: src, set, lockedHint }) => (
                <FormItem name="本地路径" description="要推到手机上的文件">
                  <Input
                    value={lockedHint ?? String(src ?? '')}
                    disabled={lockedHint !== undefined}
                    onChange={(v) => set(String(v))}
                    placeholder="如 D:/tools/yadb"
                    title="文件名会沿用到手机上；默认是随包内置的 yadb，换文件直接改这段路径"
                  />
                </FormItem>
              ))}
              {constantField('actDestDir', ({ value: dir, set, lockedHint }) => (
                <FormItem name="放到哪个目录" description="默认临时目录">
                  <Input
                    value={lockedHint ?? String(dir ?? '')}
                    disabled={lockedHint !== undefined}
                    onChange={(v) => set(String(v))}
                    placeholder="默认 /data/local/tmp/"
                    title="文件会放到这个目录下，文件名不变"
                  />
                </FormItem>
              ))}
            </>
          )
        }
        if (kind === 'pushToGallery') {
          return constantField('actImages', ({ value: images, set, lockedHint }) => (
            <FormItem name="图片路径" description="本地图片，多张用逗号或换行分隔">
              <TextArea
                autosize={{ minRows: 2, maxRows: 6 }}
                value={lockedHint ?? String(images ?? '')}
                disabled={lockedHint !== undefined}
                onChange={(v) => set(String(v))}
                placeholder="如 D:/pics/a.png"
                title="这些图片会先推进手机相册，发布时再从相册里选。不填就没图可发。"
              />
            </FormItem>
          ))
        }
        if (kind === 'installApp') {
          return (
            <>
              {constantField('actSrc', ({ value: src, set, lockedHint }) => (
                <FormItem name="安装包" description="本地 APK 文件">
                  <Input
                    value={lockedHint ?? String(src ?? '')}
                    disabled={lockedHint !== undefined}
                    onChange={(v) => set(String(v))}
                    placeholder="如 D:/apk/ADBKeyboard.apk"
                    title="会先推到手机上再安装；默认是随包内置的 ADBKeyboard，换文件直接改这段路径"
                  />
                </FormItem>
              ))}
              {constantField('actAppName', ({ value: name, set, lockedHint }) => (
                <FormItem name="应用名" description="给这个节点起个可读名字">
                  <Input
                    value={lockedHint ?? String(name ?? '')}
                    disabled={lockedHint !== undefined}
                    onChange={(v) => set(String(v))}
                    placeholder="如 ADBKeyboard"
                    title="仅用于标题和报错提示，不参与安装校验"
                  />
                </FormItem>
              ))}
            </>
          )
        }
        if (kind === 'enableIme') {
          return constantField('actIme', ({ value: ime, set, lockedHint }) => (
            <FormItem name="输入法" description="填名称的一部分即可">
              <Input
                value={lockedHint ?? String(ime ?? '')}
                disabled={lockedHint !== undefined}
                onChange={(v) => set(String(v))}
                placeholder="如 adbkeyboard"
                title="引擎会在设备已装的输入法里找包含这段文字的项，找到唯一一个就切换过去；匹配到多个会提示你写具体些。"
              />
            </FormItem>
          ))
        }
        if (kind === 'waitPage') {
          return (
            <>
              {constantField('actPages', ({ value: pages, set, lockedHint }) => (
                <FormItem
                  name="等哪些页面"
                  required
                  description="可多选，出现任意一个即成功"
                  title="页面来自「变量面板 → 页面表」；引擎轮询当前页面，落在其中任意一个就继续往下走。"
                >
                  {lockedHint !== undefined ? (
                    <Input value={lockedHint} disabled />
                  ) : (
                    <PageMultiSelect
                      value={String(pages ?? '')}
                      onChange={(next) => set(next)}
                      placeholder="选择要等的页面"
                    />
                  )}
                </FormItem>
              ))}
              {constantField('actTimeout', ({ value: timeout, set }) => (
                <FormItem name="超时（秒）" description="超时走「失败」端口">
                  <Input
                    value={String(timeout ?? '10')}
                    onChange={(v) => set(String(v))}
                    placeholder="10"
                  />
                </FormItem>
              ))}
            </>
          )
        }
        if (kind === 'waitElement') {
          return (
            <>
              {constantField('actLocateIntent', ({ value: intent, set, lockedHint }) => (
                <FormItem name="等什么元素" required description="用日常话说要找的东西">
                  <Input
                    value={lockedHint ?? String(intent ?? '')}
                    disabled={lockedHint !== undefined}
                    onChange={(v) => set(String(v))}
                    placeholder="如 相册里的第一张图"
                    title="引擎轮询定位这个元素，出现即继续；超时走「失败」端口。"
                  />
                </FormItem>
              ))}
              {constantField('actTimeout', ({ value: timeout, set }) => (
                <FormItem name="超时（秒）" description="超时走「失败」端口">
                  <Input
                    value={String(timeout ?? '10')}
                    onChange={(v) => set(String(v))}
                    placeholder="10"
                  />
                </FormItem>
              ))}
            </>
          )
        }
        return <></>
      })}

      {constantField('requires', ({ value, set }) => (
        <FormItem
          name="前置页面"
          description="不在这些页面就走「页面不对」出口"
          title="页面来自「变量面板 → 页面表」。留空表示不检查；引擎会先等一会儿再判，避免把正在跳转误判成不在目标页。"
        >
          <PageMultiSelect
            value={String(value ?? '')}
            onChange={(next) => set(next)}
            placeholder="留空表示不检查"
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

      {constantField('retries', ({ value, set }) => (
        <FormItem name="失败重试次数" description="走失败端口前的自动重试">
          <Input
            value={String(value ?? '')}
            onChange={(v) => set(String(v))}
            placeholder="留空或 0 表示不重试"
            title="这一步失败（包括前置页面不匹配）时自动重试几次。重试之间会等待下面的间隔，重试完仍失败才走「失败」端口。"
          />
        </FormItem>
      ))}

      {constantField('retryGap', ({ value, set }) => (
        <FormItem name="重试间隔（秒）">
          <Input
            value={String(value ?? '')}
            onChange={(v) => set(String(v))}
            placeholder="默认 1"
            title="两次重试之间的等待秒数；实际会在 1–2 倍之间随机。"
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
