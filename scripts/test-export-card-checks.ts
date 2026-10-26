// 答题卡 PDF 的版面检查：把 PDF 转成灰度图（pdftoppm），量四角定位块的位置、核对每页的黑框上下边成对。
// 移植自调研原型的 markcheck.py / edgecheck.py，不依赖 Python；需要本机有 pdftoppm。
// 检查本身要反向验证过才可信：test/e2e/export-card.e2e.ts 会故意改坏定位块偏移与黑框分页规则，确认这里会报错。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CARD_MARK, CARD_PAGE } from '../src/main/export/render-card-html.ts'

interface Gray {
  width: number
  height: number
  px: Uint8Array
}

// pdftoppm -gray 输出 PGM（P5）
function parsePgm(buf: Buffer): Gray {
  let pos = 0
  const token = (): string => {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++
    let t = ''
    while (!/\s/.test(String.fromCharCode(buf[pos]))) t += String.fromCharCode(buf[pos++])
    return t
  }
  if (token() !== 'P5') throw new Error('不是 PGM')
  const width = Number(token())
  const height = Number(token())
  token() // maxval
  pos++
  return { width, height, px: buf.subarray(pos, pos + width * height) }
}

export function renderPages(pdf: string, dpi: number): Gray[] {
  const dir = mkdtempSync(join(tmpdir(), 'ewb-card-check-'))
  try {
    execFileSync('pdftoppm', ['-gray', '-r', String(dpi), pdf, join(dir, 'p')])
    return readdirSync(dir)
      .sort()
      .map((f) => parsePgm(readFileSync(join(dir, f))))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number // 毫米
}

function darkBox(g: Gray, pxPerMm: number, x0: number, y0: number, x1: number, y1: number, threshold = 128): Box | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (g.px[y * g.width + x] < threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { left: minX / pxPerMm, top: minY / pxPerMm, right: (maxX + 1) / pxPerMm, bottom: (maxY + 1) / pxPerMm }
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

// 每页四个角落里黑色块的外框（毫米，页面左上角为原点）。角落取 13mm × 10mm 的范围，10 像素 / 毫米
export function markBoxes(pdf: string): Record<Corner, Box | null>[] {
  const dpi = 254
  const mm = dpi / 25.4
  return renderPages(pdf, dpi).map((g) => {
    const w = Math.round(13 * mm)
    const h = Math.round(10 * mm)
    return {
      tl: darkBox(g, mm, 0, 0, w, h),
      tr: darkBox(g, mm, g.width - w, 0, g.width, h),
      bl: darkBox(g, mm, 0, g.height - h, w, g.height),
      br: darkBox(g, mm, g.width - w, g.height - h, g.width, g.height)
    }
  })
}

// 定位块应在的位置：距页边 offsetX / offsetY，宽 width 高 height（毫米），容差 tol
export function expectedMark(corner: Corner): Box {
  const { offsetX, offsetY, width, height } = CARD_MARK
  const left = corner === 'tl' || corner === 'bl' ? offsetX : 210 - offsetX - width
  const top = corner === 'tl' || corner === 'tr' ? offsetY : 297 - offsetY - height
  return { left, top, right: left + width, bottom: top + height }
}

// 返回问题列表；空数组表示每页四角的定位块都在应有的位置上（误差不超过 tol 毫米）
export function checkMarks(pdf: string, tol = 0.5): string[] {
  const problems: string[] = []
  markBoxes(pdf).forEach((page, i) => {
    for (const corner of ['tl', 'tr', 'bl', 'br'] as Corner[]) {
      const got = page[corner]
      const want = expectedMark(corner)
      if (!got) {
        problems.push(`第 ${i + 1} 页 ${corner} 没有定位块`)
        continue
      }
      const off = Math.max(Math.abs(got.left - want.left), Math.abs(got.top - want.top), Math.abs(got.right - want.right), Math.abs(got.bottom - want.bottom))
      if (off > tol) problems.push(`第 ${i + 1} 页 ${corner} 定位块偏离 ${off.toFixed(2)}mm（应在 ${want.left.toFixed(1)},${want.top.toFixed(1)}，实际 ${got.left.toFixed(1)},${got.top.toFixed(1)}）`)
    }
  })
  return problems
}

// 每页里「横贯版心」的黑色横线（黑框的上下边）的纵向位置（毫米）。版心 184mm 宽，线要占到 98.5% 以上才算
export function horizontalEdges(pdf: string): number[][] {
  const dpi = 127
  const mm = dpi / 25.4
  return renderPages(pdf, dpi).map((g) => {
    const x0 = Math.floor(CARD_PAGE.marginX * mm) + 4
    const x1 = Math.floor((210 - CARD_PAGE.marginX) * mm) - 4
    const need = 0.985 * (x1 - x0)
    const rows: boolean[] = []
    for (let y = 0; y < g.height; y++) {
      let n = 0
      for (let x = x0; x < x1; x++) if (g.px[y * g.width + x] < 110) n++
      rows.push(n >= need)
    }
    const edges: number[] = []
    for (let y = 0; y < g.height; ) {
      if (!rows[y]) {
        y++
        continue
      }
      let e = y
      while (e < g.height && rows[e]) e++
      edges.push(Math.round(((y + e) / 2 / mm) * 10) / 10)
      y = e
    }
    return edges
  })
}

// 每页的黑框边必须成对（上边、下边）：奇数条说明有黑框被分页拆开。
// 传了 expectedBoxes（信息框 + 各答题框的总数）时再核对总数：黑框被拆开但每片都带上下边（box-decoration-break: clone）时，
// 每页的横边仍是成对的，只有总数会多出来
export function checkBoxEdges(pdf: string, expectedBoxes?: number): string[] {
  const problems: string[] = []
  const pages = horizontalEdges(pdf)
  pages.forEach((edges, i) => {
    if (edges.length % 2 !== 0) problems.push(`第 ${i + 1} 页有 ${edges.length} 条黑框横边，不成对（有黑框被拆开）`)
  })
  const total = pages.reduce((n, edges) => n + Math.floor(edges.length / 2), 0)
  if (expectedBoxes !== undefined && total !== expectedBoxes) problems.push(`黑框共 ${total} 个，应为 ${expectedBoxes} 个（有黑框被拆成了几片）`)
  return problems
}
