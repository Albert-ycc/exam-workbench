// 下载内容的生成规则：从版本快照 + 下载配置得到「整卷」的中间结构，PDF 与 Word 两个输出共用。
// 纯函数，不依赖 Electron，规则的单元测试都在 scripts/test-export.ts。
import { ANSWER_SPACE_MM } from '../../shared/export.ts'
import { editionOf, normalizeExportOptions, type DraftSection, type ExportOptions, type PaperSnapshot } from '../../shared/domain.ts'
import { answerKeyLabel, fillQuestionNumbers, hasVisibleContent, numberItems, numberLabel, paperItemNote, paperSectionNote, paperTotalNote, sectionHeading, structureOf, type NumberedItem, type SectionStructure } from '../../shared/numbering.ts'
import { blockify, collectImages, el, hasRenderableContent, parseHtml, stripInvalidXmlChars, text, textContent, type ElementNode, type HNode } from './html-tree.ts'
import { MAX_IMAGE_HEIGHT_PX, displaySize, parseImageSource } from './image-src.ts'

export const ANSWER_KEY_TITLE = '参考答案'
// 书面表达横线行高（毫米），来自方案 5.2；作答留白高度 ANSWER_SPACE_MM 在 shared/export.ts（下载弹窗的说明文字也用它）
export const WRITING_LINE_MM = 8
// 连续下划线达到这个长度才算「书面表达横线」；每 50 个下划线折成一行横线，至少 2 行、至多 20 行
export const LONG_UNDERLINE_MIN = 100
export const UNDERLINE_PER_LINE = 50

// 抬头的「班级 座号 小组 姓名」填写行（学生版、教师版都有）：标签与横线宽度（毫米），PDF 与 Word 共用，与本地试卷的抬头一致
export const STUDENT_INFO_FIELDS = [
  { label: '班级', blankMm: 26 },
  { label: '座号', blankMm: 19 },
  { label: '小组', blankMm: 19 },
  { label: '姓名', blankMm: 30 }
] as const
export const STUDENT_INFO_GAP_MM = 6

export type AnswerAreaKind = 'none' | 'calc' | 'solve' | 'writing'

function kindOfText(value: string): AnswerAreaKind | null {
  if (value.includes('书面表达')) return 'writing'
  if (value.includes('计算')) return 'calc'
  if (/解答|证明|应用|简答/.test(value)) return 'solve'
  if (/选择|判断|填空/.test(value)) return 'none'
  return null
}

// 作答区域类型：先看题目自己的题型标签（组卷网标签原文，如「解答题-计算题」，含「计算」就是计算题），
// 标签判断不出类别时再看所在大题的标题。编辑器自动建的大题名只取大类（「解答题」），所以标签必须排在前面
export function answerAreaKind(sectionTitle: string, questionType: string): AnswerAreaKind {
  return kindOfText(questionType) ?? kindOfText(sectionTitle) ?? 'none'
}

export interface AnswerSpace {
  kind: 'calc' | 'solve'
  mm: number
}

export interface ExportItem {
  firstNo: number
  lastNo: number
  body: HNode[] // 题干（块级节点），题号与「题文前」来源已并入第一段
  answer: HNode[] | null // 答案位置为「题后」时的答案
  space: AnswerSpace | null
}

export interface ExportSection {
  heading: string // 「一、选择题」，不含分值说明
  scoreNote: string // 分值说明（sectionScoreNote），本大题一题都没设分值时为空；渲染时紧跟在标题后
  items: ExportItem[]
}

export interface AnswerKeyRow {
  label: string // 「5」或「5、6、7」
  nodes: HNode[]
}

export interface ExportDocument {
  title: string
  totalNote: string // 「（全卷满分：150分）」，所有题都设了分值才有，否则为空
  edition: '学生版' | '教师版'
  options: ExportOptions // 已规整
  sections: ExportSection[]
  answerKey: AnswerKeyRow[] | null // 答案位置为「卷尾」时的参考答案
  missingAnswers: string[] // 答案位置不是「不显示」时，没有答案内容的题（题号标签，如「4」「8～22」）
}

// ---------- 内容变换 ----------

// 把前缀并入第一段开头；第一块不是段落时在前面补一个段落
export function prependToFirstParagraph(blocks: HNode[], prefix: HNode[]): HNode[] {
  const first = blocks[0]
  if (first?.type === 'el' && first.tag === 'p') {
    first.children.unshift(...prefix)
    return blocks
  }
  if (first?.type === 'el' && first.tag === 'div' && first.attrs['data-role'] !== 'writing-lines' && first.children.length > 0) {
    first.children = prependToFirstParagraph(first.children, prefix)
    return blocks
  }
  return [el('p', {}, prefix), ...blocks]
}

const LONG_RUN = new RegExp(`[_＿]{${LONG_UNDERLINE_MIN},}`, 'g')

export function writingLineCount(underscores: number): number {
  return Math.min(20, Math.max(2, Math.round(underscores / UNDERLINE_PER_LINE)))
}

