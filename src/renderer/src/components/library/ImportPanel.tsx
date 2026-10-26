// 采集页右侧的入库面板：粘贴链接、入库进度、入库预览、完成提示。
// 内置浏览器是原生视图，会盖住界面里的弹窗，所以做成挤压浏览器区域的侧栏，不用弹窗。
import { splitPastedLinks, type ImportPreview } from '@shared/library'
import { navigateTo } from '../../navigation'
import { Button, Tag } from '../ui'
import { importActions, invalidLinks, useImportState } from './importStore'
import { libraryFilter } from './libraryFilterStore'
import './library.css'

interface Props {
  pasteOpen: boolean
  onClosePaste: () => void
}

export function importPanelVisible(stage: string, pasteOpen: boolean): boolean {
  return stage !== 'idle' || pasteOpen
}

// 页面标明的题数与拆出的题数对不上：组卷网页面结构可能改了
function countMismatch(preview: ImportPreview): boolean {
  return !preview.error && preview.declaredCount !== null && preview.declaredCount !== preview.questions.length
}

interface Summary {
  total: number
  withAnswer: number
  duplicate: number
  fresh: number
  freshWithAnswer: number
  imageFailed: number
  failedPages: number
  mismatched: number
  noKnowledge: number // 没取到知识点的题数（含已在库的）
  noDifficulty: number // 没取到难度的题数（含已在库的）
  pages: number // 拆出了题的链接数
  fill: number // 已在库、确认后会补上知识点与难度的题数
}

function summarize(previews: ImportPreview[]): Summary {
  const questions = previews.flatMap((p) => p.questions)
  const fresh = questions.filter((q) => !q.duplicate)
  return {
    total: questions.length,
    withAnswer: questions.filter((q) => q.hasAnswer).length,
    duplicate: questions.length - fresh.length,
    fresh: fresh.length,
    freshWithAnswer: fresh.filter((q) => q.hasAnswer).length,
    imageFailed: previews.reduce((sum, p) => sum + p.imageFailed, 0),
    failedPages: previews.filter((p) => p.error).length,
    mismatched: previews.filter(countMismatch).length,
    noKnowledge: previews.reduce((sum, p) => sum + (p.error ? 0 : p.noKnowledge), 0),
    noDifficulty: previews.reduce((sum, p) => sum + (p.error ? 0 : p.noDifficulty), 0),
    pages: previews.filter((p) => !p.error && p.questions.length > 0).length,
    fill: questions.filter((q) => q.fill).length
  }
}

// 知识点、难度读不到时的提示（L2）与已在库的题将补齐的提示（L3）。
// 整个页面都没读到：说清后果和补救办法；只有几道没读到：说清这几道的后果，题行上标出是哪几道
function missingNote(s: Summary, count: number, what: '知识点' | '难度'): string | null {
  if (count === 0) return null
  if (count < s.total) return `${count} 道没取到${what}，这几道入库后按${what}筛不到。`
  const subject = s.pages === 1 ? `这页 ${count} 道` : `这 ${s.pages} 条链接共 ${count} 道`
  return `${subject}都没读到${what}，入库后按${what}筛不到这些题；之后再入同一链接，读到的${what}会补上。`
}

function ClassifyNotes({ s }: { s: Summary }) {
  const noKnowledge = missingNote(s, s.noKnowledge, '知识点')
  const noDifficulty = missingNote(s, s.noDifficulty, '难度')
  return (
    <>
      {noKnowledge && (
        <p className="notice import-callout" role="status" data-testid="import-no-knowledge">
          {noKnowledge}
        </p>
      )}
      {noDifficulty && (
        <p className="notice import-callout" role="status" data-testid="import-no-difficulty">
          {noDifficulty}
        </p>
      )}
      {s.fill > 0 && (
        <p className="import-callout is-blocking" role="status" data-testid="import-fill">
          已在库，将补齐知识点与难度 {s.fill} 道
        </p>
      )}
    </>
  )
}

// 链接标题行里的提示各占一行：并排写会把页面标题挤没，「难度」二字也会被拆到两行
const WARN_LINE = { display: 'block' } as const

// 题行上标「无知识点」「无难度」只在这个页面里有的读到、有的没读到时才标（整页都没读到时由顶部提示说明，不逐题重复）
function partlyMissing(count: number, total: number): boolean {
  return count > 0 && count < total
}

function SummaryLine({ previews }: { previews: ImportPreview[] }) {
  const s = summarize(previews)
  return (
    <p className="import-summary" data-testid="import-summary">
      拆出 {s.total} 道、带答案 {s.withAnswer} 道、已在库 {s.duplicate} 道（{s.fill > 0 ? '不重复入库' : '入库时跳过'}）
      {s.imageFailed > 0 && <span className="import-warn">，{s.imageFailed} 张图片下载失败</span>}
      {s.failedPages > 0 && <span className="import-warn">，{s.failedPages} 条链接失败</span>}
      {s.mismatched > 0 && <span className="import-warn">，{s.mismatched} 条链接的拆出题数与页面标明的不一致</span>}
    </p>
  )
}

