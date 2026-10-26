// 下载前自检：把草稿里会影响下载结果的问题列成清单，每条带类型、说明和相关题号，弹窗据此提示并支持点击定位。
// 纯函数，不依赖 Electron。计数、缺答案、未设分值一律取自 structureOf，与编辑器、试卷库、版本历史用同一个口径。
import type { ExportKind, ExportOptions, PaperDraft } from '../../shared/domain.ts'
import { formatQuestionNos, type ExportCheck, type ExportIssue } from '../../shared/export.ts'
import { chineseNumeral, formatScore, hasVisibleContent, normalizeScore, numberItems, structureOf } from '../../shared/numbering.ts'

function issue(type: ExportIssue['type'], blocking: boolean, message: string, questionNos: number[] = [], sectionIndex: number | null = null): ExportIssue {
  return { type, blocking, message, questionNos, questionLabel: formatQuestionNos(questionNos), sectionIndex }
}

export function checkDraft(draft: PaperDraft, options: ExportOptions, kind: ExportKind): ExportCheck {
  const sections = draft.sections
  const structure = structureOf(sections)
  if (structure.questionCount === 0) {
    return { kind, questionCount: 0, answerMissingCount: 0, issues: [issue('empty-paper', true, '试卷里还没有题目，无法下载')], blocked: true }
  }

  const issues: ExportIssue[] = []
  const count = structure.questionCount
  const missing = structure.missingAnswerNos

  // 答案只有试卷的卷尾 / 题后用得到，答题卡不涉及
  if (kind === 'paper' && options.answerPosition !== 'none') {
    if (missing.length === count) {
      issues.push(issue('no-answers', true, `全部 ${count} 题都没有答案，不能下载答案在卷尾或题后的教师版；请先添加答案，或下载学生版`, missing))
    } else if (missing.length > 0) {
      issues.push(issue('partial-answers', false, `第 ${formatQuestionNos(missing)} 题没有答案，教师版里这些题不显示答案`, missing))
    }
  }

  // 题干没有文字也没有图片：这几题下载出来是空白的
  const emptyStem = numberItems(sections).flatMap((n) => (hasVisibleContent(n.item.stemHtml) ? [] : Array.from({ length: n.lastNo - n.firstNo + 1 }, (_, k) => n.firstNo + k)))
  if (emptyStem.length > 0) issues.push(issue('empty-stem', false, `第 ${formatQuestionNos(emptyStem)} 题的题干是空的，下载出来这几题只有题号`, emptyStem))

  const unscored = structure.unscoredNos
  if (unscored.length > 0) {
    const where = kind === 'paper' ? '试卷抬头不显示全卷满分，这些题也不标分值' : '答题卡上这些题的框头不显示分值'
    issues.push(
      unscored.length === count
        ? issue('unscored', false, `整卷都没有设置分值：${kind === 'paper' ? '试卷抬头不显示全卷满分，各题也不标分值' : '答题卡上各题的框头不显示分值'}`, unscored)
        : issue('unscored', false, `第 ${formatQuestionNos(unscored)} 题没有设置分值：${where}`, unscored)
    )
  }

  // 大题序号按编辑器里显示的位置说（第二大题）。空大题下载时跳过，后面的大题序号顺延
  structure.sections.forEach((section) => {
    if (section.questionCount === 0) issues.push(issue('empty-section', false, `第${chineseNumeral(section.index + 1)}大题没有题目，下载时会跳过它，后面的大题序号顺延`, [], section.index))
    else if (section.title.trim() === '') issues.push(issue('unnamed-section', false, `第${chineseNumeral(section.index + 1)}大题没有名称，下载出来这一大题的标题只有序号`, [], section.index))
  })

  const byOrigin = new Map<number, number[]>()
  for (const n of numberItems(sections)) {
    if (n.item.originQuestionId == null) continue
    byOrigin.set(n.item.originQuestionId, [...(byOrigin.get(n.item.originQuestionId) ?? []), n.firstNo])
  }
  for (const nos of byOrigin.values()) {
    if (nos.length > 1) issues.push(issue('duplicate-question', false, `第 ${formatQuestionNos(nos)} 题是同一道原题`, nos))
  }

  const target = normalizeScore(draft.targetScore)
  if (target != null) {
    const total = structure.totalScore ?? 0
    const diffTenths = Math.round(target * 10) - Math.round(total * 10)
    if (diffTenths !== 0) {
      const gap = formatScore(Math.abs(diffTenths) / 10)
      issues.push(issue('score-mismatch', false, `全卷分值合计 ${formatScore(total)} 分，目标满分 ${formatScore(target)} 分，${diffTenths > 0 ? `还差 ${gap} 分` : `多出 ${gap} 分`}`))
    }
  }

  issues.sort((a, b) => Number(b.blocking) - Number(a.blocking)) // 稳定排序：阻止项在前，其余保持上面的顺序
  return { kind, questionCount: count, answerMissingCount: missing.length, issues, blocked: issues.some((i) => i.blocking) }
}
