// 大题序号与题号的唯一算法，界面显示与导出共用
import type { DraftSection, PaperItem } from './domain'

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function chineseNumeral(n: number): string {
  if (n <= 0) return String(n)
  if (n < 10) return CN_DIGITS[n]
  if (n < 20) return '十' + (n === 10 ? '' : CN_DIGITS[n - 10])
  if (n < 100) return CN_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 === 0 ? '' : CN_DIGITS[n % 10])
  return String(n)
}

// 「一、单选题」
export function sectionHeading(index: number, title: string): string {
  return `${chineseNumeral(index + 1)}、${title}`
}

export interface NumberedItem {
  item: PaperItem
  sectionIndex: number
  firstNo: number // 本题块第一个题号
  lastNo: number // 本题块最后一个题号
}

// 一个题目块最多占的题号数：防止异常数据展开题号时占满内存
export const MAX_NUMBER_COUNT = 500

// 全卷连续编号：每个题目块占 numberCount 个题号
export function numberItems(sections: DraftSection[]): NumberedItem[] {
  const result: NumberedItem[] = []
  let next = 1
  sections.forEach((section, sectionIndex) => {
    for (const item of section.items) {
      const count = Math.min(MAX_NUMBER_COUNT, Math.max(1, item.numberCount || 1))
      result.push({ item, sectionIndex, firstNo: next, lastNo: next + count - 1 })
      next += count
    }
  })
  return result
}

// 题号标签：单题「5」，多小题块「5～7」；卷尾答案用「5、6、7」
export function numberLabel(n: NumberedItem): string {
  return n.firstNo === n.lastNo ? String(n.firstNo) : `${n.firstNo}～${n.lastNo}`
}

export function answerKeyLabel(n: NumberedItem): string {
  const nos: number[] = []
  for (let i = n.firstNo; i <= n.lastNo; i++) nos.push(i)
  return nos.join('、')
}

// 把内容里的小题号占位符替换成实际题号（字符串处理，主进程与界面都能用）
export function fillQuestionNumbers(html: string, firstNo: number): string {
  return html.replace(/<span data-ewb-qno="(\d+)"><\/span>/g, (_m, k: string) => String(firstNo + Number(k)))
}

// 内容是否有看得见的东西：有文字或有图片。只有空段落、空白、&nbsp; 的答案视为没有答案（自检与下载同一口径）
export function hasVisibleContent(html: string | null | undefined): boolean {
  if (!html) return false
  if (/<img\b/i.test(html)) return true
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
  return text.trim().length > 0
}

// ---------- 分值与试卷结构（编辑器、结构面板、版本历史、试卷库、导出、答题卡共用） ----------
// 分值内部按十分之一分取整计算，避免 0.5 分累加的浮点误差

const toTenths = (score: number): number => Math.round(score * 10)
const fromTenths = (tenths: number): number => tenths / 10

// 规整分值：非数字、负数、超过 999 视为未设；按 0.5 步长取整
export function normalizeScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999) return null
  return Math.round(value * 2) / 2
}

export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

// 有效的每小题分值：题目单独设置的优先，其次大题默认分值
export function effectiveScore(item: PaperItem, section: DraftSection): number | null {
  return normalizeScore(item.score) ?? normalizeScore(section.defaultScore)
}

export interface SectionStructure {
  index: number
  sectionId: string
  title: string
  heading: string // 「一、单选题」
  questionCount: number // 题号数
  blockCount: number // 题目块数
  firstNo: number | null
  lastNo: number | null
  perScore: number | null // 全部题号已设分且相同时的每小题分值
  totalScore: number // 已设分值的合计
  unscoredNos: number[] // 未设分值的题号
  missingAnswerNos: number[] // 没有答案的题号
}

export interface PaperStructure {
  sections: SectionStructure[]
  questionCount: number
  totalScore: number | null // 一题都没设分为 null
  allScored: boolean
  unscoredNos: number[]
  missingAnswerNos: number[]
}

