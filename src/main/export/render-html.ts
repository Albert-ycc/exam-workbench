// 整卷 → 可打印的 HTML（PDF 输出用）。纯函数。
// 版式：A4、页边距与页脚页码由 printToPDF 的参数给出，这里只管内容样式。
import { ANSWER_KEY_TITLE, STUDENT_INFO_FIELDS, STUDENT_INFO_GAP_MM, WRITING_LINE_MM, keyLabelWidthMm, type ExportDocument } from './document.ts'
import { escapeText, serializeNodes } from './html-tree.ts'

// 正文五号（10.5pt）与组卷网页面的 14px 字号一致，公式图按原像素尺寸显示即与文字等高
const CSS = `
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: #000;
  font-family: "Times New Roman", "SimSun", "宋体", "Songti SC", "STSong", serif;
  font-size: 10.5pt;
  line-height: 1.6;
  overflow-wrap: anywhere; /* 书面表达保留原样的长下划线时折行，不要缩成一行 */
}
h1.paper-title, h2.section-heading, h2.key-title {
  font-family: "Times New Roman", "SimHei", "黑体", "Heiti SC", "PingFang SC", sans-serif;
  font-weight: bold;
}
h1.paper-title { font-size: 16pt; text-align: center; margin: 0 0 2mm; line-height: 1.3; }
p.paper-total { font-size: 9.5pt; text-align: center; margin: 0 0 3mm; line-height: 1.3; }
/* 班级 座号 小组 姓名：横线用带下边框的行内块，宽度来自 STUDENT_INFO_FIELDS */
.student-info { text-align: center; margin: 0 0 4mm; line-height: 1.3; white-space: nowrap; }
.student-info .info-field { display: inline-block; margin: 0 ${STUDENT_INFO_GAP_MM / 2}mm; }
.student-info .info-blank { display: inline-block; height: 1em; margin-left: 1.2mm; border-bottom: 0.25mm solid #000; }
h2.section-heading { font-size: 11pt; margin: 6mm 0 3mm; line-height: 1.3; break-after: avoid; }
.item { margin: 0 0 3.5mm; }
.item.has-space { break-inside: avoid; } /* 题干与它的作答留白不拆到两页 */
/* 题号所在的第一段与下一段同页；紧挨着图片或表格的那一段也与它们同页，题号不会孤零零留在上一页 */
.item > p:first-child { break-after: avoid; }
.item p:has(+ p > img:only-child), .item p:has(+ table) { break-after: avoid; }
.item p { margin: 0 0 1.2mm; }
.item-answer { margin: 1.5mm 0 3mm; padding-left: 3mm; border-left: 0.6mm solid #8a8a8a; break-inside: avoid; }
.answer-space { width: 100%; }
p[data-role="answer-source"] { font-size: 9pt; color: #555; margin: 0 0 1mm; }
p[data-role="right-aligned"] { text-align: right; }
section.answer-key { break-before: page; }
h2.key-title { font-size: 13pt; margin: 0 0 6mm; padding-bottom: 2mm; border-bottom: 0.4mm solid #000; line-height: 1.3; }
.key-row { display: flex; margin: 0 0 4mm; break-inside: avoid; } /* 题号与答案同页 */
.key-row p { margin: 0 0 1.2mm; }
.key-num { flex: 0 0 var(--key-w, 13mm); font-weight: bold; }
.key-body { flex: 1 1 auto; min-width: 0; }
img { max-width: 100%; vertical-align: middle; }
img[width][height] { height: auto; }
table { border-collapse: collapse; margin: 1.5mm 0 2.5mm; }
td, th { padding: 1mm 2.5mm; vertical-align: middle; }
/* 只有原页面上带框线的数据表才画框线；其余表格是组卷网的排版表格 */
table[data-role="bordered"] td, table[data-role="bordered"] th { border: 0.25mm solid #333; }
table[data-role="options"] { margin: 0.5mm 0 2mm; }
table[data-role="options"] td, table[data-role="options"] th { padding: 0.4mm 6mm 0.4mm 0; vertical-align: top; }
/* 着重号：入库线输出为 <em data-role="dot">，不是斜体 */
em[data-role="dot"] { font-style: normal; text-emphasis: filled dot; text-emphasis-position: under; }
div[data-role="options"] { margin: 0.5mm 0 2mm; }
div[data-role="options"] > span { display: inline-block; margin: 0 8mm 0 0; }
div[data-role="writing-lines"] { margin: 1mm 0 3mm; }
div[data-role="writing-line"] { height: ${WRITING_LINE_MM}mm; border-bottom: 0.25mm solid #333; box-sizing: border-box; break-inside: avoid; }
ol, ul { margin: 1mm 0; padding-left: 6mm; }
`

export function renderHtml(doc: ExportDocument): string {
  const parts: string[] = [`<h1 class="paper-title">${escapeText(doc.title)}</h1>`]
  if (doc.totalNote) parts.push(`<p class="paper-total">${escapeText(doc.totalNote)}</p>`)
  const fields = STUDENT_INFO_FIELDS.map((f) => `<span class="info-field">${f.label}<span class="info-blank" style="width:${f.blankMm}mm"></span></span>`)
  parts.push(`<div class="student-info">${fields.join('')}</div>`)
  for (const section of doc.sections) {
    parts.push(`<section class="section"><h2 class="section-heading">${escapeText(section.heading + section.scoreNote)}</h2>`)
    for (const item of section.items) {
      parts.push(`<div class="item${item.space ? ' has-space' : ''}" data-first-no="${item.firstNo}">${serializeNodes(item.body)}`)
      if (item.answer) parts.push(`<div class="item-answer">${serializeNodes(item.answer)}</div>`)
      if (item.space) parts.push(`<div class="answer-space" data-kind="${item.space.kind}" style="height:${item.space.mm}mm"></div>`)
      parts.push('</div>')
    }
    parts.push('</section>')
  }
  if (doc.answerKey) {
    parts.push(`<section class="answer-key" style="--key-w:${keyLabelWidthMm(doc.answerKey)}mm"><h2 class="key-title">${ANSWER_KEY_TITLE}</h2>`)
    for (const row of doc.answerKey) {
      parts.push(`<div class="key-row"><span class="key-num">${escapeText(row.label)}</span><div class="key-body">${serializeNodes(row.nodes)}</div></div>`)
    }
    parts.push('</section>')
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ewb-asset: data:; style-src 'unsafe-inline'">
<title>${escapeText(doc.title)}</title><style>${CSS}</style></head>
<body>${parts.join('\n')}</body></html>`
}
