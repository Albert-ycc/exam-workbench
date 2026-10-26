// 答题卡 → 可打印的 HTML（PDF 输出用，renderPdfByCss）。纯函数。
// 版式按本地答题卡一比一：A4、四角黑色定位块、标题、信息框、第一页信息框下与其余页顶部的提示、按大题的黑框、页脚。
// 定位块、顶部提示、页脚用 Chromium 的页边距盒（@page 的 @top-left-corner 等）画，黑框用 break-inside: avoid 流式分页，
// 实测（调研报告 05）定位块误差 ≤0.2mm，黑框不会被拆开。
import { escapeText } from './html-tree.ts'
import type { BlankBlock, CardBlock, CardDocument, CardHeading, ChoiceBlock, SolveBlock, WritingBlock } from './card.ts'
import { CARD_CONFIG } from './card.ts'

// 页面几何（毫米），数值取自本地答题卡的源文件
export const CARD_PAGE = {
  marginX: 13, // 黑框左右各留 13mm，宽 184mm
  marginTop: 21.6, // 第二页起的黑框顶边
  firstMarginTop: 12.6, // 第一页：标题顶边，标题块高 9mm，信息框顶边同为 21.6mm
  marginBottom: 12.2,
  tipTop: 14.2, // 第二页起顶部提示文字的顶边
  footerTop: 1.6 // 页脚文字距版心下边
} as const
// 四角定位块：距页边 6.8mm / 6.2mm，5×2.6mm
export const CARD_MARK = { offsetX: 6.8, offsetY: 6.2, width: 5, height: 2.6 } as const

export const CARD_TIP = '请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效'
const CARD_NOTES = [
  '1. 答题前，先将班级、座号、小组、姓名填写清楚。',
  '2. 选择题答案填入表格；非选择题用 0.5 毫米黑色签字笔书写。',
  '3. 请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效。'
]
const FOOTER_TITLE_MAX = 36 // 页脚里试卷名最多显示的字数，超出的省略

const FONT_BODY = '"Times New Roman", "Songti SC", "SimSun", "宋体", serif'
const FONT_HEAD = '"Times New Roman", "Heiti SC", "STHeiti", "SimHei", "黑体", sans-serif'

