// 从试题库复制题目副本、按题型找大题放置：编辑器的拖入与「＋」、试题库页的「加入试卷」共用这一套
import type { DraftSection, LibraryQuestion, PaperDraft, PaperItem } from './domain'
import { primaryQuestionType } from './library.ts'

export const newId = (): string => crypto.randomUUID()

// 复制出题目副本，之后的修改只发生在副本上；不带分值，跟随所在大题的默认分值
export function copyFromQuestion(q: LibraryQuestion): PaperItem {
  return {
    id: newId(),
    originQuestionId: q.id,
    sourceLabel: q.sourceLabel,
    questionType: q.questionType,
    numberCount: q.numberCount,
    stemHtml: q.stemHtml,
    answerHtml: q.answerHtml
  }
}

// 组卷网题型标签形如「完形填空-15空」，大题名取「-」前的大类
export function sectionTitleFor(questionType: string): string {
  return primaryQuestionType(questionType.trim()) || '新大题'
}

// 找放置的大题：已有同题型大类题目的大题 → 大题名与题型大类相同的大题 → 没有（需要新建）
export function matchSection(sections: DraftSection[], questionType: string): DraftSection | undefined {
  const primary = primaryQuestionType(questionType.trim())
  if (!primary) return undefined
  return (
    sections.find((s) => s.items.some((i) => primaryQuestionType(i.questionType) === primary)) ??
    sections.find((s) => s.title.trim() === primary)
  )
}

export interface PlacedItem {
  itemId: string
  sectionId: string
  questionId: number
}

// 把若干原题依次追加进试卷：指定了大题就放进该大题末尾，否则按题型匹配大题，匹配不到就新建大题
export function appendQuestions(draft: PaperDraft, questions: LibraryQuestion[], preferredSectionId?: string | null): { draft: PaperDraft; placed: PlacedItem[] } {
  let sections = draft.sections
  const placed: PlacedItem[] = []
  for (const q of questions) {
    const item = copyFromQuestion(q)
    const target = (preferredSectionId ? sections.find((s) => s.id === preferredSectionId) : undefined) ?? matchSection(sections, q.questionType)
    if (target) {
      sections = sections.map((s) => (s.id === target.id ? { ...s, items: [...s.items, item] } : s))
      placed.push({ itemId: item.id, sectionId: target.id, questionId: q.id })
    } else {
      const section: DraftSection = { id: newId(), title: sectionTitleFor(q.questionType), items: [item] }
      sections = [...sections, section]
      placed.push({ itemId: item.id, sectionId: section.id, questionId: q.id })
    }
  }
  // 保留草稿上的其他字段（如目标满分）
  return { draft: { ...draft, sections }, placed }
}

// 试卷里已经用过的原题：原题 id → 所在题号（同一道原题可能出现多次）
export function originNumbers(sections: DraftSection[], numbered: { item: PaperItem; firstNo: number }[]): Map<number, number[]> {
  const map = new Map<number, number[]>()
  for (const n of numbered) {
    if (n.item.originQuestionId == null) continue
    map.set(n.item.originQuestionId, [...(map.get(n.item.originQuestionId) ?? []), n.firstNo])
  }
  void sections
  return map
}