function writingLines(count: number): ElementNode {
  return el('div', { 'data-role': 'writing-lines' }, Array.from({ length: count }, () => el('div', { 'data-role': 'writing-line' })))
}

function trimBreaks(nodes: HNode[]): HNode[] {
  const blank = (n: HNode): boolean => (n.type === 'el' && n.tag === 'br') || (n.type === 'text' && n.text.trim() === '')
  let start = 0
  let end = nodes.length
  while (start < end && blank(nodes[start])) start++
  while (end > start && blank(nodes[end - 1])) end--
  return nodes.slice(start, end)
}

function splitParagraph(p: ElementNode): HNode[] {
  const result: HNode[] = []
  let buffer: HNode[] = []
  const flush = (): void => {
    const kept = trimBreaks(buffer)
    if (hasRenderableContent(kept)) result.push(el('p', p.attrs, kept))
    buffer = []
  }
  for (const child of p.children) {
    if (child.type !== 'text' || !new RegExp(LONG_RUN.source).test(child.text)) {
      buffer.push(child)
      continue
    }
    let pos = 0
    for (const m of child.text.matchAll(LONG_RUN)) {
      const before = child.text.slice(pos, m.index)
      if (before) buffer.push(text(before))
      flush()
      result.push(writingLines(writingLineCount(m[0].length)))
      pos = m.index + m[0].length
    }
    const rest = child.text.slice(pos)
    if (rest) buffer.push(text(rest))
  }
  flush()
  return result
}

// 入库线把书面表达的整段下划线标成 <div data-role="writing-lines">（里面保留原下划线文本）。
// 要加作答区域（toLines）时按下划线数折成横线行；否则还原成普通段落，下划线原样保留
export function normalizeWritingDivs(blocks: HNode[], toLines: boolean): HNode[] {
  const out: HNode[] = []
  for (const block of blocks) {
    if (block.type !== 'el' || block.tag !== 'div') {
      out.push(block)
      continue
    }
    const isMarked = block.attrs['data-role'] === 'writing-lines'
    const alreadyLines = block.children.some((c) => c.type === 'el' && c.attrs['data-role'] === 'writing-line')
    if (!isMarked || alreadyLines) {
      block.children = normalizeWritingDivs(block.children, toLines)
      out.push(block)
      continue
    }
    const value = textContent(block.children)
    if (toLines) out.push(writingLines(writingLineCount([...value].filter((ch) => ch === '_' || ch === '＿').length)))
    else out.push(el('p', {}, [text(value.trim())]))
  }
  return out
}

// 书面表达：段落里连续的长下划线转成横线行；只处理段落或 div 的直接文字，嵌套更深的保持原样
export function convertWritingRuns(blocks: HNode[]): HNode[] {
  const out: HNode[] = []
  for (const block of blocks) {
    if (block.type === 'el' && block.tag === 'p') out.push(...splitParagraph(block))
    else if (block.type === 'el' && block.tag === 'div') {
      block.children = convertWritingRuns(block.children)
      out.push(block)
    } else out.push(block)
  }
  return out
}

// ---------- 整卷 ----------

// 小题号占位符只认 <span data-ewb-qno="数字"></span>（fillQuestionNumbers）；其余带这个属性的元素当普通 span，
// 输出时属性已被丢掉；题干文字里写着 data-ewb-qno 字样的，就是普通文字
function parseContent(html: string, firstNo: number, what: string, no: number): HNode[] {
  const nodes = blockify(parseHtml(fillQuestionNumbers(html, firstNo)))
  for (const img of collectImages(nodes)) {
    if (!parseImageSource(img.attrs.src ?? '')) throw new Error(`第 ${no} 题的${what}含有未保存到本地的图片，请在编辑器中删除或替换后再下载`)
  }
  return nodes
}

// 导出时每个大题的标题（「一、选择题」）。没有题目的大题不导出（试卷与答题卡都一样），它不占序号，后面的大题序号顺延：
// 第 2 大题是空的，第 3 大题就写成「二、…」。返回值按大题顺序对应，空大题为 null
export function exportHeadings(sections: DraftSection[]): (string | null)[] {
  let ordinal = 0
  return sections.map((section) => (section.items.length === 0 ? null : sectionHeading(ordinal++, stripInvalidXmlChars(section.title))))
}

// 试卷里的大题标题说明：本大题至少有一题设了分值才写（旧试卷和没设分值的大题标题保持原样）
function sectionNoteOf(section: SectionStructure): string {
  return section.questionCount > section.unscoredNos.length ? paperSectionNote(section) : ''
}

// 题号用全角句点「1．」，与组卷网页面和手排试卷一致；分值说明紧跟其后，不另加空格
export const questionNoText = (no: number): string => `${no}．`