function PasteForm({ onClose }: { onClose: () => void }) {
  const state = useImportState()
  const text = state.draft
  const links = splitPastedLinks(text)
  const invalid = invalidLinks(text)
  return (
    <section className="import-panel" aria-label="粘贴链接入库">
      <header>
        <h2>粘贴链接入库</h2>
        <Button variant="link" size="sm" onClick={onClose}>
          关闭
        </Button>
      </header>
      <div className="import-body">
        <textarea
          className="import-textarea"
          value={text}
          spellCheck={false}
          placeholder={'每行一条组卷网试卷或试题链接\nhttps://zujuan.xkw.com/2p3543573.html'}
          onChange={(e) => importActions.setDraft(e.target.value)}
        />
        <p className="import-hint">逐条在内置浏览器里打开，每条之间间隔几秒。遇到安全验证会暂停，等待在内置浏览器里完成验证。</p>
        {invalid.length > 0 && (
          <p className="import-error" role="alert">
            {invalid.length} 行不是组卷网的试卷页或试题页链接：{invalid[0].length > 48 ? invalid[0].slice(0, 48) + '…' : invalid[0]}
            {invalid.length > 1 ? ' 等' : ''}
          </p>
        )}
        {state.error && (
          <p className="import-error" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <footer>
        <span className="import-count">{links.length > 0 ? `共 ${links.length} 条` : ''}</span>
        <Button
          variant="primary"
          disabled={links.length === 0 || invalid.length > 0}
          onClick={() => {
            void importActions.startUrls(text)
            onClose() // 面板随任务进度显示，取消后不再回到粘贴框
          }}
        >
          开始入库
        </Button>
      </footer>
    </section>
  )
}

function PageResult({ preview }: { preview: ImportPreview }) {
  if (preview.error) {
    return (
      <li className="import-item failed">
        <div className="import-item-title">{preview.url}</div>
        <div className="import-error">{preview.error}</div>
      </li>
    )
  }
  const s = summarize([preview])
  return (
    <li className="import-item">
      <div className="import-item-title">{preview.title || preview.url}</div>
      <div className="import-item-meta">
        拆出 {s.total} 道，已在库 {s.duplicate} 道
        {s.noKnowledge > 0 && <span className="import-warn">，{s.noKnowledge} 道没取到知识点</span>}
        {s.noDifficulty > 0 && <span className="import-warn">，{s.noDifficulty} 道没取到难度</span>}
      </div>
    </li>
  )
}

function RunningView() {
  const { progress, stage } = useImportState()
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  return (
    <section className="import-panel" aria-label="入库进度">
      <header>
        <h2>入库进度</h2>
        <span className="import-count">
          {done} / {total}
        </span>
      </header>
      <div className="import-body">
        <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : '0%' }} />
        </div>
        {stage === 'starting' && <p className="import-hint">正在启动</p>}
        {progress?.current && <p className="import-current">正在处理：{progress.current}</p>}
        {progress?.waitingForUser && (
          <p className="import-callout" role="alert" data-testid="import-waiting">
            {progress.waitingForUser}
          </p>
        )}
        <ul className="import-list">
          {progress?.previews.map((p, i) => (
            <PageResult key={i} preview={p} />
          ))}
        </ul>
      </div>
      <footer>
        <span />
        <Button onClick={() => void importActions.cancel()}>取消</Button>
      </footer>
    </section>
  )
}

