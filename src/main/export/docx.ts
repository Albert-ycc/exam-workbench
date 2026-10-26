// 整卷 → Word（.docx）。把白名单标签转成段落、文字格式、表格、图片；选项用制表位排版，不出表格框线。
// 不依赖 Electron：图片由调用方预先准备好（SVG 等需要栅格化的在隐藏窗口里完成），通过 ImageLookup 取。
import {
  AlignmentType,
  BorderStyle,
  Document,
  type EmphasisMarkType,
  Footer,
  ImageRun,
  LeaderType,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type ParagraphChild
} from 'docx'
import { ANSWER_KEY_TITLE, STUDENT_INFO_FIELDS, STUDENT_INFO_GAP_MM, WRITING_LINE_MM, documentNodes, keyLabelWidthMm, type ExportDocument } from './document.ts'
import { blockify, collectImages, stripInvalidXmlChars, walk, type ElementNode, type HNode } from './html-tree.ts'
import { MAX_IMAGE_HEIGHT_PX, displaySize, type RasterType } from './image-src.ts'

export interface DocxImage {
  data: Uint8Array
  type: RasterType
  width: number // 自然尺寸，CSS 像素（放大过的小图仍是放大前的尺寸）
  height: number
  upscaled?: boolean // 小图放大 3 倍后的位图
}
export type ImageLookup = (src: string) => DocxImage

// ---------- 版面常量 ----------

const mmToTwips = (mm: number): number => Math.round((mm * 1440) / 25.4)
const PX_TWIPS = 15 // 96 dpi：1 像素 = 15 twips
const PAGE = { width: 11906, height: 16838 } // A4
const MARGIN = { top: mmToTwips(20), bottom: mmToTwips(20), left: mmToTwips(18), right: mmToTwips(18) }
export const TEXT_WIDTH_TWIPS = PAGE.width - MARGIN.left - MARGIN.right
const BODY_SIZE = 21 // 五号 10.5pt（半磅）
const EM = BODY_SIZE * 10 // 一个汉字宽，twips
const FONT_BODY = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: '宋体' }
const FONT_HEAD = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: '黑体' }
const LINE = 336 // 1.4 倍行距，行高约 1.6 个字高，与 PDF 的 line-height 一致
const PARA_AFTER = 60
const ITEM_BEFORE = 100
const ANSWER_INDENT = mmToTwips(3)
const LINE_COLOR = '333333'

// ---------- 行内内容 ----------

interface Fmt {
  b?: boolean
  i?: boolean
  u?: boolean
  dot?: boolean // 着重号
  sub?: boolean
  sup?: boolean
}
type Piece = { t: 'text'; text: string; fmt: Fmt } | { t: 'br' } | { t: 'tab' } | { t: 'img'; node: ElementNode }

function collectPieces(nodes: HNode[], fmt: Fmt, out: Piece[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push({ t: 'text', text: node.text, fmt })
      continue
    }
    switch (node.tag) {
      case 'br':
        out.push({ t: 'br' })
        break
      case 'img':
        out.push({ t: 'img', node })
        break
      case 'b':
      case 'strong':
        collectPieces(node.children, { ...fmt, b: true }, out)
        break
      case 'i':
        collectPieces(node.children, { ...fmt, i: true }, out)
        break
      case 'em':
        // 入库线把组卷网的着重号输出为 <em data-role="dot">，用 Word 的着重号，不是斜体
        collectPieces(node.children, node.attrs['data-role'] === 'dot' ? { ...fmt, dot: true } : { ...fmt, i: true }, out)
        break
      case 'u':
        collectPieces(node.children, { ...fmt, u: true }, out)
        break
      case 'sub':
        collectPieces(node.children, { ...fmt, sub: true, sup: false }, out)
        break
      case 'sup':
        collectPieces(node.children, { ...fmt, sup: true, sub: false }, out)
        break
      case 'p':
      case 'div':
      case 'li':
        collectPieces(node.children, fmt, out)
        out.push({ t: 'text', text: ' ', fmt: {} })
        break
      default:
        collectPieces(node.children, fmt, out)
    }
  }
}

