// 版本与下载记录的文字摘要
import { editionOf, type AnswerPosition, type ExportOptions, type ExportRecord, type SourcePosition, type StructureSummary, type VersionOrigin } from '@shared/domain'
import { formatScore } from '@shared/numbering'

// 用词与下载弹窗一致：版别「学生版 / 教师版」，答案位置「卷尾 / 题后」，试题来源「不显示 / 题文前 / 答案处」，作答区域「不留 / 留作答区域」
const ANSWER: Record<Exclude<AnswerPosition, 'none'>, string> = { end: '卷尾', after: '题后' }
const SOURCE: Record<SourcePosition, string> = { none: '不显示', 'before-stem': '题文前', answer: '答案处' }

export const ORIGIN_LABEL: Record<VersionOrigin, string> = {
  manual: '手动保存',
  download: '下载时自动保存',
  before_restore: '恢复前自动保存'
}

// 试卷记录的配置：学生版写「来源：不显示 · 作答区域：不留」，教师版前面加「答案：卷尾」
export function optionsSummary(options: ExportOptions): string {
  const parts = [`来源：${SOURCE[options.sourcePosition]}`, `作答区域：${options.answerArea ? '留作答区域' : '不留'}`]
  if (options.answerPosition !== 'none') parts.unshift(`答案：${ANSWER[options.answerPosition]}`)
  return parts.join(' · ')
}

// 一条下载记录的配置说明：答题卡只有自己的配置（A4、只出 PDF），不套用试卷的来源与作答区域
export function recordSummary(record: ExportRecord): string {
  return record.kind === 'answer-sheet' ? 'A4 答题卡' : optionsSummary(record.options)
}

// S7：版本列表里的结构摘要「3 个大题 · 21 题 · 100 分」；有题没设分时补一句
export function structureText(summary: StructureSummary): string {
  if (summary.questionCount === 0) return summary.sectionCount === 0 ? '空白试卷' : `${summary.sectionCount} 个大题 · 还没有题目`
  const parts = [`${summary.sectionCount} 个大题`, `${summary.questionCount} 题`]
  if (summary.totalScore != null) parts.push(`${formatScore(summary.totalScore)} 分`)
  const unscored = summary.unscoredCount > 0 && summary.totalScore != null ? `（${summary.unscoredCount} 题未设分）` : ''
  return `${parts.join(' · ')}${unscored}`
}

export const editionLabel = editionOf
