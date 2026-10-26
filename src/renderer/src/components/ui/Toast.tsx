// 全局提示条。应用根挂一个 <ToastHost />（App.tsx 已挂），任何地方用 useToast() 或 toast 发提示。
//
// const toast = useToast()
// toast.show('已存为 v2')                                           普通提示，4 秒后消失
// toast.error('保存失败：磁盘已满')                                  出错提示，白底红边，8 秒
// toast.show('已删除第 3 题', { action: { label: '撤销', run: undo } })  带动作按钮，8 秒；点完即消失
// 合并同类（S13）：同一个 group 的提示合并成一条，次数累加，撤销会把合并过的动作都执行一遍（后发先执行）：
//   toast.show((n) => `已删除 ${n} 道题`, { group: 'delete-question', action: { label: (n) => (n > 1 ? '撤销全部' : '撤销'), run: undo } })
// toast.dismiss(id) / toast.dismissAll()                            show 返回提示的 id
//
// 同时最多显示 2 条：再来新的就顶掉一条，优先顶没有动作按钮的，都带动作时才顶最早的。被顶掉的提示即使带「撤销」，它的撤销回调也不执行（与超时消失一致，删除照常生效）。
// 文字相同、类型相同的提示合并成一条并重新计时，不叠第二份；带动作按钮时以后发的那一条的动作为准。
// 鼠标悬停或焦点在提示上时暂停计时。弹窗打开时提示自动避开弹窗（N9）：弹窗上方放得下就放在上方，
// 否则放弹窗下方，再不行放在弹窗标题栏下面，任何情况下都不压住弹窗页脚。
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../../icons'
import { cx } from './cx'
import { getModalSnapshot, subscribeModals } from './layers'
import './Overlay.css'

export type ToastTone = 'info' | 'error'
type Dynamic<T> = T | ((count: number) => T)

export interface ToastAction {
  label: Dynamic<string>
  run(): void
}

export interface ToastOptions {
  tone?: ToastTone
  action?: ToastAction
  /** 停留毫秒数；默认普通 4000，出错或带动作 8000 */
  ms?: number
  /** 同组提示合并成一条 */
  group?: string
}

interface ToastItem {
  id: number
  tone: ToastTone
  count: number
  text: Dynamic<string>
  actionLabel?: Dynamic<string>
  runs: Array<() => void>
  group?: string
  ms: number
}

let items: ToastItem[] = []
let seq = 0
const MAX = 2
const listeners = new Set<() => void>()
const timers = new Map<number, { handle: number; deadline: number; remaining: number }>()

function emit(): void {
  items = [...items]
  for (const fn of listeners) fn()
}

function arm(id: number, ms: number): void {
  const old = timers.get(id)
  if (old) window.clearTimeout(old.handle)
  timers.set(id, { handle: window.setTimeout(() => dismiss(id), ms), deadline: Date.now() + ms, remaining: ms })
}

function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer) window.clearTimeout(timer.handle)
  timers.delete(id)
  if (!items.some((item) => item.id === id)) return
  items = items.filter((item) => item.id !== id)
  emit()
}

function pause(id: number): void {
  const timer = timers.get(id)
  if (!timer) return
  window.clearTimeout(timer.handle)
  timer.remaining = Math.max(timer.deadline - Date.now(), 0)
  timer.handle = 0
}

function resume(id: number): void {
  const timer = timers.get(id)
  if (!timer || timer.handle) return
  arm(id, Math.max(timer.remaining, 1500))
}