// HTML 空白折叠：连续空白合成一个，行首与段尾的丢掉；nbsp 与全角空格保留
function collapse(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  let prevSpace = true
  for (const piece of pieces) {
    if (piece.t === 'text') {
      let s = piece.text.replace(/[ \t\r\n\f]+/g, ' ')
      if (prevSpace) s = s.replace(/^ /, '')
      if (s === '') continue
      out.push({ ...piece, text: s })
      prevSpace = s.endsWith(' ')
    } else {
      out.push(piece)
      prevSpace = piece.t !== 'img'
    }
  }
  for (let k = out.length - 1; k >= 0; k--) {
    const last = out[k]
    if (last.t === 'text') {
      last.text = last.text.replace(/ $/, '')
      if (last.text === '') {
        out.splice(k, 1)
        continue
      }
    }
    break
  }
  return out
}

// 文字宽度（twips）。选项排成几列、数据表列宽都靠它。
// 默认是估算：全角字符一个汉字宽，其余半个；真正生成 Word 时由隐藏窗口里按实际字体测量（measure.ts），估算只用于没有测量结果的场合
export type TextMeasure = (text: string, bold: boolean) => number

export function estimateTextWidth(value: string): number {
  let w = 0
  for (const ch of value) {
    const c = ch.codePointAt(0)!
    // 圈码 ①②③（U+2460 起）在宋体里是全角，不在 CJK 区段里，要单列
    const wide =
      (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x2010 && c <= 0x201f) || c === 0x3000 || (c >= 0x2460 && c <= 0x24ff)
    w += wide ? EM : EM / 2
  }
  return w
}

export interface MeasureRequest {
  text: string
  bold: boolean
}
export const measureKey = (text: string, bold: boolean): string => `${bold ? 'b' : 'r'}\u0000${text}`

interface Ctx {
  images: ImageLookup
  measure: TextMeasure
  imageSeq: { n: number } // 本文档内图片的序号；docx 库自带的编号是全进程累加的，同一份内容多次生成会不一样
  maxWidthPx: number // 图片可用最大宽度
  widthTwips: number // 文字可用宽度（制表位、表格列宽用）
  indent?: { left: number; hanging?: number }
  leftBar?: boolean // 答案块左侧竖线
  keepNext?: boolean // 本块的段落都与下一段同页（题干与它的作答留白不拆开）
  before?: { value: number } // 下一个段落的段前间距，用掉即清零
  align?: (typeof AlignmentType)[keyof typeof AlignmentType]
}

function imageDisplay(node: ElementNode, ctx: Ctx): { width: number; height: number; image: DocxImage } {
  const image = ctx.images(node.attrs.src ?? '')
  return { ...displaySize(node.attrs, image, ctx.maxWidthPx, MAX_IMAGE_HEIGHT_PX), image }
}

function pieceWidth(piece: Piece, ctx: Ctx): number {
  if (piece.t === 'text') return ctx.measure(piece.text, piece.fmt.b === true)
  if (piece.t === 'img') return imageDisplay(piece.node, ctx).width * PX_TWIPS
  return 0
}

