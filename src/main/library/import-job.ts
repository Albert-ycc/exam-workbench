// 入库任务：在内置浏览器里逐条打开链接（或取当前页），等页面加载并拆题，遇到验证页暂停等用户处理。
// 页面脚本在 Electron 隔离世界里执行；图片用内置浏览器会话下载（带登录状态）。
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  classifyZujuanUrl,
  LIBRARY_IPC,
  normalizeImportUrl,
  splitPastedLinks,
  ZUJUAN_HOST,
  type ImportPreview,
  type ImportProgress,
  type ImportCommitResult
} from '@shared/library'
import { collectSession } from '../browser'
import type { AppContext } from '../context'
import { commitPages } from './commit'
import { SeenQuestions } from './dedupe'
import { extractScript, type ExtractedPage } from './extract-script'
import { MAX_IMAGE_BYTES, type FetchedImage, type ImageFetcher } from './images'
import { preparePage, toPreview, type PreparedPage } from './prepare'

const EXTRACT_WORLD = 7001
const POLL_MS = 700
const NO_CONTENT_MS = 20_000 // 页面加载完成后仍没有题目
const OPEN_TIMEOUT_MS = 30_000
const WAIT_USER_MS = 10 * 60_000 // 等用户处理验证的最长时间
const STALL_MS = 120_000 // 不在等用户的情况下，页面始终没出题目也没有稳定下来的最长时间
const MAX_URLS = 50

class CancelledError extends Error {}

interface Job {
  id: string
  progress: ImportProgress
  pages: PreparedPage[]
  seen: SeenQuestions
  cancelled: boolean
}

interface Navigation {
  committed: boolean
  status: number
  failure: string | null
}

// 内置浏览器会话的 fetch：带登录 Cookie 和组卷网来源页，边读边限制大小
export const sessionImageFetcher: ImageFetcher = async (url): Promise<FetchedImage> => {
  const res = await collectSession().fetch(url, {
    credentials: 'include',
    referrer: `https://${ZUJUAN_HOST}/`,
    signal: AbortSignal.timeout(20_000)
  })
  if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new Error('图片过大')
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel()
        throw new Error('图片过大')
      }
      chunks.push(value)
    }
  }
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', bytes: Buffer.concat(chunks) }
}

export interface ImportServiceOptions {
  fetchImage?: ImageFetcher
  gapMs?: () => number
}

export class ImportService {
  private job: Job | null = null
  private readonly fetchImage: ImageFetcher
  private readonly gapMs: () => number

  constructor(
    private readonly ctx: AppContext,
    options: ImportServiceOptions = {}
  ) {
    this.fetchImage = options.fetchImage ?? sessionImageFetcher
    const fixed = Number(process.env.EWB_IMPORT_GAP_MS)
    this.gapMs = options.gapMs ?? (Number.isFinite(fixed) && process.env.EWB_IMPORT_GAP_MS ? () => fixed : () => 3000 + Math.random() * 3000)
  }

  startUrls(rawUrls: string[]): { jobId: string } {
    const lines = splitPastedLinks(rawUrls.join('\n'))
    if (lines.length === 0) throw new Error('请粘贴组卷网的试卷或试题链接')
    const urls: string[] = []
    for (const line of lines) {
      const url = normalizeImportUrl(line)
      if (!url) {
        const kind = classifyZujuanUrl(line)
        throw new Error(kind === 'smart' ? '智能组卷预览页没有固定链接，请在内置浏览器里打开后点「整页入库」' : `不是组卷网的试卷或试题链接：${line}`)
      }
      if (!urls.includes(url)) urls.push(url)
    }
    if (urls.length > MAX_URLS) throw new Error(`一次最多入库 ${MAX_URLS} 条链接`)
    const job = this.newJob(urls.length)
    void this.run(job, async () => {
      for (let i = 0; i < urls.length; i++) {
        if (i > 0) await this.pause(job, this.gapMs())
        await this.runOne(job, urls[i], urls[i])
      }
    })
    return { jobId: job.id }
  }

