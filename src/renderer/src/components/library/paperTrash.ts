// 试卷的「软删除」：点删除后界面先把试卷藏起来，8 秒后才真正删除；8 秒内点「撤销」就当没删过。
// 状态放在模块级：切到别的页面，倒计时照常走，到点照样删。
// 应用在倒计时结束前关闭，这次删除不会执行，试卷下次启动时还在。
// 试卷库的列表、试题库的「加入试卷」菜单都要避开已藏起来的试卷，所以统一从这里取。
import { useSyncExternalStore } from 'react'
import type { PaperSummary } from '@shared/domain'
import { toast } from '../ui'
import { errorMessage } from './format'

export const UNDO_MS = 8000

interface Pending {
  paper: PaperSummary
  timer: number
  toastId: number
}

const pending = new Map<number, Pending>()
let hidden: ReadonlySet<number> = new Set()
// 每执行完一次真正的删除加一：试卷库据此重新读取列表
let executed = 0
const listeners = new Set<() => void>()

function emit(): void {
  hidden = new Set(pending.keys())
  listeners.forEach((l) => l())
}

function undo(id: number): void {
  const item = pending.get(id)
  if (!item) return
  window.clearTimeout(item.timer)
  pending.delete(id)
  emit()
}

async function execute(id: number): Promise<void> {
  const item = pending.get(id)
  if (!item) return
  toast.dismiss(item.toastId)
  try {
    await window.workbench.papers.remove(id)
  } catch (error) {
    toast.error(`删除「${item.paper.title}」失败：${errorMessage(error)}`)
  }
  pending.delete(id)
  executed++
  emit()
}

export const paperTrash = {
  schedule(paper: PaperSummary): void {
    if (pending.has(paper.id)) return
    const toastId = toast.show(`已删除「${paper.title}」`, { ms: UNDO_MS, action: { label: '撤销', run: () => undo(paper.id) } })
    pending.set(paper.id, { paper, toastId, timer: window.setTimeout(() => void execute(paper.id), UNDO_MS) })
    emit()
  },
  isHidden: (id: number): boolean => hidden.has(id)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 正在倒计时、界面上要藏起来的试卷 id */
export function useHiddenPapers(): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, () => hidden)
}

/** 真正执行过的删除次数，变化时重新读取试卷列表 */
export function useExecutedDeletes(): number {
  return useSyncExternalStore(subscribe, () => executed)
}