function runsOf(pieces: Piece[], ctx: Ctx): ParagraphChild[] {
  const hasText = pieces.some((p) => p.t === 'text')
  return pieces.map((piece): ParagraphChild => {
    if (piece.t === 'br') return new TextRun({ break: 1 })
    if (piece.t === 'tab') return new TextRun({ children: [new Tab()] })
    if (piece.t === 'text') {
      return new TextRun({
        text: stripInvalidXmlChars(piece.text),
        bold: piece.fmt.b || undefined,
        italics: piece.fmt.i || undefined,
        underline: piece.fmt.u ? { type: UnderlineType.SINGLE } : undefined,
        // 着重号在字下方（中文习惯）：w:em 取 underDot；库的类型只列了 dot（字上方），所以绕过类型
        emphasisMark: piece.fmt.dot ? { type: 'underDot' as unknown as typeof EmphasisMarkType.DOT } : undefined,
        subScript: piece.fmt.sub || undefined,
        superScript: piece.fmt.sup || undefined
      })
    }
    const { width, height, image } = imageDisplay(piece.node, ctx)
    // 与文字同行的小图（公式）：网页里是垂直居中，Word 默认底边落在基线上，下移半个图高减去半个 x 高
    const dropHalfPoints = hasText && height <= 60 ? Math.round(Math.max(0, height * 0.75 * 0.5 - 2.6) * 2) : 0
    const seq = ++ctx.imageSeq.n
    return new ImageRun({
      type: image.type,
      data: image.data,
      transformation: { width, height },
      altText: { id: String(seq), name: `图片${seq}`, description: piece.node.attrs.alt ?? '' },
      // w:position 取半磅整数：带单位的写法（-5pt）新版 Word 认，旧版 Word 与 WPS 不一定认；库的类型只收带单位的，所以绕过类型
      ...(dropHalfPoints >= 1 ? { run: { position: `-${dropHalfPoints}` as unknown as `-${number}pt` } } : {})
    })
  })
}

interface ParaExtra {
  keepNext?: boolean
  tabStops?: number[]
  label?: Piece[] // 并入段首的标号（卷尾答案的题号）
}

function paragraphOf(pieces: Piece[], ctx: Ctx, extra: ParaExtra = {}): Paragraph {
  const all = extra.label ? [...extra.label, ...pieces] : pieces
  const before = ctx.before?.value ?? 0
  if (ctx.before) ctx.before.value = 0
  return new Paragraph({
    children: runsOf(collapse(all), ctx),
    alignment: ctx.align,
    keepNext: extra.keepNext ?? ctx.keepNext,
    spacing: { before, after: PARA_AFTER, line: LINE },
    indent: ctx.indent ? { left: ctx.indent.left, hanging: ctx.indent.hanging } : undefined,
    tabStops: extra.tabStops?.map((position) => ({ type: TabStopType.LEFT, position })),
    border: ctx.leftBar ? { left: { style: BorderStyle.SINGLE, size: 8, space: 6, color: '8A8A8A' } } : undefined
  })
}

// ---------- 块级内容 ----------

function pieceListOf(nodes: HNode[]): Piece[] {
  const out: Piece[] = []
  collectPieces(nodes, {}, out)
  return out
}

// 选项：每个单元格是一个选项；用制表位排成整齐的列，不出现表格线。
// 列数从每行的选项数起，放不下时减少列数（最后退成每行一个）。
// 多小题块的选项表第一格是小题号（data-role="option-label"），号码单独占一列，选项在它右边对齐。
function optionsParagraphs(node: ElementNode, ctx: Ctx): Paragraph[] {
  const cells: Piece[][] = []
  let label: Piece[] | null = null
  let perRow = 0
  if (node.tag === 'table') {
    for (const row of tableRows(node)) {
      let rowCells = cellsOf(row)
      if (label === null && rowCells[0]?.attrs['data-role'] === 'option-label') {
        label = collapse(pieceListOf(rowCells[0].children))
        rowCells = rowCells.slice(1)
      }
      perRow = Math.max(perRow, rowCells.length)
      for (const c of rowCells) cells.push(collapse(pieceListOf(c.children)))
    }
  } else {
    const items = node.children.filter((c): c is ElementNode => c.type === 'el')
    perRow = items.length
    for (const c of items) cells.push(collapse(pieceListOf([c])))
  }
  const filled = cells.filter((c) => c.length > 0)
  if (filled.length === 0) return label && label.length > 0 ? [paragraphOf(label, ctx)] : []
  const base = ctx.indent?.left ?? 0
  const labelWidth = label && label.length > 0 ? Math.max(mmToTwips(9), Math.ceil(label.reduce((sum, p) => sum + pieceWidth(p, ctx), 0) * 1.06) + mmToTwips(2)) : 0
  const avail = ctx.widthTwips - labelWidth
  const widths = filled.map((c) => c.reduce((sum, p) => sum + pieceWidth(p, ctx), 0) * 1.06)
  const gap = mmToTwips(4)
  let cols = Math.max(1, perRow)
  while (cols > 1 && widths.some((w) => w > avail / cols - gap)) cols--
  const slot = Math.floor(avail / cols)
  const stops = Array.from({ length: cols }, (_, k) => base + labelWidth + slot * k).slice(labelWidth > 0 ? 0 : 1)
  const paragraphs: Paragraph[] = []
  for (let start = 0; start < filled.length; start += cols) {
    const pieces: Piece[] = []
    const first = start === 0 && labelWidth > 0
    if (first) pieces.push(...label!, { t: 'tab' })
    filled.slice(start, start + cols).forEach((cell, k) => {
      if (k > 0) pieces.push({ t: 'tab' })
      pieces.push(...cell)
    })
    const indent = labelWidth > 0 ? { left: base + labelWidth, hanging: first ? labelWidth : undefined } : ctx.indent
    paragraphs.push(paragraphOf(pieces, { ...ctx, indent }, { tabStops: stops, keepNext: start + cols < filled.length }))
  }
  return paragraphs
}

