// 编辑器里的草稿：当前内容、撤销 / 重做历史（20 步，F1）、对草稿的唯一修改入口 commit。
// 历史里只存大题列表（sections）：目标满分之类不属于试卷内容，撤销时不跟着回退。
import { useCallback, useRef, useState } from 'react'
import type { DraftSection, PaperDraft } from '@shared/domain'
import type { PaperEdits } from '@shared/papers'
import { setTargetScore } from './draftOps'

export const HISTORY_LIMIT = 20
const MERGE_MS = 1500
const EMPTY_DRAFT: PaperDraft = { sections: [] }

interface Entry {
  sections: DraftSection[]
  label: string
}

export interface CommitOptions {
  /** 这一步做了什么，撤销后提示用，如「删除第 3 题」 */
  label: string
  /** 同一个 key 的连续修改合并成一步（改名、改分值、编辑题干） */
  merge?: string
  /** 合并窗口，默认 1.5 秒；Infinity 表示直到被别的操作打断 */
  mergeMs?: number
}

export interface HistoryState {
  undoCount: number
  redoCount: number
  undoLabel: string | null
  redoLabel: string | null
}

const NO_HISTORY: HistoryState = { undoCount: 0, redoCount: 0, undoLabel: null, redoLabel: null }

export function useEditorDraft(schedule: (edits: PaperEdits) => void) {
  const [draft, setDraft] = useState<PaperDraft>(EMPTY_DRAFT)
  const draftRef = useRef<PaperDraft>(EMPTY_DRAFT)
  const undoStack = useRef<Entry[]>([])
  const redoStack = useRef<Entry[]>([])
  const lastMerge = useRef<{ key: string; at: number } | null>(null)
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY)

  const syncHistory = useCallback((): void => {
    const undo = undoStack.current
    const redo = redoStack.current
    setHistory({
      undoCount: undo.length,
      redoCount: redo.length,
      undoLabel: undo[undo.length - 1]?.label ?? null,
      redoLabel: redo[redo.length - 1]?.label ?? null
    })
  }, [])

  const pushLimited = (stack: Entry[], entry: Entry): void => {
    stack.push(entry)
    if (stack.length > HISTORY_LIMIT) stack.shift()
  }

  const apply = useCallback(
    (next: PaperDraft, save: boolean): void => {
      draftRef.current = next
      setDraft(next)
      if (save) schedule({ draft: next })
    },
    [schedule]
  )

  // 所有对草稿内容的修改都走这里：同步更新引用、界面、历史和自动保存队列
  const commit = useCallback(
    (fn: (d: PaperDraft) => PaperDraft, options: CommitOptions): boolean => {
      const prev = draftRef.current
      const next = fn(prev)
      if (next === prev) return false
      apply(next, true)
      if (next.sections !== prev.sections) {
        const now = Date.now()
        const last = lastMerge.current
        const merging = options.merge != null && last?.key === options.merge && now - last.at <= (options.mergeMs ?? MERGE_MS)
        if (!merging) {
          pushLimited(undoStack.current, { sections: prev.sections, label: options.label })
          redoStack.current = []
        }
        lastMerge.current = options.merge != null ? { key: options.merge, at: now } : null
        syncHistory()
      }
      return true
    },
    [apply, syncHistory]
  )

  const undo = useCallback((): string | null => {
    const entry = undoStack.current.pop()
    if (!entry) return null
    const current = draftRef.current
    pushLimited(redoStack.current, { sections: current.sections, label: entry.label })
    lastMerge.current = null
    apply({ ...current, sections: entry.sections }, true)
    syncHistory()
    return entry.label
  }, [apply, syncHistory])

  const redo = useCallback((): string | null => {
    const entry = redoStack.current.pop()
    if (!entry) return null
    const current = draftRef.current
    pushLimited(undoStack.current, { sections: current.sections, label: entry.label })
    lastMerge.current = null
    apply({ ...current, sections: entry.sections }, true)
    syncHistory()
    return entry.label
  }, [apply, syncHistory])

  // 整体换成另一份内容：读入试卷时清空历史；恢复版本时把换之前的内容记进历史，Ctrl+Z 能回去。都不触发保存（服务端已经是这份内容）
  const replace = useCallback(
    (next: PaperDraft, options: { label?: string } = {}): void => {
      const prev = draftRef.current
      lastMerge.current = null
      if (options.label != null) {
        pushLimited(undoStack.current, { sections: prev.sections, label: options.label })
        redoStack.current = []
      } else {
        undoStack.current = []
        redoStack.current = []
      }
      apply(next, false)
      syncHistory()
    },
    [apply, syncHistory]
  )

  // 目标满分：存在草稿里，但不是试卷内容，不进历史
  const commitTarget = useCallback(
    (score: number | null): void => {
      const next = setTargetScore(draftRef.current, score)
      if (next !== draftRef.current) apply(next, true)
    },
    [apply]
  )

  return { draft, draftRef, history, commit, undo, redo, replace, commitTarget }
}
