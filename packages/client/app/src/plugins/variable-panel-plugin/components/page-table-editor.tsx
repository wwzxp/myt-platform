/**
 * 页面表编辑（变量面板里的一个页签）。
 *
 * 条件节点的「页面是」只能从这张表里选，所以它是业务用户需要的配置项：
 * 加一个界面 = 加一行（页面 id + 中文名 + 识别特征）。
 *
 * 数据存在流程的全局变量 `app.default.pages` 里；这里直接改全局变量的类型定义，
 * 与「全局变量编辑」页签改的是同一份数据。
 */
import { useEffect, useRef, useState } from 'react'

import {
  BaseVariableField,
  GlobalScope,
  useRefresh,
  useService,
  WorkflowDocument,
} from '@flowgram.ai/free-layout-editor'
import { JsonSchemaUtils } from '@flowgram.ai/form-materials'
import { Button, Input, Modal, Select, Toast } from '@douyinfe/semi-ui'

import { useWorkflowContext } from '../../../context/workflow-context'
import { saveWorkflow } from '../../../services/workflow-api'
import { listSelectableDevices } from '../../../services/device-api'
import { collectPageKeywords } from '../../../services/page-collect-api'

/**
 * 采集会覆盖整列关键词，已有内容时先确认。
 *
 * 用 Semi 的 `Modal.confirm` 而不是 `window.confirm`：
 * 前者能被画布的正常渲染流程管理，也便于展示新旧对照。
 */
function confirmOverwrite(existing: readonly string[], next: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    Modal.confirm({
      title: '覆盖已有界面关键词？',
      content: (
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div>现有：{existing.join('、')}</div>
          <div>新采：{next.join('、')}</div>
        </div>
      ),
      okText: '覆盖',
      cancelText: '取消',
      onOk: () => done(true),
      onCancel: () => done(false),
      afterClose: () => done(false),
    })
  })
}

/** 页面表里的一行。 */
interface PageRow {
  id: string
  title?: string
  /** 识别特征：Activity 名或界面文字，命中即判为该页。 */
  markers?: string[]
  /**
   * 界面关键词：判断页面 id 的**独有词**（Activity 认不出时用）。
   *
   * 只填这个页面上独有的词，别填「全部」「视频」这种到处都有的。
   * 跨语言由引擎的对齐表处理，这里只维护中文。
   */
  keywords?: string[]
}

/** 全局变量 schema 的最小形状（只关心 app.default.pages）。 */
interface GlobalSchema {
  type?: string
  properties?: Record<string, { type?: string; default?: Record<string, unknown> }>
}

