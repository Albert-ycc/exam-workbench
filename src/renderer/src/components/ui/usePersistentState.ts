// 会话外还能记住的 state：读写 localStorage（或 sessionStorage），读写都包了 try/catch，
// 存储不可用、被清空、内容损坏时一律退回 initial，页面照常工作。
//
// const [filter, setFilter] = usePersistentState('ewb.library.type', '全部')
// const [scroll, setScroll] = usePersistentState(`ewb.editor.scroll.${paperId}`, 0, { delay: 300 })      滚动位置：防抖写入
// const [openId, setOpenId] = usePersistentState<number | null>('ewb.ui.openPaperId', null, { storage: 'session' })  只在本次运行内记住
//
// 约定：
// - key 原样作为存储键，不加前缀，统一用 'ewb.<区域>.<名称>'。
// - 值用 JSON 存取，只放 JSON 能表示的东西。
// - key 变化时（如按试卷 id 分别记）会重新读取对应 key 的值。
// - 数据可能是旧版本写的、结构不对：传 validate 守卫，不合格就用 initial。
// - setState 与 React 的用法一致，可以传值或更新函数；值为 undefined 时删除这个键。
// - delay 毫秒内的连续修改只写最后一次，卸载与页面关闭时补写。
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export interface PersistentStateOptions<T> {
  /** local = 关掉应用再开还在（默认）；session = 只在本次运行内（含刷新）记住 */
  storage?: 'local' | 'session'
  /** 读出的值不合格就丢弃，用 initial */
  validate?(value: unknown): value is T
  /** 写入防抖毫秒数，默认立即写 */
  delay?: number
}

function area(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function read<T>(key: string, initial: T, options: PersistentStateOptions<T> | undefined): T {
  try {
    const raw = area(options?.storage ?? 'local')?.getItem(key)
    if (raw == null) return initial
    const value: unknown = JSON.parse(raw)
    if (options?.validate && !options.validate(value)) return initial
    return value as T
  } catch {
    return initial
  }
}

function write<T>(key: string, value: T, kind: 'local' | 'session'): void {
  try {
    const target = area(kind)
    if (!target) return
    if (value === undefined) target.removeItem(key)
    else target.setItem(key, JSON.stringify(value))
  } catch {
    // 存储满了或被禁用：这次不记，不影响使用
  }
}

export function usePersistentState<T>(key: string, initial: T, options?: PersistentStateOptions<T>): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read(key, initial, options) }))
  // 已经和存储一致的那份（key + 值）。没变化就不写，首次渲染读出来的值也不回写
  const committed = useRef({ key: state.key, value: state.value })
  const pending = useRef<{ key: string; value: T; kind: 'local' | 'session' } | null>(null)
  const timer = useRef(0)

  // key 变了：同一次渲染里换成新 key 的值，不让旧 key 的值写进新 key
  let current = state
  if (state.key !== key) {
    current = { key, value: read(key, initial, options) }
    setState(current)
  }

  const kind = options?.storage ?? 'local'
  const delay = options?.delay ?? 0

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const job = pending.current
    pending.current = null
    if (job) write(job.key, job.value, job.kind)
  }, [])

  useEffect(() => {
    if (committed.current.key !== current.key) {
      flush() // 旧 key 上还没写出去的内容先落盘
      committed.current = { key: current.key, value: current.value }
      return
    }
    if (Object.is(committed.current.value, current.value)) return
    committed.current = { key: current.key, value: current.value }
    pending.current = { key: current.key, value: current.value, kind }
    window.clearTimeout(timer.current)
    if (delay > 0) timer.current = window.setTimeout(flush, delay)
    else flush()
  }, [current.key, current.value, kind, delay, flush])

  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setState((prev) => ({ key: prev.key, value: typeof action === 'function' ? (action as (value: T) => T)(prev.value) : action }))
  }, [])

  return [current.value, set]
}
