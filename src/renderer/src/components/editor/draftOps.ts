// 草稿的纯函数操作：每个函数返回新草稿，没有变化时原样返回同一个对象（调用方据此判断要不要保存）。
// 一律保留草稿上 sections 以外的字段（目标满分），所以都经过 withSections。
import type { DraftSection, PaperDraft, PaperItem } from '@shared/domain'
import { normalizeScore } from '@shared/numbering'
import { copyFromQuestion, newId, sectionTitleFor } from '@shared/draft'

export { copyFromQuestion, newId, sectionTitleFor }

const withSections = (draft: PaperDraft, sections: DraftSection[]): PaperDraft => ({ ...draft, sections })

// 放置位置：sectionId 为 null 表示新建大题；beforeItemId 为 null 表示放到该大题末尾
export interface DropMark {
  sectionId: string | null
  beforeItemId: string | null
}

export interface RemovedItem {
  item: PaperItem
  sectionId: string
  index: number
}

export interface RemovedSection {
  section: DraftSection
  index: number
}

function insertAt(items: PaperItem[], item: PaperItem, beforeItemId: string | null): PaperItem[] {
  const index = beforeItemId == null ? -1 : items.findIndex((i) => i.id === beforeItemId)
  return index < 0 ? [...items, item] : [...items.slice(0, index), item, ...items.slice(index)]
}

function place(sections: DraftSection[], mark: DropMark, item: PaperItem): DraftSection[] {
  const target = mark.sectionId == null ? undefined : sections.find((s) => s.id === mark.sectionId)
  if (!target) return [...sections, { id: newId(), title: sectionTitleFor(item.questionType), items: [item] }]
  return sections.map((s) => (s.id === target.id ? { ...s, items: insertAt(s.items, item, mark.beforeItemId) } : s))
}

export function insertItem(draft: PaperDraft, mark: DropMark, item: PaperItem): PaperDraft {
  return withSections(draft, place(draft.sections, mark, item))
}

function layoutOf(sections: DraftSection[]): string {
  return sections.map((s) => `${s.id}:${s.items.map((i) => i.id).join(',')}`).join('|')
}

export function moveItem(draft: PaperDraft, itemId: string, mark: DropMark): PaperDraft {
  if (mark.beforeItemId === itemId) return draft
  const item = draft.sections.flatMap((s) => s.items).find((i) => i.id === itemId)
  if (!item) return draft
  const without = draft.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) }))
  const next = place(without, mark, item)
  // 放回原位等于没有变化
  return layoutOf(next) === layoutOf(draft.sections) ? draft : withSections(draft, next)
}

// 上移 / 下移一位；到了大题边界就越过边界进入相邻大题（上移进上一大题末尾，下移进下一大题开头）。F3 的菜单与 Alt+↑↓ 共用
export function moveItemBy(draft: PaperDraft, itemId: string, delta: -1 | 1): PaperDraft {
  const sectionIndex = draft.sections.findIndex((s) => s.items.some((i) => i.id === itemId))
  if (sectionIndex < 0) return draft
  const section = draft.sections[sectionIndex]
  const index = section.items.findIndex((i) => i.id === itemId)
  const to = index + delta
  if (to >= 0 && to < section.items.length) {
    const items = [...section.items]
    ;[items[index], items[to]] = [items[to], items[index]]
    return withSections(
      draft,
      draft.sections.map((s) => (s.id === section.id ? { ...s, items } : s))
    )
  }
  const neighbour = draft.sections[sectionIndex + delta]
  if (!neighbour) return draft
  const item = section.items[index]
  return withSections(
    draft,
    draft.sections.map((s) => {
      if (s.id === section.id) return { ...s, items: s.items.filter((i) => i.id !== itemId) }
      if (s.id === neighbour.id) return { ...s, items: delta < 0 ? [...s.items, item] : [item, ...s.items] }
      return s
    })
  )
}

// 移到指定大题的末尾
export function moveItemToSection(draft: PaperDraft, itemId: string, sectionId: string): PaperDraft {
  return moveItem(draft, itemId, { sectionId, beforeItemId: null })
}

export function removeItem(draft: PaperDraft, itemId: string): { draft: PaperDraft; removed: RemovedItem | null } {
  for (const section of draft.sections) {
    const index = section.items.findIndex((i) => i.id === itemId)
    if (index < 0) continue
    const sections = draft.sections.map((s) => (s.id === section.id ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s))
    return { draft: withSections(draft, sections), removed: { item: section.items[index], sectionId: section.id, index } }
  }
  return { draft, removed: null }
}

// 撤销删除：大题还在就放回原位置，大题已被删掉则放进最后一个大题
// 题目已经在卷里（顶栏撤销之后又点了过期的提示条）就什么也不做，避免同一道题以同一个 id 插进去两份
export function restoreItem(draft: PaperDraft, removed: RemovedItem): PaperDraft {
  if (draft.sections.some((s) => s.items.some((i) => i.id === removed.item.id))) return draft
  const target = draft.sections.find((s) => s.id === removed.sectionId) ?? draft.sections[draft.sections.length - 1]
  if (!target) return withSections(draft, [{ id: newId(), title: sectionTitleFor(removed.item.questionType), items: [removed.item] }])
  const at = Math.min(removed.index, target.items.length)
  return withSections(
    draft,
    draft.sections.map((s) => (s.id === target.id ? { ...s, items: [...s.items.slice(0, at), removed.item, ...s.items.slice(at)] } : s))
  )
}