function writingLineParagraphs(node: ElementNode): Paragraph[] {
  const count = Math.max(1, node.children.filter((c) => c.type === 'el').length)
  const border = { style: BorderStyle.SINGLE, size: 4, space: 0, color: LINE_COLOR }
  return Array.from(
    { length: count },
    () =>
      new Paragraph({
        children: [],
        keepLines: true, // 横线行可以跨页，但每行本身不拆
        spacing: { before: 0, after: 0, line: mmToTwips(WRITING_LINE_MM), lineRule: LineRuleType.EXACT },
        // 相邻段落边框相同时 Word 会合并成一组，只在最后画线；between 让每行下面都有线
        border: { bottom: border, between: border }
      })
  )
}

function spacer(heightTwips: number): Paragraph {
  return new Paragraph({ children: [], spacing: { before: 0, after: 0, line: heightTwips, lineRule: LineRuleType.EXACT } })
}

function tableRows(table: ElementNode): ElementNode[] {
  const rows: ElementNode[] = []
  walk(table.children, (n) => {
    if (n.tag === 'tr') rows.push(n)
  })
  return rows
}

function cellsOf(row: ElementNode): ElementNode[] {
  return row.children.filter((c): c is ElementNode => c.type === 'el' && (c.tag === 'td' || c.tag === 'th'))
}

const span = (v: string | undefined): number => {
  const n = v ? parseInt(v, 10) : 1
  return Number.isInteger(n) && n > 0 ? Math.min(n, 50) : 1
}

