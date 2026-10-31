import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isSystemDrive, readConfig, resolveDataDir, writeConfig } from './data-dir.ts'

/**
 * 数据目录解析测试：只测优先级与边界，不测内部实现。
 */

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'myt-datadir-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** 构造解析参数：所有外部依赖都可注入。 */
function options(overrides: Partial<Parameters<typeof resolveDataDir>[0]> = {}) {
  return {
    env: {},
    configDir: '/cfg',
    installDir: '/install',
    fallbackDir: '/fallback',
    availableDrives: () => ['D:', 'E:'],
    isWritable: () => true,
    ...overrides,
  }
}

describe('resolveDataDir — 优先级', () => {
  it('环境变量最高优先级', () => {
    const result = resolveDataDir(options({ env: { MYT_DATA_DIR: '/env/data' } }))
    expect(result.dir).toBe('/env/data')
    expect(result.source).toBe('env')
    expect(result.needsPrompt).toBe(false)
  })

  it('环境变量优先于配置文件', async () => {
    const configDir = await tempDir()
    writeConfig(configDir, { dataDir: '/config/data' })

    const result = resolveDataDir(options({
      env: { MYT_DATA_DIR: '/env/data' },
      configDir,
    }))
    expect(result.dir).toBe('/env/data')
  })

  it('配置文件次之', async () => {
    const configDir = await tempDir()
    writeConfig(configDir, { dataDir: '/config/data' })

    const result = resolveDataDir(options({ configDir }))
    expect(result.dir).toBe('/config/data')
    expect(result.source).toBe('config')
    expect(result.needsPrompt).toBe(false)
  })

  it('都没配时用安装目录的 data/（便携版）', async () => {
    const configDir = await tempDir()
    const result = resolveDataDir(options({ configDir }))
    expect(result.dir).toBe(join('/install', 'data'))
    expect(result.source).toBe('install')
  })

  it('安装目录不可写时兜底到 fallback', async () => {
    const configDir = await tempDir()
    const result = resolveDataDir(options({ configDir, isWritable: () => false }))
    expect(result.dir).toBe('/fallback')
    expect(result.source).toBe('fallback')
  })
})

describe('resolveDataDir — 首次运行提示', () => {
  it('用户没选过时 needsPrompt 为 true', async () => {
    const configDir = await tempDir()
    expect(resolveDataDir(options({ configDir })).needsPrompt).toBe(true)
  })

  it('用户跳过过时不再弹窗', async () => {
    const configDir = await tempDir()
    writeConfig(configDir, { skipped: true })
    expect(resolveDataDir(options({ configDir })).needsPrompt).toBe(false)
  })

  it('建议路径取第一个非系统盘', async () => {
    const configDir = await tempDir()
    const result = resolveDataDir(options({
      configDir,
      availableDrives: () => ['C:', 'D:', 'E:'],
    }))
    expect(result.suggested).toContain('D:')
    expect(result.suggested).not.toMatch(/^C:/iu)
  })

  it('没有非系统盘时建议路径回落到 fallback', async () => {
    const configDir = await tempDir()
    const result = resolveDataDir(options({
      configDir,
      availableDrives: () => ['C:'],
    }))
    expect(result.suggested).toContain('fallback')
  })
})

describe('isSystemDrive — C 盘识别', () => {
  it('识别 C 盘路径', () => {
    if (process.platform !== 'win32') return
    expect(isSystemDrive('C:\\Users\\x\\AppData')).toBe(true)
    expect(isSystemDrive('c:\\data')).toBe(true)
    expect(isSystemDrive('D:\\MYT')).toBe(false)
  })

  it('非 Windows 一律 false', () => {
    if (process.platform === 'win32') return
    expect(isSystemDrive('/c/Users/x')).toBe(false)
  })
})

describe('配置文件读写', () => {
  it('写入后能读回', async () => {
    const dir = await tempDir()
    writeConfig(dir, { dataDir: '/x/y', skipped: false })
    expect(readConfig(dir)).toEqual({ dataDir: '/x/y', skipped: false })
  })

  it('配置文件不存在时返回空对象', async () => {
    const dir = await tempDir()
    expect(readConfig(dir)).toEqual({})
  })

  it('配置文件损坏时返回空对象', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'myt.config.json'), '{ 不是 JSON', 'utf8')
    expect(readConfig(dir)).toEqual({})
  })

  it('写入是原子的（不留下 .tmp）', async () => {
    const dir = await tempDir()
    writeConfig(dir, { dataDir: '/a' })
    const raw = await readFile(join(dir, 'myt.config.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ dataDir: '/a' })
  })
})