export function updateItem(draft: PaperDraft, itemId: string, patch: Partial<PaperItem>): PaperDraft {
  let changed = false
  const sections = draft.sections.map((s) => {
    if (!s.items.some((i) => i.id === itemId)) return s
    return {
      ...s,
      items: s.items.map((i) => {
        if (i.id !== itemId) return i
        if ((Object.keys(patch) as (keyof PaperItem)[]).every((k) => i[k] === patch[k])) return i
        changed = true
        return { ...i, ...patch }
      })
    }
  })
  return changed ? withSections(draft, sections) : draft
}

// ---------- 分值 ----------

// 单题每小题分值；null 表示清除单独设置、回到跟随大题
export function setItemScore(draft: PaperDraft, itemId: string, score: number | null): PaperDraft {
  const value = normalizeScore(score)
  let changed = false
  const sections = draft.sections.map((s) => {
    if (!s.items.some((i) => i.id === itemId)) return s
    return {
      ...s,
      items: s.items.map((i) => {
        if (i.id !== itemId) return i
        if (value == null) {
          if (i.score === undefined) return i
          changed = true
          const { score: _removed, ...rest } = i
          void _removed
          return rest
        }
        if (i.score === value) return i
        changed = true
        return { ...i, score: value }
      })
    }
  })
  return changed ? withSections(draft, sections) : draft
}

// 大题每小题默认分值；已单独设置的题不受影响
export function setSectionScore(draft: PaperDraft, sectionId: string, score: number | null): PaperDraft {
  const value = normalizeScore(score)
  const section = draft.sections.find((s) => s.id === sectionId)
  if (!section) return draft
  if ((section.defaultScore ?? null) === value) return draft
  return withSections(
    draft,
    draft.sections.map((s) => {
      if (s.id !== sectionId) return s
      if (value == null) {
        const { defaultScore: _removed, ...rest } = s
        void _removed
        return rest
      }
      return { ...s, defaultScore: value }
    })
  )
}

// 清除一个大题里所有题的单独设置，全部跟随大题分值
export function clearItemScores(draft: PaperDraft, sectionId: string): PaperDraft {
  const section = draft.sections.find((s) => s.id === sectionId)
  if (!section || !section.items.some((i) => i.score != null)) return draft
  return withSections(
    draft,
    draft.sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            items: s.items.map((i) => {
              if (i.score === undefined) return i
              const { score: _removed, ...rest } = i
              void _removed
              return rest
            })
          }
        : s
    )
  )
}

// 目标满分只用于提示差额，不属于试卷内容；不进撤销历史
export function setTargetScore(draft: PaperDraft, score: number | null): PaperDraft {
  const value = normalizeScore(score)
  if ((draft.targetScore ?? null) === value) return draft
  if (value == null) {
    const { targetScore: _removed, ...rest } = draft
    void _removed
    return rest
  }
  return { ...draft, targetScore: value }
}

// ---------- 大题 ----------

export function addSection(draft: PaperDraft, title: string): PaperDraft {
  return withSections(draft, [...draft.sections, { id: newId(), title, items: [] }])
}

export function renameSection(draft: PaperDraft, sectionId: string, title: string): PaperDraft {
  const section = draft.sections.find((s) => s.id === sectionId)
  if (!section || section.title === title) return draft
  return withSections(
    draft,
    draft.sections.map((s) => (s.id === sectionId ? { ...s, title } : s))
  )
}

export function removeSection(draft: PaperDraft, sectionId: string): { draft: PaperDraft; removed: RemovedSection | null } {
  const index = draft.sections.findIndex((s) => s.id === sectionId)
  if (index < 0) return { draft, removed: null }
  return { draft: withSections(draft, draft.sections.filter((s) => s.id !== sectionId)), removed: { section: draft.sections[index], index } }
}

// 撤销删除大题：放回原来的位置，连同里面的题
export function restoreSection(draft: PaperDraft, removed: RemovedSection): PaperDraft {
  if (draft.sections.some((s) => s.id === removed.section.id)) return draft
  const at = Math.min(removed.index, draft.sections.length)
  return withSections(draft, [...draft.sections.slice(0, at), removed.section, ...draft.sections.slice(at)])
}

export function moveSection(draft: PaperDraft, sectionId: string, delta: -1 | 1): PaperDraft {
  const from = draft.sections.findIndex((s) => s.id === sectionId)
  return moveSectionTo(draft, sectionId, from + delta)
}

// 把大题移到第 to 位（0 起）。结构面板里拖动调序用
export function moveSectionTo(draft: PaperDraft, sectionId: string, to: number): PaperDraft {
  const from = draft.sections.findIndex((s) => s.id === sectionId)
  if (from < 0 || to < 0 || to >= draft.sections.length || to === from) return draft
  const sections = [...draft.sections]
  const [moved] = sections.splice(from, 1)
  sections.splice(to, 0, moved)
  return withSections(draft, sections)
}