function show(text: Dynamic<string>, options: ToastOptions = {}): number {
  const tone = options.tone ?? 'info'
  const ms = options.ms ?? (tone === 'error' || options.action ? 8000 : 4000)
  // 同组合并（次数累加、撤销全部）优先；没分组时，文字与类型都相同的提示视为同一条
  const sameText = typeof text === 'function' ? text(1) : text
  const existing = options.group
    ? items.find((item) => item.group === options.group)
    : items.find((item) => !item.group && item.tone === tone && resolve(item.text, 1) === sameText)
  if (existing) {
    if (options.group) existing.count += 1
    existing.text = text
    existing.tone = tone
    if (options.action) {
      existing.actionLabel = options.action.label
      existing.runs = options.group ? [...existing.runs, options.action.run] : [options.action.run]
    }
    existing.ms = ms
    emit()
    arm(existing.id, ms)
    return existing.id
  }
  const id = ++seq
  // 被顶掉的只清计时，不执行它的动作
  items = [...items, { id, tone, count: 1, text, actionLabel: options.action?.label, runs: options.action ? [options.action.run] : [], group: options.group, ms }]
  while (items.length > MAX) {
    // 带撤销的提示是用户唯一的反悔入口，没有动作的先让位
    const victim = items.slice(0, -1).find((item) => item.runs.length === 0) ?? items[0]
    items = items.filter((item) => item !== victim)
  }
  for (const key of Array.from(timers.keys())) if (!items.some((item) => item.id === key)) dismiss(key)
  emit()
  arm(id, ms)
  return id
}

/** 全局提示。非组件代码里也可以直接 import { toast } */
export const toast = {
  show,
  error: (text: Dynamic<string>, options?: Omit<ToastOptions, 'tone'>) => show(text, { ...options, tone: 'error' }),
  dismiss,
  dismissAll: () => {
    for (const item of [...items]) dismiss(item.id)
  }
}

export function useToast(): typeof toast {
  return toast
}

function resolve<T>(value: Dynamic<T>, count: number): T {
  return typeof value === 'function' ? (value as (n: number) => T)(count) : value
}

function subscribeItems(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const getItems = (): ToastItem[] => items

interface Placement {
  left: number
  top?: number
  bottom?: number
}

/** 弹窗打开时，算出提示条的位置：弹窗上方 → 弹窗下方 → 弹窗标题栏下面 */
function placeAround(modal: HTMLElement, host: HTMLElement): Placement | null {
  const dialog = modal.querySelector<HTMLElement>('.ui-modal')
  if (!dialog) return null
  const box = dialog.getBoundingClientRect()
  const width = host.offsetWidth
  const height = host.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 10
  const left = Math.min(Math.max(box.left + box.width / 2, width / 2 + 8), vw - width / 2 - 8)
  if (box.top >= height + gap + 8) return { left, bottom: vh - box.top + gap }
  if (vh - box.bottom >= height + gap + 8) return { left, top: box.bottom + gap }
  const head = dialog.querySelector<HTMLElement>('.ui-modal-head')?.getBoundingClientRect()
  return { left, top: (head?.bottom ?? box.top) + gap }
}

export function ToastHost() {
  const list = useSyncExternalStore(subscribeItems, getItems)
  const modal = useSyncExternalStore(subscribeModals, getModalSnapshot)
  const hostRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!modal || !host) {
      setPlacement(null)
      return
    }
    const update = (): void => {
      const next = placeAround(modal, host)
      setPlacement((prev) => (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    const dialog = modal.querySelector('.ui-modal')
    if (dialog) observer.observe(dialog)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [modal, list.length])

  if (list.length === 0) return null
  const style = placement
    ? { left: placement.left, top: placement.top ?? 'auto', bottom: placement.bottom ?? 'auto' }
    : undefined
  return createPortal(
    <div ref={hostRef} className="ui-toast-host" data-ui-persist="" data-avoiding-modal={placement ? '' : undefined} style={style} role="region" aria-label="提示">
      {list.map((item) => (
        <div
          key={item.id}
          className={cx('ui-toast', item.tone === 'error' && 'ui-toast--error')}
          data-testid="toast"
          role={item.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => pause(item.id)}
          onMouseLeave={() => resume(item.id)}
          onFocus={() => pause(item.id)}
          onBlur={() => resume(item.id)}
        >
          <span className="ui-toast-text">{resolve(item.text, item.count)}</span>
          {item.actionLabel && (
            <button
              type="button"
              className="ui-toast-action"
              onClick={() => {
                const runs = [...item.runs].reverse()
                dismiss(item.id)
                for (const run of runs) run()
              }}
            >
              {resolve(item.actionLabel, item.count)}
            </button>
          )}
          <button type="button" className="ui-toast-close" aria-label="关闭提示" onClick={() => dismiss(item.id)}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