function dataTable(table: ElementNode, ctx: Ctx): Table {
  const rows = tableRows(table)
  // 列数与每列估计宽度（含左右内边距）
  const grid: number[] = []
  const occupied: number[] = [] // 各列被上方跨行单元格占用到第几行
  rows.forEach((row, r) => {
    let col = 0
    for (const cell of cellsOf(row)) {
      while ((occupied[col] ?? 0) > r) col++
      const cs = span(cell.attrs.colspan)
      const rs = span(cell.attrs.rowspan)
      const w = Math.max(
        mmToTwips(8),
        Math.max(0, ...blockify(cell.children).map((b) => collapse(pieceListOf([b])).reduce((sum, p) => sum + pieceWidth(p, ctx), 0))) * 1.15 + 2 * 100 + 40
      )
      for (let k = 0; k < cs; k++) {
        grid[col + k] = Math.max(grid[col + k] ?? 0, w / cs)
        if (rs > 1) occupied[col + k] = r + rs
      }
      col += cs
    }
  })
  const colCount = Math.max(1, grid.length)
  for (let k = 0; k < colCount; k++) grid[k] = grid[k] ?? mmToTwips(8)
  const total = grid.reduce((a, b) => a + b, 0)
  const scale = total > ctx.widthTwips ? ctx.widthTwips / total : 1
  const columnWidths = grid.map((w) => Math.max(mmToTwips(7), Math.floor(w * scale)))
  // 只有原页面上带框线的数据表（data-role="bordered"）才画框线，其余是组卷网的排版表格
  const border = table.attrs['data-role'] === 'bordered' ? { style: BorderStyle.SINGLE, size: 4, color: LINE_COLOR } : { style: BorderStyle.NONE, size: 0, color: 'auto' }
  const cellCtx: Ctx = { ...ctx, before: undefined, indent: undefined, leftBar: false, maxWidthPx: Math.max(40, ctx.maxWidthPx / colCount) }

  const tableRowsOut = rows.map((row) => {
    const cells = cellsOf(row)
    return new TableRow({
      cantSplit: true,
      children: cells.map((cell) => {
        const colSpan = span(cell.attrs.colspan)
        const rowSpan = span(cell.attrs.rowspan)
        const content = blocksToDocx(blockify(cell.children), { ...cellCtx, widthTwips: Math.max(1000, Math.floor(ctx.widthTwips / colCount)) })
        return new TableCell({
          children: content.length > 0 ? content : [new Paragraph({ children: [] })],
          columnSpan: colSpan > 1 ? colSpan : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 30, bottom: 30, left: 100, right: 100 }
        })
      })
    })
  })
  return new Table({
    rows: tableRowsOut,
    columnWidths,
    layout: TableLayoutType.FIXED,
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }
  })
}

function listParagraphs(node: ElementNode, ctx: Ctx): Paragraph[] {
  const items = node.children.filter((c): c is ElementNode => c.type === 'el' && c.tag === 'li')
  return items.map((li, k) => {
    const label = node.tag === 'ol' ? `${k + 1}.` : '•'
    const pieces: Piece[] = [{ t: 'text', text: label, fmt: {} }, { t: 'tab' }, ...pieceListOf(li.children)]
    const left = (ctx.indent?.left ?? 0) + mmToTwips(6)
    return paragraphOf(pieces, { ...ctx, indent: { left, hanging: mmToTwips(6) } }, { tabStops: [left] })
  })
}

function blocksToDocx(blocks: HNode[], ctx: Ctx): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.trim() !== '') out.push(paragraphOf([{ t: 'text', text: block.text, fmt: {} }], ctx))
      continue
    }
    const role = block.attrs['data-role']
    switch (block.tag) {
      case 'p':
        out.push(paragraphOf(pieceListOf(block.children), role === 'right-aligned' ? { ...ctx, align: AlignmentType.RIGHT } : ctx))
        break
      case 'div':
        if (role === 'writing-lines') out.push(...writingLineParagraphs(block))
        else if (role === 'options') out.push(...optionsParagraphs(block, ctx))
        else out.push(...blocksToDocx(blockify(block.children), ctx))
        break
      case 'table':
        if (role === 'options') out.push(...optionsParagraphs(block, ctx))
        else if (tableRows(block).length > 0) out.push(dataTable(block, ctx), spacer(120))
        break
      case 'ol':
      case 'ul':
        out.push(...listParagraphs(block, ctx))
        break
      case 'li':
        out.push(paragraphOf(pieceListOf(block.children), ctx))
        break
      default:
        break
    }
  }
  return out
}

// ---------- 整卷 ----------

const BASE_CTX = { maxWidthPx: TEXT_WIDTH_TWIPS / PX_TWIPS, widthTwips: TEXT_WIDTH_TWIPS }

function headingParagraph(value: string, opts: { size: number; center?: boolean; before: number; after: number; pageBreak?: boolean; rule?: boolean }): Paragraph {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : undefined,
    keepNext: true,
    pageBreakBefore: opts.pageBreak,
    spacing: { before: opts.before, after: opts.after, line: 300 },
    border: opts.rule ? { bottom: { style: BorderStyle.SINGLE, size: 6, space: 4, color: '000000' } } : undefined,
    children: [new TextRun({ text: stripInvalidXmlChars(value), bold: true, size: opts.size, font: FONT_HEAD })]
  })
}