function PreviewView() {
  const { progress, stage, error } = useImportState()
  const previews = progress?.previews ?? []
  const committing = stage === 'committing'
  const s = summarize(previews)
  // S18：没有新题可入（全部已在库，或一道都没拆出来）时不能确认；已在库的题有可补齐的知识点与难度时例外，按钮改为「补齐知识点与难度」
  const nothingNew = s.fresh === 0 && s.fill === 0
  const fillOnly = s.fresh === 0 && s.fill > 0
  return (
    <section className="import-panel" aria-label="入库预览">
      <header>
        <h2>入库预览</h2>
      </header>
      <div className="import-body">
        <SummaryLine previews={previews} />
        <ClassifyNotes s={s} />
        {nothingNew && (
          <p className="import-callout is-blocking" role="status" data-testid="import-nothing-new">
            {s.total === 0 ? '没有拆出题目，无法入库。' : '拆出的题都已在库，没有可入库的新题，所以不能确认入库。'}
          </p>
        )}
        {s.fresh > 0 && s.freshWithAnswer === 0 && (
          <p className="notice import-callout" role="status" data-testid="import-no-answer">
            带答案 0 道：这批新题入库后都没有答案，之后下载带答案的教师版需要先补上答案。
          </p>
        )}
        {error && (
          <p className="import-error" role="alert">
            {error}
          </p>
        )}
        {previews.map((preview, i) => (
          <details key={i} className="import-page" open={previews.length <= 2 || countMismatch(preview)}>
            <summary>
              <span className="import-page-title">{preview.title || preview.url}</span>
              {preview.error ? (
                <span className="import-warn">失败</span>
              ) : (
                <span className="import-item-meta">
                  {preview.questions.length} 道，已在库 {preview.questions.filter((q) => q.duplicate).length} 道
                  {preview.noKnowledge > 0 && <span className="import-warn" style={WARN_LINE}>{preview.noKnowledge} 道没取到知识点</span>}
                  {preview.noDifficulty > 0 && <span className="import-warn" style={WARN_LINE}>{preview.noDifficulty} 道没取到难度</span>}
                </span>
              )}
            </summary>
            {preview.error && <p className="import-error">{preview.error}</p>}
            {countMismatch(preview) && (
              <p className="import-callout" role="alert">
                页面标明共 {preview.declaredCount} 题，拆出 {preview.questions.length} 道，页面结构可能有变化，请核对后再入库。
              </p>
            )}
            <ol className="import-questions">
              {preview.questions.map((q, n) => (
                <li key={q.tempId} className={q.duplicate ? 'dup' : ''}>
                  <span className="import-q-no">{n + 1}</span>
                  <div className="import-q-main">
                    <div className="import-q-tags">
                      <Tag>{q.questionType || '题型未知'}</Tag>
                      {q.numberCount > 1 && <Tag tone="plain">含 {q.numberCount} 小题</Tag>}
                      <Tag tone={q.hasAnswer ? 'ok' : 'plain'}>{q.hasAnswer ? '有答案' : '无答案'}</Tag>
                      {q.duplicate && <Tag tone="warn">已在库</Tag>}
                      {q.fill && <Tag tone="plain">将补齐</Tag>}
                      {partlyMissing(preview.noKnowledge, preview.questions.length) && q.knowledgeCount === 0 && <Tag tone="warn">无知识点</Tag>}
                      {partlyMissing(preview.noDifficulty, preview.questions.length) && q.difficulty === null && <Tag tone="warn">无难度</Tag>}
                      {q.failedImages > 0 && <Tag tone="warn">缺 {q.failedImages} 张图</Tag>}
                    </div>
                    <div className="import-q-text">{q.previewText}</div>
                    <div className="import-q-src">{q.sourceLabel}</div>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
      <footer>
        <Button disabled={committing} onClick={() => void importActions.cancel()}>
          取消
        </Button>
        <Button variant="primary" disabled={committing || nothingNew} onClick={() => void importActions.commit()}>
          {committing ? '正在入库' : fillOnly ? '补齐知识点与难度' : '确认入库'}
        </Button>
      </footer>
    </section>
  )
}

function DoneView() {
  const { result } = useImportState()
  const added = result?.added ?? 0
  const filled = result?.filled ?? 0
  // 去试题库只看本次入库的题：先把「本次入库」写进试题库的筛选条件，再跳转；面板同时收起，回到采集页时不留结果面板
  const goLibrary = (): void => {
    libraryFilter.showBatch(result?.addedIds ?? [])
    importActions.dismiss()
    navigateTo('library')
  }
  return (
    <section className="import-panel" aria-label="入库完成">
      <header>
        <h2>入库完成</h2>
      </header>
      <div className="import-body">
        <p className="import-done" role="status" data-testid="import-result">
          新增 {added} 道，跳过 {result?.skipped ?? 0} 道（已在库）{filled > 0 ? `，补齐知识点与难度 ${filled} 道` : ''}
        </p>
        {added === 0 && <p className="import-done-note">{filled > 0 ? `没有新增题目，试题库里已有的 ${filled} 道题补齐了知识点与难度。` : '没有新增题目，试题库里的题目没有变化。'}</p>}
      </div>
      <footer>
        <Button onClick={importActions.dismiss}>关闭</Button>
        {added > 0 && (
          <Button variant="primary" onClick={goLibrary}>
            去试题库看本次入库
          </Button>
        )}
      </footer>
    </section>
  )
}

export default function ImportPanel({ pasteOpen, onClosePaste }: Props) {
  const { stage } = useImportState()
  if (stage === 'idle') return pasteOpen ? <PasteForm onClose={onClosePaste} /> : null
  if (stage === 'starting' || stage === 'running') return <RunningView />
  if (stage === 'preview' || stage === 'committing') return <PreviewView />
  // 入库完成后点工具栏的「粘贴链接入库」：直接换成粘贴框，不必先关掉结果；关闭粘贴框回到结果
  return pasteOpen ? <PasteForm onClose={onClosePaste} /> : <DoneView />
}