export function PageTableEditor() {
  const globalScope = useService(GlobalScope)
  const refresh = useRefresh()
  const listRef = useRef<HTMLDivElement>(null)
  const workflow = useWorkflowContext()
  const document = useService(WorkflowDocument)
  const saveTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined)

  /** 防抖保存：连续输入时只在停手 800ms 后写一次盘。 */
  const scheduleSave = (schema: GlobalSchema): void => {
    if (saveTimer.current !== undefined) globalThis.clearTimeout(saveTimer.current)
    saveTimer.current = globalThis.setTimeout(() => {
      saveTimer.current = undefined
      const file = workflow?.fileName
      if (!file) return
      // 不能用 `workflow.save()`：它保存的是**加载时的快照**（editor 里的 `doc`），
      // 而不是画布当前状态——内容"没变"会被幂等检查直接跳过。
      // 这里按自动保存的同一形状组装：当前文档 + 最新全局变量。
      const live = document.toJSON() as unknown as Record<string, unknown>
      void saveWorkflow(file, { ...live, globalVariable: schema }).catch(() => {
        // 保存失败不阻塞编辑；下次改动会再试。
      })
    }, 800)
  }

  useEffect(
    () => () => {
      if (saveTimer.current !== undefined) globalThis.clearTimeout(saveTimer.current)
    },
    [],
  )
  /**
   * 手动指定的设备序列号（如 `127.0.0.1:5565`）。
   *
   * 内核没配宿主机时（`/api/hosts` 为空）拿不到容器设备列表，
   * 但直连 adb 的设备照样能采集——所以给一个手填入口，存在 localStorage。
   */
  /** 正在采集的页面 id：用于禁用按钮并显示进度，避免重复点击。 */
  const [collectingId, setCollectingId] = useState<string | null>(null)
  const [manualSerial, setManualSerial] = useState(
    () => globalThis.localStorage?.getItem('myt.collect.serial') ?? '',
  )
  const rememberSerial = (value: string): void => {
    setManualSerial(value)
    globalThis.localStorage?.setItem('myt.collect.serial', value)
  }
  const globalVar = globalScope.getVar() as BaseVariableField | undefined

  useEffect(() => {
    const disposable = globalScope.output.onListOrAnyVarChange(() => refresh())
    return () => disposable.dispose()
  }, [])

  if (!globalVar) return null

  const schema = (globalVar.type ? JsonSchemaUtils.astToSchema(globalVar.type) : { type: 'object' }) as GlobalSchema
  const rawPages = schema.properties?.['app']?.default?.['pages']
  const pages: PageRow[] = Array.isArray(rawPages) ? (rawPages as PageRow[]) : []

  /** 写回全局变量；只动 `app.default.pages`。 */
  const commit = (next: PageRow[]): void => {
    const cloned = JSON.parse(JSON.stringify(schema)) as GlobalSchema
    cloned.type = cloned.type ?? 'object'
    cloned.properties = cloned.properties ?? {}
    const app = cloned.properties['app'] ?? { type: 'object' }
    app.default = { ...(app.default ?? {}), pages: next }
    cloned.properties['app'] = app
    globalVar.updateType(JsonSchemaUtils.schemaToAST(cloned))
    // 面板只订「变量列表增删」不会因类型变更重渲染，这里主动刷一次。
    refresh()
    // 自动保存只挂在 `onContentChange` 上，而改全局变量类型不会触发它——
    // 不在这里显式保存的话，页面表的任何编辑（关键词/标题/增删行）刷新后就丢了。
    scheduleSave(cloned)
  }

  const updateAt = (index: number, patch: Partial<PageRow>): void => {
    if (patch.id !== undefined && patch.id !== pages[index]?.id) {
      if (pages.some((page, i) => i !== index && page.id === patch.id)) {
        Toast.warning(`页面 id「${patch.id}」已存在`)
        return
      }
    }
    commit(pages.map((page, i) => (i === index ? { ...page, ...patch } : page)))
  }

  const removeAt = (index: number): void => {
    commit(pages.filter((_, i) => i !== index))
  }

  // 点一下直接多一行空行，光标落在 id 上，就地输入（不再弹 prompt）。
  const addRow = (): void => {
    commit([...pages, { id: '', title: '', markers: [] }])
    window.setTimeout(() => {
      const list = listRef.current
      if (!list) return
      list.scrollTop = list.scrollHeight
      const rows = list.querySelectorAll(':scope > div')
      const last = rows[rows.length - 1]
      // preventScroll：否则聚焦会把整个面板连同「新增页面」按钮一起滚出去。
      last?.querySelector('input')?.focus({ preventScroll: true })
    }, 60)
  }

  /**
   * 采集某页的关键词。
   *
   * 需要设备停在目标页面上——这里不驱动跳转，只负责抓当前画面。
   * 采到后直接写回该行；失败用 Toast 报原因，不改动已有数据。
   */
  const collect = async (index: number): Promise<void> => {
    const page = pages[index]
    if (!page) return
    if (!page.id.trim()) {
      Toast.warning('先填页面 id 再采集')
      return
    }
    if (collectingId) {
      Toast.info('已有采集在进行中，请稍候')
      return
    }
    setCollectingId(page.id)
    try {
      // 优先用手填的序列号（直连 adb 的设备不依赖宿主机）。
      let serial = manualSerial.trim()
      let label = serial

      if (!serial) {
        const hostResponse = await fetch('/api/hosts')
        const hosts = hostResponse.ok ? ((await hostResponse.json()) as unknown[]) : []
        if (!Array.isArray(hosts) || hosts.length === 0) {
          Toast.error('没有配置宿主机，也没有手填设备序列号（如 127.0.0.1:5565）')
          return
        }
        const devices = await listSelectableDevices()
        const device = devices[0]
        if (!device) {
          Toast.error('没有运行中的设备，先启动容器')
          return
        }
        serial = device.serial
        label = device.name
      }

      Toast.info(`正在从 ${label} 采集「${page.title || page.id}」，请让设备停在目标页面…`)
      const result = await collectPageKeywords(serial, page.id)

      if (result.warning) {
        Toast.warning(result.warning)
        return
      }

      // 已有词时先让用户确认：采集会覆盖整列，误点代价不小。
      const existing = page.keywords ?? []
      if (existing.length > 0) {
        const accepted = await confirmOverwrite(existing, result.keywords)
        if (!accepted) {
          Toast.info('已取消，原有词保留')
          return
        }
      }
      updateAt(index, { keywords: result.keywords })
      Toast.success(`采到 ${result.keywords.length} 个关键词：${result.keywords.join('、')}`)
    } catch (error) {
      Toast.error(`采集失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCollectingId(null)
    }
  }

  return (
    // 页签内容区固定 500px（index.module.less），这里撑满并把滚动留给列表。
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 8, padding: 4 }}>
      <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
        条件节点的「页面是」从这里取选项。加一个界面 = 加一行：填页面 id、中文名、
        Activity 特征，以及<b>这个页面独有的界面关键词</b>——Activity 认不出时靠它判断。
        选词要点：只填本页独有的（别填「确定」「下一步」这类到处都有的），每页至少两个。
      </div>

      {pages.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>还没有页面，点下面「新增页面」开始。</div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button size="small" theme="light" onClick={addRow}>
          新增页面
        </Button>
        <Input
          size="small"
          value={manualSerial}
          onChange={rememberSerial}
          placeholder="采集用设备序列号，如 127.0.0.1:5565（留空则用宿主容器）"
          style={{ flex: 1 }}
        />
      </div>

      {/* 行数多时面板高度不够，滚动条要落在这里，否则底部几行会被画布盖住、点不到。 */}
      <div
        ref={listRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: '1 1 auto',
          minHeight: 0,
          maxHeight: 460,
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {pages.map((page, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 8,
              border: '1px solid var(--semi-color-border)',
              borderRadius: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                size="small"
                value={page.id}
                onChange={(v) => updateAt(index, { id: v })}
                placeholder="页面 id，如 home"
              />
              <Input
                size="small"
                value={page.title ?? ''}
                onChange={(v) => updateAt(index, { title: v })}
                placeholder="中文名，如 首页"
              />
              <Button size="small" theme="borderless" type="danger" onClick={() => removeAt(index)}>
                删除
              </Button>
            </div>
            <Input
              size="small"
              value={(page.markers ?? []).join(',')}
              onChange={(v) =>
                updateAt(index, {
                  markers: v
                    .split(/[,，]/u)
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder="识别特征，如 IndexActivity；多个用逗号分隔"
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                size="small"
                value={(page.keywords ?? []).join(',')}
                onChange={(v) =>
                  updateAt(index, {
                    keywords: v
                      .split(/[,，]/u)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="界面关键词（独有词），如 实况图,全屏图；多个用逗号分隔"
              />
              <Button
                size="small"
                theme="borderless"
                loading={collectingId === page.id}
                disabled={collectingId !== null && collectingId !== page.id}
                onClick={() => void collect(index)}
              >
                {collectingId === page.id ? '采集中' : '采集'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
