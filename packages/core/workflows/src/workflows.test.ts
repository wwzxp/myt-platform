import { mkdtemp, readdir, rename as fsRename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkflowStore, sanitizeName } from './index.ts'

/**
 * WorkflowStore 测试：只测外部行为（文件布局、id 稳定性、改名/复制语义），
 * 不测内部有没有调用某个函数——重构时测试不该碎。
 */

const dirs: string[] = []

async function makeStore(): Promise<{ store: WorkflowStore; dir: string; ctx: Context }> {
  const dir = await mkdtemp(join(tmpdir(), 'myt-wf-'))
  dirs.push(dir)
  const ctx = new Context()
  const store = new WorkflowStore(ctx as never, { dir })
  return { store, dir, ctx }
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('WorkflowStore — 文件布局', () => {
  it('文件名就是流程名，一图一文件', async () => {
    const { store, dir } = await makeStore()
    await store.create('小红书发布图文')

    const files = await readdir(dir)
    expect(files).toEqual(['小红书发布图文.json'])
  })

  it('id 存在文件内容里，不是文件名', async () => {
    const { store, dir } = await makeStore()
    const { doc } = await store.create('发布')

    const files = await readdir(dir)
    expect(files[0]).not.toContain(doc.id)
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it('新建流程含 start + end 与一条边', async () => {
    const { store } = await makeStore()
    const { doc } = await store.create('空流程')

    expect(doc.nodes).toHaveLength(2)
    expect(doc.edges).toHaveLength(1)
  })
})

describe('WorkflowStore — 用户可直接操作文件', () => {
  it('用户在资源管理器里改名，id 不变，仍能按 id 找到', async () => {
    const { store, dir } = await makeStore()
    const { doc } = await store.create('原名')
    await fsRename(join(dir, '原名.json'), join(dir, '用户改的名.json'))

    // 新实例重新扫盘（模拟重启）
    const ctx = new Context()
    const fresh = new WorkflowStore(ctx as never, { dir })
    const byId = await fresh.loadById(doc.id)
    expect(byId).toBeDefined()

    const list = await fresh.list()
    expect(list[0]?.name).toBe('用户改的名')
  })

  it('用户复制文件产生重复 id，list() 自动重新分配', async () => {
    const { store, dir } = await makeStore()
    const { doc } = await store.create('原件')
    await fsRename(join(dir, '原件.json'), join(dir, '原件.json'))

    // 模拟用户在资源管理器里 Ctrl+C/Ctrl+V
    const { readFile, writeFile } = await import('node:fs/promises')
    const raw = await readFile(join(dir, '原件.json'), 'utf8')
    await writeFile(join(dir, '副本.json'), raw)

    const ctx = new Context()
    const fresh = new WorkflowStore(ctx as never, { dir })
    const list = await fresh.list()

    expect(list).toHaveLength(2)
    const ids = list.map((item) => item.id)
    expect(new Set(ids).size).toBe(2)          // id 已去重
    expect(ids).toContain(doc.id)              // 原件保留原 id
  })

  it('单个文件损坏不影响其它流程', async () => {
    const { store, dir } = await makeStore()
    await store.create('好的')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, '坏的.json'), '{ 这不是 JSON')

    const ctx = new Context()
    const fresh = new WorkflowStore(ctx as never, { dir })
    const list = await fresh.list()
    expect(list.map((item) => item.name)).toEqual(['好的'])
  })
})

describe('WorkflowStore — 改名与复制', () => {
  it('重命名只改文件名，id 不变', async () => {
    const { store, dir } = await makeStore()
    const { doc } = await store.create('旧名')
    await store.rename('旧名', '新名')

    expect(await readdir(dir)).toEqual(['新名.json'])
    expect((await store.loadById(doc.id))?.id).toBe(doc.id)
  })

  it('重命名到已存在的名字时自动加序号，不覆盖', async () => {
    const { store } = await makeStore()
    await store.create('A')
    await store.create('B')
    const fileName = await store.rename('B', 'A')

    expect(fileName).toBe('A (2).json')
  })

  it('复制流程会换新 id', async () => {
    const { store } = await makeStore()
    const { doc } = await store.create('原件')
    const copyName = await store.duplicate('原件')

    expect(copyName).toBe('原件 副本.json')
    const copy = await store.load(copyName)
    expect(copy?.id).not.toBe(doc.id)
  })

  it('删除流程会移除文件', async () => {
    const { store, dir } = await makeStore()
    await store.create('要删的')
    expect(await store.remove('要删的')).toBe(true)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('sanitizeName — 非法字符', () => {
  it('把路径分隔符替换成下划线', () => {
    expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('空名字回落到默认名', () => {
    expect(sanitizeName('   ')).toBe('未命名流程')
  })

  it('超长名字截断到 100 字符', () => {
    expect(sanitizeName('长'.repeat(200))).toHaveLength(100)
  })
})
