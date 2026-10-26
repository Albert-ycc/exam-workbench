// 入库任务的界面状态。放在模块级而不是页面组件里：切到其他页面再回来，任务进度和预览都还在。
import { useSyncExternalStore } from 'react'
import { errorMessage } from '../ui'
import { classifyZujuanUrl, normalizeImportUrl, splitPastedLinks, type ImportCommitResult, type ImportProgress } from '@shared/library'

export type ImportStage = 'idle' | 'starting' | 'running' | 'preview' | 'committing' | 'done'

export interface ImportState {
  draft: string // 粘贴框里的文字；任务启动失败或取消后保留，入库成功后清空
  stage: ImportStage
  jobId: string | null
  progress: ImportProgress | null
  result: ImportCommitResult | null
  error: string | null // 启动或提交失败的提示
}

const IDLE: ImportState = { draft: '', stage: 'idle', jobId: null, progress: null, result: null, error: null }
let state: ImportState = IDLE
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null

const current = (): ImportState => state

function set(next: ImportState): void {
  state = next
  listeners.forEach((l) => l())
}

function ensureSubscribed(): void {
  if (unsubscribe) return
  unsubscribe = window.workbench.library.onImportProgress((progress) => {
    // 启动中（invoke 还没返回）先采用第一个事件的任务号；之后只认当前任务
    if (state.stage === 'idle' || state.stage === 'done' || state.stage === 'committing') return
    if (state.jobId && progress.jobId !== state.jobId) return
    set({ ...state, jobId: progress.jobId, progress, stage: progress.finished ? 'preview' : 'running' })
  })
}

async function start(begin: () => Promise<{ jobId: string }>): Promise<void> {
  if (state.stage !== 'idle' && state.stage !== 'done') return
  ensureSubscribed()
  set({ ...IDLE, draft: state.draft, stage: 'starting' })
  try {
    const { jobId } = await begin()
    const now = current() // await 期间状态可能已被进度事件或取消改过
    if (now.stage === 'idle') await window.workbench.library.cancelImport(jobId).catch(() => undefined) // 启动期间用户已取消
    else if (now.stage === 'starting') set({ ...now, jobId, stage: 'running' })
    else if (!now.jobId) set({ ...now, jobId })
  } catch (error) {
    set({ ...IDLE, draft: state.draft, error: errorMessage(error) })
  }
}

// 粘贴框文字里不合规的行（不是组卷网试卷页或单题页）
export function invalidLinks(text: string): string[] {
  return splitPastedLinks(text).filter((link) => normalizeImportUrl(link) === null)
}

export function canImportPage(url: string): boolean {
  return classifyZujuanUrl(url) !== null
}

export const importActions = {
  startUrls: (text: string): Promise<void> => start(() => window.workbench.library.importUrls(splitPastedLinks(text))),
  startCurrentPage: (): Promise<void> => start(() => window.workbench.library.importCurrentPage()),
  async commit(): Promise<void> {
    const jobId = state.jobId
    if (!jobId || state.stage !== 'preview') return
    set({ ...state, stage: 'committing', error: null })
    try {
      const result = await window.workbench.library.commitImport(jobId)
      set({ ...state, stage: 'done', result, draft: '' })
    } catch (error) {
      set({ ...state, stage: 'preview', error: errorMessage(error) })
    }
  },
  // 取消进行中的任务，或放弃尚未确认的预览
  async cancel(): Promise<void> {
    const jobId = state.jobId
    set({ ...IDLE, draft: state.draft })
    if (jobId) await window.workbench.library.cancelImport(jobId).catch(() => undefined)
  },
  dismiss(): void {
    set({ ...IDLE, draft: state.draft })
  },
  setDraft(draft: string): void {
    set({ ...state, draft, error: null })
  },
}

export function useImportState(): ImportState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