// CSS 字符串字面量：反斜杠、双引号、换行、「<」（防止标题里的 </style> 提前结束样式块）都要转义
function cssString(value: string): string {
  return value.replace(/[\\"<]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `).replace(/[\r\n]+/g, ' ')
}

function footerTitle(title: string): string {
  const chars = [...title]
  return chars.length > FOOTER_TITLE_MAX ? `${chars.slice(0, FOOTER_TITLE_MAX).join('')}…` : title
}

// 标题字号：试卷名长时缩小，仍放不下就自然折行
function titleSizePt(title: string): number {
  const chars = [...title].length + 3
  return chars <= 30 ? 15.5 : chars <= 38 ? 13.5 : 12
}

const corner = (v: 'top' | 'bottom', h: 'left' | 'right'): string =>
  `@${v}-${h}-corner { content: ""; background: linear-gradient(#000, #000) no-repeat ${h} ${CARD_MARK.offsetX}mm ${v} ${CARD_MARK.offsetY}mm / ${CARD_MARK.width}mm ${CARD_MARK.height}mm; }`

const css = (doc: CardDocument): string => `
@page {
  size: A4;
  margin: ${CARD_PAGE.marginTop}mm ${CARD_PAGE.marginX}mm ${CARD_PAGE.marginBottom}mm ${CARD_PAGE.marginX}mm;
  ${corner('top', 'left')}
  ${corner('top', 'right')}
  ${corner('bottom', 'left')}
  ${corner('bottom', 'right')}
  @top-center { content: "${cssString(CARD_TIP)}"; font: 9pt ${FONT_BODY}; vertical-align: top; padding-top: ${CARD_PAGE.tipTop}mm; }
  @bottom-center { content: "${cssString(footerTitle(doc.title))} 答题卡　第 " counter(page) " 页（共 " counter(pages) " 页）"; font: 9.5pt ${FONT_BODY}; vertical-align: top; padding-top: ${CARD_PAGE.footerTop}mm; }
}
@page :first { margin-top: ${CARD_PAGE.firstMarginTop}mm; @top-center { content: none; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: ${FONT_BODY}; font-size: 10.5pt; color: #000; line-height: 1.35; }
h1.title { text-align: center; font-family: ${FONT_HEAD}; font-weight: bold; font-size: ${titleSizePt(doc.title)}pt; letter-spacing: 0.3pt; line-height: 7mm; margin: 0 0 2mm; }
.box { border: 1.3pt solid #000; padding: 2.6mm 3.2mm; margin: 0 0 3.2mm; break-inside: avoid; box-decoration-break: clone; }
.sec { font-size: 10.5pt; margin-bottom: 1mm; }
.sec b { font-family: ${FONT_HEAD}; font-weight: 500; }
.qno { font-weight: bold; }
.line { display: inline-block; border-bottom: 1pt solid #000; height: 1em; vertical-align: -1px; }
/* 信息框 */
.info { display: flex; padding: 0; height: 28.5mm; margin-bottom: 2.7mm; }
.info .l { width: 86mm; border-right: 1pt solid #000; padding: 6.8mm 3.2mm 0; font-size: 11.5pt; }
.info .l div { display: flex; margin-bottom: 4.6mm; }
.info .l .f { display: inline-flex; align-items: flex-end; width: 50%; }
.info .l .line { width: 28.5mm; margin-left: 2.2mm; }
.info .r { flex: 1; padding: 2.2mm 3.2mm 0; font-size: 8.8pt; line-height: 1.6; }
.info .r .h { font-family: ${FONT_HEAD}; font-weight: 500; font-size: 9.8pt; margin-bottom: 0.4mm; }
.tip { text-align: center; font-size: 9pt; line-height: 3.2mm; margin: 0 0 3.2mm; }
/* 选择题：题号 / 答案两行的填写表格 */
.ct { border-collapse: collapse; margin: 2.2mm auto 0; font-size: 10.5pt; }
.ct th, .ct td { border: 0.9pt solid #000; text-align: center; width: 15.6mm; }
.ct th { font-weight: normal; width: 16mm; }
.ct td.x { border-color: transparent; }
.ct tr.no td, .ct tr.no th { height: 6.6mm; }
.ct tr.no td { font-weight: bold; }
.ct tr.ans th, .ct tr.ans td { height: 10mm; }
/* 填空题：两栏横线，一题多空时同一行多条线 */
.blank .grid { display: grid; grid-template-columns: repeat(${CARD_CONFIG.blankColumns}, 1fr); column-gap: 8mm; padding: 0 2mm; }
.blank .it { display: flex; align-items: flex-end; height: 10.4mm; }
.blank .it.full { grid-column: 1 / -1; }
.blank .it .n { font-weight: bold; }
.blank .it .line { flex: 1; margin-left: 2.2mm; }
/* 解答 / 计算 / 证明 / 作图：框头 + 作答区；有小问时按小问用虚线分隔 */
.qh { margin-top: 0.6mm; }
.subq { border-top: 1pt dashed #777; padding-top: 1.8mm; }
.qh + .subq { border-top: 0; }
/* 书面表达：横线格。最后一行的横线就是黑框的下边 */
.writing { padding-bottom: 0; }
.wl { border-bottom: 0.3mm solid #000; }
.wl:last-child { border-bottom: 0; }
.wlines { margin-top: 1.5mm; }
`

function headingHtml(h: CardHeading | null): string {
  return h ? `<div class="sec"><b>${escapeText(h.title)}</b>${escapeText(h.note)}</div>` : ''
}

function choiceHtml(b: ChoiceBlock): string {
  const perRow = CARD_CONFIG.choicePerRow
  const rows = b.rows
    .map((row) => {
      const pad = '<td class="x"></td>'.repeat(perRow - row.length)
      return `<tr class="no"><th>题号</th>${row.map((no) => `<td>${no}</td>`).join('')}${pad}</tr><tr class="ans"><th>答案</th>${row.map(() => '<td></td>').join('')}${pad}</tr>`
    })
    .join('')
  return `<div class="box choice">${headingHtml(b.heading)}<table class="ct">${rows}</table></div>`
}

function blankHtml(b: BlankBlock): string {
  const items = b.items
    .map((it) => `<div class="it${it.lines >= CARD_CONFIG.blankFullRowFrom ? ' full' : ''}"><span class="n">${it.no}.</span>${'<span class="line"></span>'.repeat(it.lines)}</div>`)
    .join('')
  return `<div class="box blank">${headingHtml(b.heading)}<div class="grid">${items}</div></div>`
}

function boxHead(b: SolveBlock | WritingBlock): string {
  return `<div class="qh"><span class="qno">${escapeText(b.label)}</span>${escapeText(b.score)}</div>`
}

function solveHtml(b: SolveBlock): string {
  const areas =
    b.areas.length > 1
      ? b.areas.map((mm, k) => `<div class="subq" style="height:${mm}mm">（${k + 1}）</div>`).join('')
      : `<div class="free" style="height:${b.areas[0]}mm"></div>`
  return `<div class="box solve">${headingHtml(b.heading)}${boxHead(b)}${areas}</div>`
}

function writingHtml(b: WritingBlock): string {
  const lines = Array.from({ length: b.lines }, () => `<div class="wl" style="height:${b.lineMm}mm"></div>`).join('')
  return `<div class="box writing">${headingHtml(b.heading)}${boxHead(b)}<div class="wlines">${lines}</div></div>`
}

const blockHtml = (b: CardBlock): string => (b.type === 'choice' ? choiceHtml(b) : b.type === 'blank' ? blankHtml(b) : b.type === 'solve' ? solveHtml(b) : writingHtml(b))

export function renderCardHtml(doc: CardDocument): string {
  const info = `<div class="box info"><div class="l"><div><span class="f">班级<span class="line"></span></span><span class="f">座号<span class="line"></span></span></div><div><span class="f">小组<span class="line"></span></span><span class="f">姓名<span class="line"></span></span></div></div>
<div class="r"><div class="h">注意事项</div>${CARD_NOTES.map((n) => `<div>${escapeText(n)}</div>`).join('')}</div></div>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeText(doc.title)} 答题卡</title><style>${css(doc)}</style></head>
<body>
<h1 class="title">${escapeText(doc.title)}　答题卡</h1>
${info}
<div class="tip">${escapeText(CARD_TIP)}</div>
${doc.blocks.map(blockHtml).join('\n')}
</body></html>`
}
