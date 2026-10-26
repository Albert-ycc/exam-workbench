import type { PaperSummary } from '@shared/domain'
import { formatScore } from '@shared/numbering'


// 试卷库一行里的结构摘要：「21 题 · 100 分」（题数按题号计）；没设分值写「未设分」
export function structureLine(paper: PaperSummary): string {
  const { questionCount, totalScore } = paper.structure
  if (questionCount === 0) return '空白试卷'
  return `${questionCount} 题 · ${totalScore == null ? '未设分' : `${formatScore(totalScore)} 分`}`
}
