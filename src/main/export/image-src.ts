// 题目里的图片地址：本地图片 ewb-asset://<哈希>.<扩展名> 或内嵌 data:image。不依赖 Electron。
import { assetNameFromUrl } from '../assets.ts'

export type RasterType = 'png' | 'jpg' | 'gif' | 'bmp'

export type ImageSource =
  | { kind: 'asset'; name: string; ext: string }
  | { kind: 'data'; ext: string; bytes: Buffer }

const MIME_EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', 'svg+xml': 'svg', bmp: 'bmp' }
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml|bmp);base64,([A-Za-z0-9+/=\s]+)$/i

export function parseImageSource(src: string): ImageSource | null {
  const name = assetNameFromUrl(src)
  if (name) return { kind: 'asset', name, ext: name.slice(name.lastIndexOf('.') + 1) }
  const m = DATA_IMAGE.exec(src.trim())
  if (!m) return null
  return { kind: 'data', ext: MIME_EXT[m[1].toLowerCase()], bytes: Buffer.from(m[2].replace(/\s+/g, ''), 'base64') }
}

// Word 能直接嵌入的格式；svg 与 webp 需要先栅格化
export function rasterTypeOf(ext: string): RasterType | null {
  const e = ext.toLowerCase()
  return e === 'png' || e === 'jpg' || e === 'gif' || e === 'bmp' ? e : null
}

// 读位图头得到像素尺寸；认不出时返回 null
export function rasterSize(bytes: Uint8Array, type: RasterType): { width: number; height: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === 'png') {
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }
  if (type === 'gif') {
    if (b.length < 10 || b.toString('latin1', 0, 3) !== 'GIF') return null
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  }
  if (type === 'bmp') {
    if (b.length < 26 || b.toString('latin1', 0, 2) !== 'BM') return null
    return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) }
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let pos = 2
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = b[pos + 1]
    if (marker === 0xff) {
      pos++
      continue
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(pos + 5), width: b.readUInt16BE(pos + 7) }
    }
    pos += 2 + b.readUInt16BE(pos + 2)
  }
  return null
}

// SVG 根元素是否写明了宽高（带单位的数值）。没写明的只有 viewBox，浏览器会按默认大小或铺满一行来排，
// 导出时要先量出尺寸固定下来，PDF 与 Word 才一致
export function svgHasIntrinsicSize(bytes: Uint8Array): boolean {
  const root = /<svg\b[^>]*>/i.exec(Buffer.from(bytes).toString('utf8', 0, 4096))?.[0] ?? ''
  const dim = (name: string): boolean => new RegExp(`\\s${name}\\s*=\\s*["']\\s*[\\d.]+\\s*(px|pt|em|ex|mm|cm|in|pc)?\\s*["']`, 'i').test(root)
  return dim('width') && dim('height')
}

// 图片显示高度上限：A4 版心高 257mm。卷尾答案页上「参考答案」标题、来源行、答案文字行加起来约 30mm，
// 一张最高的答案图要能和它们放在同一页，所以取 215mm；更高的图等比缩小，不然会被页面截掉
export const MAX_IMAGE_HEIGHT_MM = 215
export const MAX_IMAGE_HEIGHT_PX = Math.floor((MAX_IMAGE_HEIGHT_MM / 25.4) * 96)

// 图片在页面上的显示尺寸（CSS 像素）：优先取 width/height 属性，只有一个时按自然比例推算，
// 超过可用宽度或高度时等比缩小。宽度方向与 PDF 里 `max-width:100%; height:auto` 的结果一致；高度方向 PDF 由 images.ts 把缩小后的尺寸写回属性。
export function displaySize(
  attrs: Record<string, string>,
  natural: { width: number; height: number },
  maxWidth: number,
  maxHeight: number = Infinity
): { width: number; height: number } {
  const num = (v: string | undefined): number | null => {
    const n = v ? parseFloat(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const aw = num(attrs.width)
  const ah = num(attrs.height)
  const naturalOk = natural.height > 0 && natural.width > 0
  const ratio = naturalOk ? natural.height / natural.width : aw && ah ? ah / aw : 1
  let width: number
  let height: number
  // 与 PDF 样式一致：两个属性都给时 height:auto，按 width 属性与自然比例取高度
  if (aw) {
    width = aw
    height = aw * ratio
  } else if (ah) {
    height = ah
    width = ah / ratio
  } else {
    width = natural.width
    height = natural.height
  }
  if (width > maxWidth) {
    height = (height * maxWidth) / width
    width = maxWidth
  }
  if (height > maxHeight) {
    width = (width * maxHeight) / height
    height = maxHeight
  }
  return { width: Math.max(1, Math.round(width * 100) / 100), height: Math.max(1, Math.round(height * 100) / 100) }
}
