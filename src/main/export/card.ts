// 答题卡的内容规则：从版本快照得到「答题卡」的中间结构（按大题、按题型排出的块），渲染成 HTML 在 render-card-html.ts。
// 纯函数，不依赖 Electron。题型分类沿用 document.ts 的作答区分类（answerAreaKind），分值说明沿用 shared/numbering.ts。
import type { PaperSnapshot } from '../../shared/domain.ts'
import { boxScoreLabel, numberItems, numberLabel, sectionScoreNote, structureOf, type NumberedItem } from '../../shared/numbering.ts'
import { LONG_UNDERLINE_MIN, WRITING_LINE_MM, answerAreaKind, exportHeadings, writingLineCount } from './document.ts'
import { blockify, parseHtml, stripInvalidXmlChars, textContent, walk, type HNode } from './html-tree.ts'

// 排版配置：高度、每行题数这类数值都在这里，版式要调只改这一处
export const CARD_CONFIG = {
  choicePerRow: 10, // 选择题表格每行放几题
  choiceMaxRows: 6, // 一个选择题框最多放几行，超出的拆到下一个框（保证黑框不比一页高）
  blankMaxCells: 28, // 一个填空题框最多放几格（两栏，一格一道题）
  blankColumns: 2,
  blankFullRowFrom: 3, // 一道题有这么多条横线时独占一整行
  blankMaxLines: 4, // 一道题最多画几条横线
  solveAreaMm: { calc: 38, solve: 62 }, // 计算 / 解答类没有小问时的作答区高度（毫米）
  subAreaMm: { calc: 24, solve: 34 }, // 有小问时每个小问的作答区高度（毫米）
  maxSubQuestions: 10, // 识别出的小问超过这个数时不再按小问分隔（多半是编号文字而不是小问），整题给一块作答区
  boxMaxMm: 240, // 一个黑框作答区的总高度上限（A4 版心约 263mm）
  writingLineMm: WRITING_LINE_MM, // 书面表达横线行高（毫米），与试卷里的作答横线一致
  writingDefaultLines: 12 // 题干里没有横线可参照时书面表达画几行
} as const

export type CardKind = 'choice' | 'blank' | 'solve' | 'writing'

export interface CardHeading {
  title: string // 「一、选择题」
  note: string // 「（共 10 小题，每小题 4 分，共 40 分）」（sectionScoreNote）
}

// 每个块是一个黑框；heading 只出现在一个大题的第一个框里
export interface ChoiceBlock {
  type: 'choice'
  heading: CardHeading | null
  rows: number[][] // 每行的题号，最后一行可能不满
}
export interface BlankBlock {
  type: 'blank'
  heading: CardHeading | null
  items: { no: number; lines: number }[] // lines：这道题画几条横线
}
export interface SolveBlock {
  type: 'solve'
  heading: CardHeading | null
  label: string // 「17.」「28～30.」
  score: string // 「（8 分）」，未设分值为空
  areas: number[] // 作答区高度（毫米）；多于一个表示按小问分隔
}
export interface WritingBlock {
  type: 'writing'
  heading: CardHeading | null
  label: string
  score: string
  lines: number
  lineMm: number
}
export type CardBlock = ChoiceBlock | BlankBlock | SolveBlock | WritingBlock

export interface CardDocument {
  title: string
  blocks: CardBlock[]
}

// ---------- 题型分类 ----------

const CHOICE_WORDS = /选择|判断|单选|多选|单项|语音|辨音|听力|完形|五选五/

function hasOptions(nodes: HNode[]): boolean {
  let found = false
  walk(nodes, (n) => {
    if (n.attrs['data-role'] === 'options') found = true
  })
  return found
}

// 答题卡上的题型。书面表达、计算 / 解答类沿用作答区分类；其余（选择、判断、填空，以及判断不出的）再分选择与填空：
// 题型标签里有「完形」「单选」「判断」等字样是选择类（完形填空、阅读理解的选择小题按题号逐个占格），
// 只有「填空」是填空类；标签判断不出时看大题标题，再看题干里有没有选项
export function cardKindOf(sectionTitle: string, questionType: string, stem: HNode[]): CardKind {
  const area = answerAreaKind(sectionTitle, questionType)
  if (area === 'writing') return 'writing'
  if (area === 'calc' || area === 'solve') return 'solve'
  for (const text of [questionType, sectionTitle]) {
    if (CHOICE_WORDS.test(text)) return 'choice'
    if (text.includes('填空')) return 'blank'
  }
  return hasOptions(stem) ? 'choice' : 'blank'
}

// ---------- 从题干读出的版式线索 ----------

// 小问数：题干里按顺序出现的「（1）」「（2）」…，要出现在段首或句末标点之后（排除「f(1)=2」这类算式里的括号数字），
// 连续编号到几就是几；只有一个「（1）」不算小问
export function subQuestionCount(stem: HNode[]): number {
  const text = flatText(stem)
  const marker = /(?:^|\n|[；;。．.？?！!])[ \t 　]*[（(][ \t]*([1-9]\d?)[ \t]*[）)]/g
  let next = 1
  for (const m of text.matchAll(marker)) if (Number(m[1]) === next) next++
  return next - 1 >= 2 ? next - 1 : 0
}

