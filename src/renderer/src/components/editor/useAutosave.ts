// 草稿与标题的防抖自动保存。所有写入走同一条串行队列，离开页面或关闭窗口前把没写的改动写掉。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaperEdits, PaperSaveResult } from '@shared/papers'
import { errorMessage, toast } from '../ui'

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

export interface AutosaveStatus {
  state: SaveState
  savedAt: string | null
  error: string | null
}

const DEBOUNCE_MS = 500

const hasEdits = (e: PaperEdits): boolean => e.title !== undefined || e.draft !== undefined

export function useAutosave(paperId: number, onSaved: (result: PaperSaveResult) => void) {
  const [status, setStatus] = useState<AutosaveStatus>({ state: 'saved', savedAt: null, error: null })
  const pending = useRef<PaperEdits>({})
  const timer = useRef<number | undefined>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  })

  const run = useCallback(async (): Promise<void> => {
    const edits = pending.current
    if (!hasEdits(edits)) return
    pending.current = {}
    setStatus((s) => ({ ...s, state: 'saving' }))
    try {
      const result = await window.workbench.papers.saveEdits(paperId, edits)
      onSavedRef.current(result)
      setStatus({ state: hasEdits(pending.current) ? 'pending' : 'saved', savedAt: result.updatedAt, error: null })
    } catch (error) {
      // 保存期间又有新改动时以新的为准，没有的部分留着等下次重试
      pending.current = { ...edits, ...pending.current }
      setStatus((s) => ({ ...s, state: 'error', error: errorMessage(error) }))
      throw error
    }
  }, [paperId])

  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current)
    queue.current = queue.current.then(run, run)
    return queue.current
  }, [run])

  const schedule = useCallback(
    (edits: PaperEdits): void => {
      pending.current = { ...pending.current, ...edits }
      setStatus((s) => ({ ...s, state: 'pending' }))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush().catch(() => undefined), DEBOUNCE_MS)
    },
    [flush]
  )

  // 恢复版本等整体替换内容的操作之后，丢掉还没写的旧改动
  const reset = useCallback((savedAt: string | null): void => {
    window.clearTimeout(timer.current)
    pending.current = {}
    setStatus({ state: 'saved', savedAt, error: null })
  }, [])

  useEffect(() => {
    // 关闭窗口时异步请求赶不上页面卸载，改用同步写入
    const onUnload = (): void => {
      if (!hasEdits(pending.current)) return
      if (window.workbench.papers.saveEditsOnExit(paperId, pending.current)) pending.current = {}
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      // 切换页面（返回试卷库、换到别的菜单）时把没写的改动写掉
      window.clearTimeout(timer.current)
      // 组件已卸载，状态条看不到了；toast 是模块级的，仍能告诉用户这次没存上
      void flush().catch((error) => toast.error(`草稿没有保存成功，改动已丢失：${errorMessage(error)}`))
    }
  }, [paperId, flush])

  return { status, schedule, flush, reset }
}
