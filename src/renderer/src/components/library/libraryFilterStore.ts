// 试题库页的筛选条件。放在模块级而不是页面组件里：
//   1. 切到别的页面再回来，题型、来源卷、关键词、章节、难度、知识点、标签都还在；
//   2. 入库完成后「去试题库看本次入库」在试题库页还没挂载时就能写入「本次入库」筛选。
// 只记在 sessionStorage：本次运行内有效，重启后回到全部题目，不会带着一个看不见原因的筛选启动。
import { useSyncExternalStore } from 'react'
import { isDifficultyKey, type DifficultyKey } from '@shared/classify'

export interface ImportBatch {
  ids: number[]
  at: string // 入库完成的时间，界面上显示「本次入库」的来由
}

export interface LibraryFilterState {
  type: string // 题型标签原文，空串为全部
  paperId: number | null
  keyword: string
  batch: ImportBatch | null
  // 归类条件：同一项内多选取并集，不同项之间取交集（见 QuestionFilter）
  chapterIds: number[] // 选章包含其下各节；0 是「未归章节」
  knowledgeIds: number[]
  difficulties: DifficultyKey[]
  tagIds: number[]
}

const KEY = 'ewb.library.filter'
const EMPTY: LibraryFilterState = { type: '', paperId: null, keyword: '', batch: null, chapterIds: [], knowledgeIds: [], difficulties: [], tagIds: [] }

// 升级前记下的条件没有归类四项：补成空，不丢弃题型、来源卷、关键词
function restore(value: unknown): LibraryFilterState | null {
  const v = value as Partial<LibraryFilterState> | null
  if (typeof v !== 'object' || v === null) return null
  if (typeof v.type !== 'string' || typeof v.keyword !== 'string') return null
  if (v.paperId !== null && !Number.isInteger(v.paperId)) return null
  if (v.batch !== null && !(typeof v.batch === 'object' && Array.isArray(v.batch.ids) && v.batch.ids.every(Number.isInteger) && typeof v.batch.at === 'string')) return null
  const ints = (list: unknown): number[] => (Array.isArray(list) ? list.filter(Number.isInteger) : [])
  return {
    type: v.type,
    paperId: v.paperId ?? null,
    keyword: v.keyword,
    batch: v.batch ?? null,
    chapterIds: ints(v.chapterIds),
    knowledgeIds: ints(v.knowledgeIds),
    difficulties: Array.isArray(v.difficulties) ? v.difficulties.filter(isDifficultyKey) : [],
    tagIds: ints(v.tagIds)
  }
}

function load(): LibraryFilterState {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw) {
      const value = restore(JSON.parse(raw))
      if (value) return value
    }
  } catch {
    // 存储不可用或内容损坏：用空筛选
  }
  return EMPTY
}

let state: LibraryFilterState | null = null
const listeners = new Set<() => void>()

function current(): LibraryFilterState {
  if (!state) state = load()
  return state
}

function set(next: LibraryFilterState): void {
  state = next
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 这次不记，不影响使用
  }
  listeners.forEach((l) => l())
}

export function isFiltered(f: LibraryFilterState): boolean {
  return Boolean(f.type || f.paperId !== null || f.keyword || f.batch || f.chapterIds.length || f.knowledgeIds.length || f.difficulties.length || f.tagIds.length)
}

export const libraryFilter = {
  get: current,
  patch: (patch: Partial<LibraryFilterState>): void => set({ ...current(), ...patch }),
  clear: (): void => set(EMPTY),
  // 入库完成后：只看本次入库的题，其余条件清掉
  showBatch: (ids: number[]): void => set({ ...EMPTY, batch: { ids, at: new Date().toISOString() } })
}

export function useLibraryFilter(): LibraryFilterState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    current
  )
}