// 块级元素之间与 <br> 处断行的纯文字
function flatText(nodes: HNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') out += node.text
    else if (node.tag === 'br') out += '\n'
    else {
      const inner = flatText(node.children)
      out += ['p', 'div', 'li', 'tr'].includes(node.tag) ? `\n${inner}\n` : inner
    }
  }
  return out
}

// 一道填空题要画几条横线：题干里的连续下划线，以及只含空白的 <u>（组卷网用它画填空线）
export function blankCount(stem: HNode[]): number {
  let count = (textContent(stem).match(/[_＿]{3,}/g) ?? []).length
  walk(stem, (n) => {
    if (n.tag === 'u' && /^[\s 　]*$/.test(textContent(n.children)) && n.children.length > 0) count++
  })
  return Math.min(CARD_CONFIG.blankMaxLines, Math.max(1, count))
}

// 书面表达画几行：题干里有作答横线时按它的长度折算（与试卷的作答区域同一个规则），没有就用默认行数
function writingLines(stem: HNode[]): number {
  const underscores = [...textContent(stem)].filter((c) => c === '_' || c === '＿').length
  return underscores >= LONG_UNDERLINE_MIN ? writingLineCount(underscores) : CARD_CONFIG.writingDefaultLines
}

// ---------- 分值 ----------

function solveAreas(stem: HNode[], kind: 'calc' | 'solve', count: number): number[] {
  const subs = subQuestionCount(stem)
  const split = subs >= 2 && subs <= CARD_CONFIG.maxSubQuestions
  const areas = split ? Array<number>(subs).fill(CARD_CONFIG.subAreaMm[kind]) : [CARD_CONFIG.solveAreaMm[kind] * count]
  const total = areas.reduce((a, b) => a + b, 0)
  return total > CARD_CONFIG.boxMaxMm ? areas.map((a) => Math.floor((a * CARD_CONFIG.boxMaxMm) / total)) : areas
}

// ---------- 整张答题卡 ----------

interface Entry {
  n: NumberedItem
  kind: CardKind
  stem: HNode[]
}

const nosOf = (n: NumberedItem): number[] => Array.from({ length: n.lastNo - n.firstNo + 1 }, (_, k) => n.firstNo + k)
const chunk = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, k) => list.slice(k * size, (k + 1) * size))

export function buildCardDocument(snapshot: PaperSnapshot): CardDocument {
  const structure = structureOf(snapshot.sections)
  if (structure.questionCount === 0) throw new Error('试卷里还没有题目，无法下载')
  const numbered = numberItems(snapshot.sections)
  const headings = exportHeadings(snapshot.sections)
  const blocks: CardBlock[] = []

  snapshot.sections.forEach((section, si) => {
    const info = structure.sections[si]
    if (headings[si] === null) return // 空大题不上答题卡，序号与试卷一致（exportHeadings）
    let heading: CardHeading | null = { title: headings[si]!, note: sectionScoreNote(info) }
    const takeHeading = (): CardHeading | null => {
      const h = heading
      heading = null
      return h
    }

    const entries: Entry[] = numbered
      .filter((n) => n.sectionIndex === si)
      .map((n) => {
        const stem = blockify(parseHtml(n.item.stemHtml))
        return { n, kind: cardKindOf(section.title, n.item.questionType, stem), stem }
      })

    // 相邻的同类选择题、填空题合成一个表格 / 一组横线；解答、书面表达每题一个框
    for (let i = 0; i < entries.length; ) {
      const entry = entries[i]
      if (entry.kind === 'choice' || entry.kind === 'blank') {
        let j = i
        while (j < entries.length && entries[j].kind === entry.kind) j++
        const run = entries.slice(i, j)
        i = j
        if (entry.kind === 'choice') {
          const rows = chunk(run.flatMap((e) => nosOf(e.n)), CARD_CONFIG.choicePerRow)
          for (const part of chunk(rows, CARD_CONFIG.choiceMaxRows)) blocks.push({ type: 'choice', heading: takeHeading(), rows: part })
        } else {
          const items = run.flatMap((e) => (e.n.firstNo === e.n.lastNo ? [{ no: e.n.firstNo, lines: blankCount(e.stem) }] : nosOf(e.n).map((no) => ({ no, lines: 1 }))))
          for (const part of chunk(items, CARD_CONFIG.blankMaxCells)) blocks.push({ type: 'blank', heading: takeHeading(), items: part })
        }
        continue
      }
      i++
      const label = `${numberLabel(entry.n)}.`
      const score = boxScoreLabel(entry.n.item, section)
      if (entry.kind === 'writing') blocks.push({ type: 'writing', heading: takeHeading(), label, score, lines: writingLines(entry.stem), lineMm: CARD_CONFIG.writingLineMm })
      else {
        const kind = answerAreaKind(section.title, entry.n.item.questionType) === 'calc' ? 'calc' : 'solve'
        blocks.push({ type: 'solve', heading: takeHeading(), label, score, areas: solveAreas(entry.stem, kind, entry.n.lastNo - entry.n.firstNo + 1) })
      }
    }
  })

  return { title: stripInvalidXmlChars(snapshot.title), blocks }
}
