// 把试题库里的题放进一份试卷：取草稿 → 按题型找大题放置（appendQuestions，与编辑器「＋」同一套）→ 保存草稿。
import type { LibraryQuestion } from '@shared/domain'
import { appendQuestions } from '@shared/draft'
import { numberItems, numberLabel } from '@shared/numbering'

export interface Added {
  paperId: number
  title: string
  label: string // 放进试卷后的题号，如「12」「5～7」
}

export async function addQuestionToPaper(paperId: number, question: LibraryQuestion): Promise<Added> {
  const { papers } = window.workbench
  const paper = await papers.get(paperId)
  const { draft, placed } = appendQuestions(paper.draft, [question])
  // appendQuestions 只返回大题；目标满分等草稿上的其他字段要原样带回去
  await papers.saveEdits(paperId, { draft: { ...paper.draft, sections: draft.sections } })
  const entry = numberItems(draft.sections).find((n) => n.item.id === placed[0].itemId)
  return { paperId, title: paper.title, label: entry ? numberLabel(entry) : '' }
}