export function buildExportDocument(snapshot: PaperSnapshot, rawOptions: ExportOptions): ExportDocument {
  const options = normalizeExportOptions(rawOptions)
  const numbered = numberItems(snapshot.sections)
  if (numbered.length === 0) throw new Error('试卷里还没有题目，无法下载')

  const structure = structureOf(snapshot.sections)
  const showAnswers = options.answerPosition !== 'none'
  const sourceLabelOf = (n: NumberedItem): string => stripInvalidXmlChars(n.item.sourceLabel).trim()
  const headings = exportHeadings(snapshot.sections)
  const sectionAt = new Map<number, ExportSection>()
  headings.forEach((heading, index) => heading !== null && sectionAt.set(index, { heading, scoreNote: sectionNoteOf(structure.sections[index]), items: [] }))
  const answerKey: AnswerKeyRow[] = []
  const missingAnswers: string[] = []
  let answerCount = 0

  for (const n of numbered) {
    const section = snapshot.sections[n.sectionIndex]
    const kind = answerAreaKind(section.title, n.item.questionType)
    const single = n.firstNo === n.lastNo

    let body = parseContent(n.item.stemHtml, n.firstNo, '题干', n.firstNo)
    const toLines = options.answerArea && kind === 'writing'
    body = normalizeWritingDivs(body, toLines)
    if (toLines) body = convertWritingRuns(body)
    const prefix: HNode[] = []
    const scoreNote = paperItemNote(n.item, section)
    if (single) prefix.push(text(questionNoText(n.firstNo)))
    if (scoreNote) prefix.push(text(scoreNote))
    if (options.sourcePosition === 'before-stem' && sourceLabelOf(n)) prefix.push(el('span', { 'data-role': 'source' }, [text(`（${sourceLabelOf(n)}）`)]))
    if (prefix.length > 0) body = prependToFirstParagraph(body, prefix)

    let answer: HNode[] | null = null
    // 有没有答案与下载前自检（check.ts）同一口径：shared/numbering.ts 的 hasVisibleContent
    if (showAnswers) {
      if (!hasVisibleContent(n.item.answerHtml)) missingAnswers.push(numberLabel(n))
      else {
        const nodes = parseContent(n.item.answerHtml!, n.firstNo, '答案', n.firstNo)
        answerCount++
        answer = options.sourcePosition === 'answer' && sourceLabelOf(n) ? [el('p', { 'data-role': 'answer-source' }, [text(`（${sourceLabelOf(n)}）`)]), ...nodes] : nodes
      }
    }
    if (answer && options.answerPosition === 'end') answerKey.push({ label: answerKeyLabel(n), nodes: answer })

    sectionAt.get(n.sectionIndex)!.items.push({
      firstNo: n.firstNo,
      lastNo: n.lastNo,
      body,
      answer: options.answerPosition === 'after' ? answer : null,
      space: options.answerArea && (kind === 'calc' || kind === 'solve') ? { kind, mm: ANSWER_SPACE_MM[kind] } : null
    })
  }

  if (showAnswers && answerCount === 0) throw new Error('试卷里没有任何带答案的题目，请把答案位置改为「不显示」')

  return {
    title: stripInvalidXmlChars(snapshot.title),
    totalNote: paperTotalNote(structure),
    edition: editionOf(options),
    options,
    sections: [...sectionAt.values()],
    answerKey: options.answerPosition === 'end' ? answerKey : null,
    missingAnswers
  }
}

// 卷尾答案左侧题号列的宽度（毫米）：按最长的题号估算，PDF 与 Word 共用，保证「5、6、7」这类合并题号放得下；
// 完形填空这类 15 个小题的块题号很长，列宽封顶 28mm，超出的在列内折行
export const KEY_LABEL_MAX_MM = 28
export function keyLabelWidthMm(rows: AnswerKeyRow[]): number {
  const widest = Math.max(0, ...rows.map((r) => [...r.label].reduce((w, ch) => w + (ch === '、' ? 3.8 : 1.95), 0)))
  return Math.min(KEY_LABEL_MAX_MM, Math.max(13, Math.ceil(widest + 4)))
}

// 整卷里出现的所有内容节点（题干、答案、卷尾答案）
export function documentNodes(doc: ExportDocument): HNode[] {
  const nodes: HNode[] = []
  for (const section of doc.sections) {
    for (const item of section.items) {
      nodes.push(...item.body)
      if (item.answer) nodes.push(...item.answer)
    }
  }
  for (const row of doc.answerKey ?? []) nodes.push(...row.nodes)
  return nodes
}

// PDF 用：显示高度超过上限（MAX_IMAGE_HEIGHT_MM）的图片，把缩小后的宽高写回属性，浏览器按它排版，不会被页面截掉。
// naturalOf 给出图片自然尺寸，认不出的不处理。返回处理了几张
export function limitImageHeights(doc: ExportDocument, naturalOf: (src: string) => { width: number; height: number } | null, maxWidthPx: number): number {
  let changed = 0
  for (const img of collectImages(documentNodes(doc))) {
    const natural = naturalOf(img.attrs.src ?? '')
    if (!natural) continue
    const free = displaySize(img.attrs, natural, maxWidthPx)
    const fit = displaySize(img.attrs, natural, maxWidthPx, MAX_IMAGE_HEIGHT_PX)
    if (fit.height < free.height - 0.5) {
      img.attrs.width = String(Math.round(fit.width))
      img.attrs.height = String(Math.round(fit.height))
      changed++
    }
  }
  return changed
}