export function structureOf(sections: DraftSection[]): PaperStructure {
  const numbered = numberItems(sections)
  const result: SectionStructure[] = sections.map((section, index) => {
    const entries = numbered.filter((n) => n.sectionIndex === index)
    let totalTenths = 0
    const perScores = new Set<number>()
    const unscoredNos: number[] = []
    const missingAnswerNos: number[] = []
    for (const n of entries) {
      const score = effectiveScore(n.item, section)
      const nos = Array.from({ length: n.lastNo - n.firstNo + 1 }, (_, k) => n.firstNo + k)
      if (score == null) unscoredNos.push(...nos)
      else {
        totalTenths += toTenths(score) * nos.length
        perScores.add(toTenths(score))
      }
      if (!hasVisibleContent(n.item.answerHtml)) missingAnswerNos.push(...nos)
    }
    const questionCount = entries.reduce((sum, n) => sum + n.lastNo - n.firstNo + 1, 0)
    return {
      index,
      sectionId: section.id,
      title: section.title,
      heading: sectionHeading(index, section.title),
      questionCount,
      blockCount: entries.length,
      firstNo: entries.length ? entries[0].firstNo : null,
      lastNo: entries.length ? entries[entries.length - 1].lastNo : null,
      perScore: unscoredNos.length === 0 && perScores.size === 1 ? fromTenths([...perScores][0]) : null,
      totalScore: fromTenths(totalTenths),
      unscoredNos,
      missingAnswerNos
    }
  })
  const questionCount = result.reduce((sum, s) => sum + s.questionCount, 0)
  const unscoredNos = result.flatMap((s) => s.unscoredNos)
  const scoredAny = unscoredNos.length < questionCount
  return {
    sections: result,
    questionCount,
    totalScore: scoredAny ? fromTenths(result.reduce((sum, s) => sum + toTenths(s.totalScore), 0)) : null,
    allScored: questionCount > 0 && unscoredNos.length === 0,
    unscoredNos,
    missingAnswerNos: result.flatMap((s) => s.missingAnswerNos)
  }
}

// 大题标题后的分值说明：全部设分且相同「（共 10 小题，每小题 4 分，共 40 分）」；
// 全部设分但不同「（共 9 小题，满分 86 分）」；没有设全分值只写「（共 N 小题）」；空大题不写
export function sectionScoreNote(section: SectionStructure): string {
  if (section.questionCount === 0) return ''
  if (section.unscoredNos.length > 0) return `（共 ${section.questionCount} 小题）`
  if (section.perScore != null) {
    return `（共 ${section.questionCount} 小题，每小题 ${formatScore(section.perScore)} 分，共 ${formatScore(section.totalScore)} 分）`
  }
  return `（共 ${section.questionCount} 小题，满分 ${formatScore(section.totalScore)} 分）`
}

// 单题分值标注：单题「（本题 4 分）」；多小题块「（每小题 1 分，共 15 分）」；未设分值返回空串
export function itemScoreNote(item: PaperItem, section: DraftSection): string {
  const score = effectiveScore(item, section)
  if (score == null) return ''
  const count = Math.max(1, item.numberCount || 1)
  return count === 1 ? `（本题 ${formatScore(score)} 分）` : `（每小题 ${formatScore(score)} 分，共 ${formatScore(fromTenths(toTenths(score) * count))} 分）`
}

// 答题卡解答框头的分值：单题「（8 分）」；多小题块同 itemScoreNote；未设分值返回空串
export function boxScoreLabel(item: PaperItem, section: DraftSection): string {
  const score = effectiveScore(item, section)
  if (score == null) return ''
  return Math.max(1, item.numberCount || 1) === 1 ? `（${formatScore(score)} 分）` : itemScoreNote(item, section)
}

// 全卷满分说明：所有题号都设了分值才显示
export function paperTotalNote(structure: PaperStructure): string {
  return structure.allScored && structure.totalScore != null ? `（全卷满分：${formatScore(structure.totalScore)}分）` : ''
}
