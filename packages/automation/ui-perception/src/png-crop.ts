import { inflateSync, deflateSync } from 'node:zlib'

/**
 * 纯 JS 的 PNG 裁剪。
 *
 * 为什么自己写：项目里没有 sharp / jimp / pngjs，而视觉兜底只需要「从整页截图里
 * 裁一条区域」。引入原生依赖会拖慢打包、增加跨平台风险，而 PNG 的解码只用到
 * Node 内置的 `zlib`——足够。
 *
 * 限制：只支持 8 位深、非隔行的 PNG（adb screencap 产出的就是这种）。
 * 遇到不支持的格式返回 null，由调用方退回「整页发送」。
 */

/** 裁剪矩形。 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** 解码后的 PNG。 */
interface DecodedPng {
  width: number
  height: number
  /** 每像素字节数（grayscale=1, rgb=3, rgba=4 …）。 */
  channels: number
  /** 每行字节数（不含过滤字节）。 */
  stride: number
  /** 原始扫描线数据（每行前有 1 字节过滤类型）。 */
  data: Buffer
  colorType: number
  bitDepth: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 通道数 → 是否带 alpha。 */
function channelsOf(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1 // grayscale
    case 2:
      return 3 // rgb
    case 3:
      return 1 // palette index
    case 4:
      return 2 // grayscale + alpha
    case 6:
      return 4 // rgba
    default:
      return 0
  }
}

/** Paeth 预测器。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** 解码 PNG（只处理 8 位、非隔行）。 */
export function decodePng(buffer: Buffer): DecodedPng | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatChunks: Buffer[] = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > buffer.length) return null

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      bitDepth = buffer[dataStart + 8] ?? 0
      colorType = buffer[dataStart + 9] ?? 0
      interlace = buffer[dataStart + 12] ?? 0
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4 // 跳过 CRC
  }

  // 只支持最常见的组合：8 位、非隔行、非调色板。
  if (bitDepth !== 8 || interlace !== 0 || colorType === 3) return null
  const channels = channelsOf(colorType)
  if (channels === 0) return null

  const inflated = inflateSync(Buffer.concat(idatChunks))
  return { width, height, channels, stride: width * channels, data: inflated, colorType, bitDepth }
}

/** 反滤波一行。 */
function unfilterRow(
  filterType: number,
  raw: Buffer,
  offset: number,
  prior: Buffer | null,
  stride: number,
  channels: number,
  out: Buffer,
): void {
  for (let i = 0; i < stride; i += 1) {
    const x = raw[offset + i] ?? 0
    const a = i >= channels ? (out[i - channels] ?? 0) : 0
    const b = prior ? (prior[i] ?? 0) : 0
    const c = prior && i >= channels ? (prior[i - channels] ?? 0) : 0
    let value: number
    switch (filterType) {
      case 0:
        value = x
        break
      case 1:
        value = x + a
        break
      case 2:
        value = x + b
        break
      case 3:
        value = x + ((a + b) >> 1)
        break
      case 4:
        value = x + paeth(a, b, c)
        break
      default:
        value = x
    }
    out[i] = value & 0xff
  }
}

/** 编码 PNG（RGBA、8 位）。 */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const chunks: Buffer[] = [PNG_SIGNATURE]

  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    // CRC32 用 zlib 的 crc32 等价实现（Node 未直接暴露，这里用简单表法）
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', deflateSync(raw)))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

/** CRC32 查表。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 裁剪 PNG。
 *
 * @param png 原始 PNG 字节
 * @param rect 裁剪矩形（超出边界会被夹到有效范围）
 * @returns 裁剪后的 PNG；格式不支持时返回 null
 */
export function cropPng(png: Buffer, rect: CropRect): Buffer | null {
  const decoded = decodePng(png)
  if (!decoded) return null
  const { width, height, channels, stride, data } = decoded

  const x0 = Math.max(0, Math.min(width - 1, Math.floor(rect.x)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(rect.y)))
  const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(rect.x + rect.width)))
  const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(rect.y + rect.height)))
  const outW = x1 - x0
  const outH = y1 - y0

  const rgba = Buffer.alloc(outW * outH * 4)
  let prior: Buffer | null = null
  const current = Buffer.alloc(stride)

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    const filterType = data[rowStart] ?? 0
    const rawSlice = data.subarray(rowStart + 1)
    unfilterRow(filterType, rawSlice, 0, prior, stride, channels, current)

    if (y >= y0 && y < y1) {
      const outRow = (y - y0) * outW * 4
      for (let x = x0; x < x1; x += 1) {
        const src = x * channels
        const dst = outRow + (x - x0) * 4
        if (channels >= 4) {
          rgba[dst] = current[src] ?? 0
          rgba[dst + 1] = current[src + 1] ?? 0
          rgba[dst + 2] = current[src + 2] ?? 0
          rgba[dst + 3] = current[src + 3] ?? 255
        } else if (channels === 3) {
          rgba[dst] = current[src] ?? 0
          rgba[dst + 1] = current[src + 1] ?? 0
          rgba[dst + 2] = current[src + 2] ?? 0
          rgba[dst + 3] = 255
        } else if (channels === 2) {
          const g = current[src] ?? 0
          rgba[dst] = g
          rgba[dst + 1] = g
          rgba[dst + 2] = g
          rgba[dst + 3] = current[src + 1] ?? 255
        } else {
          const g = current[src] ?? 0
          rgba[dst] = g
          rgba[dst + 1] = g
          rgba[dst + 2] = g
          rgba[dst + 3] = 255
        }
      }
    }

    prior = Buffer.from(current)
  }

  return encodePng(outW, outH, rgba)
}
