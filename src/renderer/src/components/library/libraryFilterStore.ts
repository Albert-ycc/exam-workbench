// 试题库页的筛选条件。放在模块级而不是页面组件里：
//   1. 切到别的页面再回来，题型、来源卷、关键词都还在；
//   2. 入库完成后「去试题库看本次入库」在试题库页还没挂载时就能写入「本次入库」筛选。
// 只记在 sessionStorage：本次运行内有效，重启后回到全部题目，不会带着一个看不见原因的筛选启动。
import { useSyncExternalStore } from 'react'

export interface ImportBatch {
  ids: number[]
  at: string // 入库完成的时间，界面上显示「本次入库」的来由
}

export interface LibraryFilterState {
  type: string // 题型标签原文，空串为全部
  paperId: number | null
  keyword: string
  batch: ImportBatch | null
}

const KEY = 'ewb.library.filter'
const EMPTY: LibraryFilterState = { type: '', paperId: null, keyword: '', batch: null }

function valid(value: unknown): value is LibraryFilterState {
  const v = value as Partial<LibraryFilterState> | null
  if (typeof v !== 'object' || v === null) return false
  if (typeof v.type !== 'string' || typeof v.keyword !== 'string') return false
  if (v.paperId !== null && !Number.isInteger(v.paperId)) return false
  if (v.batch !== null && !(typeof v.batch === 'object' && Array.isArray(v.batch.ids) && v.batch.ids.every(Number.isInteger) && typeof v.batch.at === 'string')) return false
  return true
}

function load(): LibraryFilterState {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw) {
      const value: unknown = JSON.parse(raw)
      if (valid(value)) return value
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
  return Boolean(f.type || f.paperId !== null || f.keyword || f.batch)
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