// 整卷里要用到的图片地址，以及同一地址在正文里要求的最大显示宽度（SVG 栅格化按它放大）
export interface ImageNeed {
  src: string
  wantedWidth: number | null
}
export function imageNeeds(doc: ExportDocument): ImageNeed[] {
  const needs = new Map<string, number | null>()
  for (const img of collectImages(documentNodes(doc))) {
    const src = img.attrs.src ?? ''
    const w = parseFloat(img.attrs.width ?? '')
    const wanted = Number.isFinite(w) && w > 0 ? w : null
    const prev = needs.get(src)
    needs.set(src, prev === undefined ? wanted : wanted === null ? prev : Math.max(prev ?? 0, wanted))
  }
  return [...needs].map(([src, wantedWidth]) => ({ src, wantedWidth }))
}

// 题干分块输出，决定每一块是否与下一段同页：
// - 有作答留白：整题与留白同页；
// - 否则第一块（题号行）与下一块同页，避免题号孤零零留在页底；
// - 答案紧跟在题后时，最后一块与答案同页
function itemBody(item: ExportDocument['sections'][number]['items'][number], ctx: Ctx): (Paragraph | Table)[] {
  const blocks = item.body
  if (item.space) return blocksToDocx(blocks, { ...ctx, keepNext: true })
  const out: (Paragraph | Table)[] = []
  blocks.forEach((block, i) => {
    const keep = (i === 0 && blocks.length > 1) || (i === blocks.length - 1 && Boolean(item.answer))
    out.push(...blocksToDocx([block], { ...ctx, before: i === 0 ? ctx.before : undefined, keepNext: keep }))
  })
  return out
}

// 一组块级内容里除最后一块外都与下一段同页（答案块里来源行、文字与图片不拆开）
function keepAllButLast(blocks: HNode[], ctx: Ctx): (Paragraph | Table)[] {
  return [...blocksToDocx(blocks.slice(0, -1), { ...ctx, keepNext: true }), ...blocksToDocx(blocks.slice(-1), { ...ctx, keepNext: false })]
}

// 「全卷满分」说明行：小一号、居中
function totalNoteParagraph(value: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: { before: 0, after: 80, line: 300 },
    children: [new TextRun({ text: stripInvalidXmlChars(value), size: 19 })]
  })
}

// 「班级＿＿ 座号＿＿ 小组＿＿ 姓名＿＿」填写行：每个横线是一个带下划线前导符的制表位，整行居中靠左缩进
function studentInfoParagraph(): Paragraph {
  const label = 2 * EM
  const gap = mmToTwips(STUDENT_INFO_GAP_MM)
  const total = STUDENT_INFO_FIELDS.reduce((sum, f) => sum + label + mmToTwips(f.blankMm), 0) + gap * (STUDENT_INFO_FIELDS.length - 1)
  let x = Math.max(0, Math.floor((TEXT_WIDTH_TWIPS - total) / 2))
  const left = x
  const stops: { type: typeof TabStopType.LEFT; position: number; leader?: (typeof LeaderType)[keyof typeof LeaderType] }[] = []
  const children: TextRun[] = []
  STUDENT_INFO_FIELDS.forEach((f, k) => {
    x += label + mmToTwips(f.blankMm)
    stops.push({ type: TabStopType.LEFT, position: x, leader: LeaderType.UNDERSCORE })
    children.push(new TextRun({ text: f.label }), new TextRun({ children: [new Tab()] }))
    if (k < STUDENT_INFO_FIELDS.length - 1) {
      x += gap
      stops.push({ type: TabStopType.LEFT, position: x })
      children.push(new TextRun({ children: [new Tab()] }))
    }
  })
  return new Paragraph({ keepNext: true, spacing: { before: 0, after: 100, line: 300 }, indent: { left }, tabStops: stops, children })
}