  startCurrentPage(): { jobId: string } {
    const contents = this.contents()
    const url = contents.getURL()
    if (!classifyZujuanUrl(url)) throw new Error('当前页面不是组卷网的试卷页或试题页')
    const job = this.newJob(1)
    void this.run(job, () => this.runOne(job, url, null))
    return { jobId: job.id }
  }

  commit(jobId: string): ImportCommitResult {
    const job = this.job
    if (!job || job.id !== jobId || !job.progress.finished || job.cancelled) throw new Error('入库任务已失效，请重新入库')
    const db = this.ctx.db()
    // 本次新增的题一定排在入库前的最大题号之后：据此告诉界面「本次入库」是哪些题
    const before = (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM questions').get() as { id: number }).id
    const result = commitPages(db, this.ctx.dataDir(), job.pages)
    const addedIds = (db.prepare('SELECT id FROM questions WHERE id > ? ORDER BY id').all(before) as { id: number }[]).map((row) => row.id)
    this.job = null
    return { ...result, addedIds }
  }

  cancel(jobId: string): void {
    if (this.job && this.job.id === jobId) {
      this.job.cancelled = true
      this.job = null
    }
  }

  // ---------- 内部 ----------

  private contents(): WebContents {
    const contents = this.ctx.collectBrowser()?.webContents()
    if (!contents || contents.isDestroyed()) throw new Error('内置浏览器尚未打开，请先切换到采集页')
    return contents
  }

  private newJob(total: number): Job {
    if (this.job && !this.job.progress.finished) throw new Error('已有入库任务进行中')
    this.contents() // 先确认内置浏览器可用
    const job: Job = {
      id: randomUUID(),
      progress: { jobId: '', total, done: 0, current: '', waitingForUser: null, previews: [], finished: false },
      pages: [],
      seen: new SeenQuestions(),
      cancelled: false
    }
    job.progress.jobId = job.id
    this.job = job
    return job
  }

  private emit(job: Job): void {
    if (job.cancelled) return
    const win = this.ctx.mainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(LIBRARY_IPC.importProgress, { ...job.progress, previews: [...job.progress.previews] })
  }

  private async run(job: Job, body: () => Promise<void>): Promise<void> {
    this.emit(job)
    try {
      await body()
    } catch (error) {
      if (!(error instanceof CancelledError)) console.error('[import] 任务异常', error)
    }
    if (job.cancelled) return
    job.progress.finished = true
    job.progress.current = ''
    job.progress.waitingForUser = null
    this.emit(job)
  }

  private async pause(job: Job, ms: number): Promise<void> {
    for (let waited = 0; waited < ms; waited += 250) {
      if (job.cancelled) throw new CancelledError()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (job.cancelled) throw new CancelledError()
  }

  private setWaiting(job: Job, message: string | null): void {
    if (job.progress.waitingForUser === message) return
    job.progress.waitingForUser = message
    this.emit(job)
  }

  // 处理一条链接（url 为 null 表示取内置浏览器当前页）
  private async runOne(job: Job, label: string, url: string | null): Promise<void> {
    job.progress.current = label
    this.emit(job)
    let preview: ImportPreview
    try {
      const contents = this.contents()
      const extracted = await this.acquire(job, contents, url)
      const page = await preparePage(extracted, label, {
        db: this.ctx.db(),
        fetchImage: this.fetchImage,
        seen: job.seen,
        pageIndex: job.pages.length,
        shouldStop: () => job.cancelled
      })
      if (job.cancelled) throw new CancelledError()
      if (extracted.questions.length === 0) throw new Error('页面里没有识别到题目')
      job.pages.push(page)
      preview = toPreview(page, extracted.kind === 'question' ? page.sourceTitle || extracted.questions[0].stemText.slice(0, 24) : extracted.title)
      if (extracted.diagnostics.length) console.warn('[import] 拆题提示', label, extracted.diagnostics)
    } catch (error) {
      if (error instanceof CancelledError) throw error
      preview = { url: label, title: '', questions: [], imageTotal: 0, imageFailed: 0, declaredCount: null, noKnowledge: 0, noDifficulty: 0, error: error instanceof Error ? error.message : String(error) }
    }
    job.progress.previews.push(preview)
    job.progress.done++
    this.setWaiting(job, null)
    this.emit(job)
  }

  private async runScript(contents: WebContents, code: string): Promise<ExtractedPage> {
    return (await contents.executeJavaScriptInIsolatedWorld(EXTRACT_WORLD, [{ code }])) as ExtractedPage
  }

  // 等页面里出现题目后拆题；验证页与登录页暂停，等用户在内置浏览器里处理
  private async acquire(job: Job, contents: WebContents, url: string | null): Promise<ExtractedPage> {
    const nav: Navigation = { committed: url === null, status: 0, failure: null }
    const onNavigate = (_event: unknown, _url: string, status: number): void => {
      nav.committed = true
      nav.status = status
    }
    const onFail = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean): void => {
      if (isMainFrame && code !== -3) nav.failure = description
    }
    contents.on('did-navigate', onNavigate)
    contents.on('did-fail-load', onFail)
    try {
      if (job.cancelled) throw new CancelledError()
      if (url) contents.loadURL(url).catch(() => undefined)
      const startedAt = Date.now()
      let activeSince = startedAt // 最近一次不在等用户的时刻
      let settledAt: number | null = null
      let waitingSince: number | null = null
      for (;;) {
        if (job.cancelled) throw new CancelledError()
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (contents.isDestroyed()) throw new Error('内置浏览器已关闭')
        if (nav.failure) throw new Error(`页面打开失败：${nav.failure}`)
        if (!nav.committed) {
          if (Date.now() - startedAt > OPEN_TIMEOUT_MS) throw new Error('页面打开超时')
          continue
        }
        const loading = contents.isLoading()
        settledAt = loading ? null : (settledAt ?? Date.now())
        let host = ''
        try {
          host = new URL(contents.getURL()).hostname
        } catch {
          // 地址还没就绪
        }
        const waitUser = (message: string): void => {
          waitingSince ??= Date.now()
          activeSince = Date.now()
          if (Date.now() - waitingSince > WAIT_USER_MS) throw new Error('等待超时，已放弃本条链接')
          this.setWaiting(job, message)
        }
        if (host !== ZUJUAN_HOST) {
          waitUser(`页面跳转到了 ${host || '其他地址'}，请在内置浏览器里完成登录或验证，完成后自动继续。`)
          continue
        }
        let probe: ExtractedPage
        try {
          probe = await this.runScript(contents, extractScript(true))
        } catch {
          continue // 页面正在跳转
        }
        if (probe.kind !== 'none') {
          if (loading && Date.now() - startedAt < OPEN_TIMEOUT_MS) continue
          this.setWaiting(job, null)
          try {
            return await this.runScript(contents, extractScript())
          } catch {
            continue // 探测之后页面恰好跳转，等下一轮
          }
        }
        if (probe.verification) {
          waitUser('组卷网要求安全验证，请在内置浏览器里完成验证，完成后自动继续。')
          continue
        }
        waitingSince = null
        this.setWaiting(job, null)
        if (Date.now() - activeSince > STALL_MS) throw new Error('页面长时间没有加载出题目')
        if (settledAt && Date.now() - settledAt > NO_CONTENT_MS) {
          throw new Error(nav.status >= 400 ? `页面里没有找到题目（HTTP ${nav.status}）` : '页面里没有找到题目，请确认链接是试卷页或试题页')
        }
      }
    } finally {
      contents.removeListener('did-navigate', onNavigate)
      contents.removeListener('did-fail-load', onFail)
    }
  }
}
