// 导出用的图片准备（需要 Electron 的隐藏窗口）：
// - Word：位图直接嵌入；SVG 与 WebP 先栅格化成高清 PNG（Word 不认 SVG 公式）。
// - 公式小图（组卷网的公式多是 1 倍分辨率的小 PNG）：放大 3 倍再用，打印出来边缘才不发虚。显示尺寸仍是原来的大小。
// 隐藏窗口只加载 about:blank，图片以 data 地址交给它，不碰网络。
import { BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { assetPath } from '../assets'
import { documentNodes, limitImageHeights, type ExportDocument } from './document'
import type { DocxImage, ImageLookup } from './docx'
import { TEXT_WIDTH_TWIPS, imageNeeds } from './docx'
import { collectImages } from './html-tree'
import { parseImageSource, rasterSize, rasterTypeOf, svgHasIntrinsicSize } from './image-src'

// 栅格化倍数：显示 1 个 CSS 像素用 4 个像素，打印到 A4 约 380 dpi；单边不超过 4096
const SCALE = 4
const MAX_SIDE = 4096
// 公式小图的放大倍数，以及「小图」的判定（高度与宽度上限，CSS 像素）
const UPSCALE = 3
const SMALL_MAX_HEIGHT = 80
const SMALL_MAX_WIDTH = 400

interface RasterJob {
  src: string
  dataUrl: string
  mode: 'vector' | 'upscale'
  wantedWidth: number | null
}
interface RasterResult {
  src: string
  png: string // base64
  width: number
  height: number
}

const MIME: Record<string, string> = { svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' }

// 在隐藏窗口里执行：加载图片、读自然尺寸、画到 canvas 导出 PNG
const RASTER_SCRIPT = (jobs: RasterJob[]): string => `(async () => {
  const SCALE = ${SCALE}, MAX_SIDE = ${MAX_SIDE}, UPSCALE = ${UPSCALE}
  const out = []
  for (const job of ${JSON.stringify(jobs)}) {
    const img = new Image()
    img.src = job.dataUrl
    await img.decode()
    const w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) throw new Error('图片没有可识别的尺寸：' + job.src)
    const want = job.wantedWidth && job.wantedWidth > w ? job.wantedWidth / w : 1
    const factor = job.mode === 'upscale' ? UPSCALE : SCALE * want
    const scale = Math.min(factor, MAX_SIDE / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const g = canvas.getContext('2d')
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    if (job.mode === 'upscale') {
      // 放大后的小图边缘发软：做一次轻度锐化（原图 + 1.2 倍的「原图 - 模糊图」），公式的笔画才清楚
      const blurred = document.createElement('canvas')
      blurred.width = canvas.width
      blurred.height = canvas.height
      const bg = blurred.getContext('2d')
      bg.filter = 'blur(1.1px)'
      bg.drawImage(canvas, 0, 0)
      const base = g.getImageData(0, 0, canvas.width, canvas.height)
      const soft = bg.getImageData(0, 0, canvas.width, canvas.height).data
      const px = base.data
      for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, px[i] + 1.2 * (px[i] - soft[i])))
      g.putImageData(base, 0, 0)
    }
    out.push({ src: job.src, png: canvas.toDataURL('image/png').split(',')[1], width: w, height: h })
  }
  return out
})()`

async function rasterize(jobs: RasterJob[]): Promise<RasterResult[]> {
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  try {
    await win.loadURL('about:blank')
    return (await win.webContents.executeJavaScript(RASTER_SCRIPT(jobs))) as RasterResult[]
  } finally {
    win.destroy()
  }
}

// forWord：Word 需要全部图片（位图原样，SVG / WebP 栅格化）；PDF 只需要放大公式小图，其余交给浏览器直接排版
async function prepare(doc: ExportDocument, dataDir: string, forWord: boolean): Promise<{ ready: Map<string, DocxImage>; naturals: Map<string, { width: number; height: number }> }> {
  const ready = new Map<string, DocxImage>()
  const naturals = new Map<string, { width: number; height: number }>() // 所有位图与量过尺寸的 SVG 的自然尺寸
  const jobs: RasterJob[] = []
  for (const need of imageNeeds(doc)) {
    const source = parseImageSource(need.src)
    if (!source) throw new Error(`图片地址无法识别：${need.src.slice(0, 60)}`)
    const bytes = source.kind === 'asset' ? readFileSync(assetPath(dataDir, source.name)) : source.bytes
    const type = rasterTypeOf(source.ext)
    const mime = MIME[source.ext]
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
    if (!type) {
      // PDF 里 SVG 直接排版；只有没写明宽高的 SVG 要量出尺寸固定下来
      if (forWord || (source.ext === 'svg' && !svgHasIntrinsicSize(bytes))) jobs.push({ src: need.src, dataUrl, mode: 'vector', wantedWidth: need.wantedWidth })
      continue
    }
    const size = rasterSize(bytes, type)
    if (!size) throw new Error(`图片文件已损坏：${need.src.slice(0, 60)}`)
    naturals.set(need.src, size)
    if (size.height <= SMALL_MAX_HEIGHT && size.width <= SMALL_MAX_WIDTH) jobs.push({ src: need.src, dataUrl, mode: 'upscale', wantedWidth: null })
    else if (forWord) ready.set(need.src, { data: bytes, type, ...size })
  }
  if (jobs.length > 0) {
    for (const r of await rasterize(jobs)) {
      const upscaled = jobs.find((j) => j.src === r.src)!.mode === 'upscale'
      ready.set(r.src, { data: Buffer.from(r.png, 'base64'), type: 'png', width: r.width, height: r.height, upscaled })
      naturals.set(r.src, { width: r.width, height: r.height })
    }
  }
  return { ready, naturals }
}

export async function prepareWordImages(doc: ExportDocument, dataDir: string): Promise<ImageLookup> {
  const { ready } = await prepare(doc, dataDir, true)
  return (src) => {
    const found = ready.get(src)
    if (!found) throw new Error(`图片没有准备好：${src.slice(0, 60)}`)
    return found
  }
}

// PDF：把公式小图换成放大后的内嵌图片，并把显示尺寸固定在原来的大小；没写明宽高的 SVG 也固定成浏览器量出的尺寸（与 Word 一致）
export async function upscaleSmallImagesForPrint(doc: ExportDocument, dataDir: string): Promise<void> {
  const { ready, naturals } = await prepare(doc, dataDir, false)
  // 先把过高的图缩到版心可用高度（按原地址查自然尺寸，放在换地址之前）
  limitImageHeights(doc, (src) => naturals.get(src) ?? null, TEXT_WIDTH_TWIPS / 15)
  if (ready.size === 0) return
  for (const img of collectImages(documentNodes(doc))) {
    const entry = ready.get(img.attrs.src ?? '')
    if (!entry) continue
    if (entry.upscaled) img.attrs.src = `data:image/png;base64,${Buffer.from(entry.data).toString('base64')}`
    if (!img.attrs.width && !img.attrs.height) {
      img.attrs.width = String(entry.width)
      img.attrs.height = String(entry.height)
    }
  }
}