export function buildDocxDocument(doc: ExportDocument, images: ImageLookup, measure: TextMeasure = estimateTextWidth): Document {
  const children: (Paragraph | Table)[] = [headingParagraph(doc.title, { size: 32, center: true, before: 0, after: 80 })]
  if (doc.totalNote) children.push(totalNoteParagraph(doc.totalNote))
  children.push(studentInfoParagraph())
  const base: Ctx = { ...BASE_CTX, images, measure, imageSeq: { n: 0 } }

  doc.sections.forEach((section) => {
    children.push(headingParagraph(section.heading + section.scoreNote, { size: 22, before: 240, after: 120 }))
    for (const item of section.items) {
      const before = { value: ITEM_BEFORE }
      children.push(...itemBody(item, { ...base, before }))
      if (item.answer) {
        const answerCtx: Ctx = {
          ...base,
          before: { value: 60 },
          leftBar: true,
          indent: { left: ANSWER_INDENT },
          maxWidthPx: base.maxWidthPx - ANSWER_INDENT / PX_TWIPS,
          widthTwips: base.widthTwips - ANSWER_INDENT
        }
        children.push(...keepAllButLast(item.answer, answerCtx))
      }
      if (item.space) children.push(spacer(mmToTwips(item.space.mm)))
    }
  })

  if (doc.answerKey) {
    children.push(headingParagraph(ANSWER_KEY_TITLE, { size: 26, before: 0, after: 200, pageBreak: true, rule: true }))
    // 每题一行：左列题号（长题号在列内折行），右列答案内容。无边框的两列表格
    const labelW = mmToTwips(keyLabelWidthMm(doc.answerKey))
    const bodyW = TEXT_WIDTH_TWIPS - labelW
    const none = { style: BorderStyle.NONE, size: 0, color: 'auto' }
    for (const row of doc.answerKey) {
      const cellCtx: Ctx = { ...base, maxWidthPx: (bodyW - 160) / PX_TWIPS, widthTwips: bodyW - 160 }
      const content = blocksToDocx(row.nodes, cellCtx)
      children.push(
        new Table({
          columnWidths: [labelW, bodyW],
          width: { size: TEXT_WIDTH_TWIPS, type: WidthType.DXA },
          layout: TableLayoutType.FIXED,
          borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
          rows: [
            new TableRow({
              cantSplit: true, // 整行不拆页，题号不会留在上一页
              children: [
                new TableCell({ width: { size: labelW, type: WidthType.DXA }, margins: { left: 0, right: 80, top: 0, bottom: 0 }, children: [paragraphOf([{ t: 'text', text: row.label, fmt: { b: true } }], { ...base })] }),
                new TableCell({ width: { size: bodyW, type: WidthType.DXA }, margins: { left: 80, right: 0, top: 0, bottom: 0 }, children: content.length > 0 ? content : [new Paragraph({ children: [] })] })
              ]
            })
          ]
        }),
        spacer(100)
      )
    }
  }

  return new Document({
    creator: '组卷工作台',
    title: stripInvalidXmlChars(doc.title),
    styles: {
      default: {
        document: { run: { font: FONT_BODY, size: BODY_SIZE }, paragraph: { spacing: { line: LINE } } }
      }
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: MARGIN } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                // 「第1页（共8页）」，与 PDF 页脚一致
                children: [new TextRun({ children: ['第', PageNumber.CURRENT, '页（共', PageNumber.TOTAL_PAGES, '页）'], size: 18 })]
              })
            ]
          })
        },
        children
      }
    ]
  })
}

// 生成时哪些文字要测宽：用估算跑一遍整份文档，记下 pieceWidth 问过的文字
export function collectMeasureRequests(doc: ExportDocument, images: ImageLookup): MeasureRequest[] {
  const seen = new Map<string, MeasureRequest>()
  buildDocxDocument(doc, images, (text, bold) => {
    seen.set(measureKey(text, bold), { text, bold })
    return estimateTextWidth(text)
  })
  return [...seen.values()]
}

export async function buildDocx(doc: ExportDocument, images: ImageLookup, measure: TextMeasure = estimateTextWidth): Promise<Buffer> {
  return Packer.toBuffer(buildDocxDocument(doc, images, measure))
}

