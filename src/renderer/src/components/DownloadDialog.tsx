// 下载弹窗：顶部切换「试卷 / 答题卡」；试卷页用老师的说法（学生版 / 教师版，教师版再选答案在卷尾还是题后）。
// 打开时和每次改选项都向主进程做一次自检（checkExport）：阻止项禁用对应选项或下载按钮并写出原因，
// 提示项列出题号，题号可点击定位（onLocate）。文件名预览直接给出重名后的实际名字。
// 下载完成后选项保持可改，主按钮变成「再下载一份」。底层仍是 ExportOptions。
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { normalizeExportOptions, type ExportFormat, type ExportKind, type ExportOptions, type SourcePosition } from '@shared/domain'
import { ANSWER_SPACE_MM, PDF_FILL_MM, type ExportCheck, type ExportIssue, type ExportIssueType, type ExportResult } from '@shared/export'
import { IconFolder } from '../icons'
import { Button, Checkbox, Modal, Segmented, Tag, errorMessage } from './ui'
import './DownloadDialog.css'

export interface DownloadDialogProps {
  paperId: number
  open: boolean
  initialKind?: ExportKind // 打开时选中「试卷」还是「答题卡」，默认试卷
  onClose(): void
  onExported?(result: ExportResult): void // 每生成一份调用一次，编辑器据此刷新版本信息
  onLocate?(questionNo: number): void // 点击提示里的题号：编辑器关闭弹窗并定位到该题
}

type Phase = 'idle' | 'working' | 'done'
type Edition = 'student' | 'teacher'
type TeacherPosition = 'end' | 'after'

// 试卷页的配置：把 ExportOptions 里的「答案位置」拆成版别与教师版的答案位置，方便按老师的说法选
interface PaperForm {
  edition: Edition
  teacherPos: TeacherPosition
  sourcePosition: SourcePosition
  format: ExportFormat
  answerArea: boolean
}

const DEFAULT_FORM: PaperForm = { edition: 'student', teacherPos: 'end', sourcePosition: 'none', format: 'pdf', answerArea: false }

function formOf(options: ExportOptions): PaperForm {
  return {
    edition: options.answerPosition === 'none' ? 'student' : 'teacher',
    teacherPos: options.answerPosition === 'after' ? 'after' : 'end',
    sourcePosition: options.sourcePosition,
    format: options.format,
    answerArea: options.answerArea
  }
}

function optionsOf(form: PaperForm, edition: Edition): ExportOptions {
  return normalizeExportOptions({
    answerPosition: edition === 'student' ? 'none' : form.teacherPos,
    sourcePosition: form.sourcePosition,
    format: form.format,
    answerArea: form.answerArea
  })
}

// 一次下载要生成的一份文件
interface Job {
  kind: ExportKind
  options: ExportOptions
  label: string
}

function jobsOf(kind: ExportKind, form: PaperForm, both: boolean, alsoPaper: boolean): Job[] {
  const student: Job = { kind: 'paper', options: optionsOf(form, 'student'), label: '学生版' }
  const teacher: Job = { kind: 'paper', options: optionsOf(form, 'teacher'), label: '教师版' }
  if (kind === 'answer-sheet') {
    const sheet: Job = { kind: 'answer-sheet', options: optionsOf(form, 'student'), label: '答题卡' }
    return alsoPaper ? [sheet, student] : [sheet]
  }
  if (both) return [student, teacher]
  return [form.edition === 'student' ? student : teacher]
}

// 路径里最后一个分隔符之后是文件名；文件夹太长时省略前面的部分，文件名一直完整显示
const splitAt = (path: string): number => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', docx: 'DOCX' }

const ISSUE_LABEL: Record<ExportIssueType, string> = {
  'empty-paper': '空试卷',
  'no-answers': '没有答案',
  'partial-answers': '缺答案',
  unscored: '未设分值',
  'empty-section': '空大题',
  'unnamed-section': '大题无名',
  'empty-stem': '题干为空',
  'duplicate-question': '重复题',
  'score-mismatch': '总分不符'
}

// 来源三种位置各配一个例子，选中哪个就显示哪个
const SOURCE_EXAMPLE: Record<SourcePosition, string> = {
  none: '试卷里不写题目来源。',
  'before-stem': '题文前：写在每道题的题干前，如「1.（2025·福建泉州·期中）下列…」。',
  answer: '答案处：写在答案前，如「（2025·福建泉州·期中）【答案】C」；学生版没有答案，不能选。'
}

// 把「第 2、4、8～11 题…」里的题号变成可点击的按钮：每段（单个题号或一个范围）定位到它的第一题
function MessageWithNumbers({ issue, onLocate }: { issue: ExportIssue; onLocate?: (no: number) => void }): ReactNode {
  const { message, questionLabel } = issue
  const at = questionLabel ? message.indexOf(questionLabel) : -1
  if (!onLocate || at < 0) return message
  const parts = questionLabel.split('、')
  return (
    <>
      {message.slice(0, at)}
      {parts.map((part, k) => (
        <span key={part}>
          {k > 0 && '、'}
          <button type="button" className="dl-no" title={`定位到第 ${parseInt(part, 10)} 题`} onClick={() => onLocate(parseInt(part, 10))}>
            {part}
          </button>
        </span>
      ))}
      {message.slice(at + questionLabel.length)}
    </>
  )
}

function Row({ label, children, hint, hintTone }: { label: string; children: ReactNode; hint?: ReactNode; hintTone?: 'warn' }) {
  return (
    <div className="dl-row">
      <span className="dl-label">{label}</span>
      <div className="dl-field">
        {children}
        {hint && <p className={`dl-hint${hintTone === 'warn' ? ' is-warn' : ''}`}>{hint}</p>}
      </div>
    </div>
  )
}

export default function DownloadDialog({ paperId, open, initialKind = 'paper', onClose, onExported, onLocate }: DownloadDialogProps) {
  const [kind, setKind] = useState<ExportKind>(initialKind)
  const [form, setForm] = useState<PaperForm>(DEFAULT_FORM)
  const [both, setBoth] = useState(false) // 试卷页：学生版和教师版各一份
  const [alsoPaper, setAlsoPaper] = useState(false) // 答题卡页：同时下载试卷（学生版）
  const [directory, setDirectory] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [check, setCheck] = useState<ExportCheck | null>(null)
  const [names, setNames] = useState<{ job: Job; name: string; renamed: boolean }[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{ index: number; total: number; label: string } | null>(null)
  const [results, setResults] = useState<{ job: Job; result: ExportResult }[]>([])
  const [error, setError] = useState<string | null>(null)
  const statusId = useId()
  const resultRef = useRef<HTMLElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const working = phase === 'working'

  const jobs = useMemo(() => jobsOf(kind, form, both, alsoPaper), [kind, form, both, alsoPaper])
  const jobsKey = JSON.stringify(jobs)
  // 自检看最严的那一份：同时下载学生版和教师版时按教师版检查
  const checkJob = jobs.find((j) => j.kind === 'answer-sheet') ?? jobs[jobs.length - 1]
  const checkKey = JSON.stringify(checkJob)

  // 打开时读取上一次的配置与保存位置，重置状态
  useEffect(() => {
    if (!open) return
    let stale = false
    setKind(initialKind)
    setBoth(false)
    setAlsoPaper(false)
    setPhase('idle')
    setProgress(null)
    setResults([])
    setError(null)
    setCheck(null)
    setNames([])
    setLoaded(false)
    window.workbench.exporter
      .getDefaults()
      .then((defaults) => {
        if (stale) return
        setForm(formOf(normalizeExportOptions(defaults.options)))
        setDirectory(defaults.directory)
        setLoaded(true)
      })
      .catch((e: unknown) => !stale && setError(errorMessage(e)))
    return () => {
      stale = true
    }
  }, [open, paperId, initialKind])

  // 自检：打开时、切换类型与选项时都重新跑
  useEffect(() => {
    if (!open || !loaded) return
    let stale = false
    const job = JSON.parse(checkKey) as Job
    window.workbench.exporter
      .checkExport(paperId, job.options, job.kind)
      .then((next) => !stale && setCheck(next))
      .catch((e: unknown) => !stale && setError(errorMessage(e)))
    return () => {
      stale = true
    }
  }, [open, loaded, paperId, checkKey])

  // 文件名预览：带保存位置，给出重名后的实际名字；与不带保存位置的基础名比较，不同就标出「重名」
  useEffect(() => {
    if (!open || !loaded || !directory) return
    let stale = false
    const list = JSON.parse(jobsKey) as Job[]
    Promise.all(
      list.map(async (job) => {
        const [name, base] = await Promise.all([
          window.workbench.exporter.previewFileName(paperId, job.options, job.kind, directory),
          window.workbench.exporter.previewFileName(paperId, job.options, job.kind)
        ])
        return { job, name, renamed: name !== base }
      })
    )
      .then((next) => !stale && setNames(next))
      .catch(() => !stale && setNames([]))
    return () => {
      stale = true
    }
  }, [open, loaded, paperId, directory, jobsKey, results])

  // 选项、保存位置一改，上一次的结果就和当前选择对不上了：清掉结果区，主按钮回到下载
  useEffect(() => {
    setResults([])
    setPhase((p) => (p === 'working' ? p : 'idle'))
    setError(null)
  }, [jobsKey, directory])

  // 整卷没有答案：教师版不能选。当前选的是教师版（上次的配置）就切回学生版
  const noAnswers = check !== null && check.questionCount > 0 && check.answerMissingCount === check.questionCount
  useEffect(() => {
    if (!noAnswers) return
    if (form.edition === 'teacher') setForm((f) => ({ ...f, edition: 'student' }))
    if (both) setBoth(false)
  }, [noAnswers, form.edition, both])

  // 窗口矮时表单很长，结果与错误出现在最下面：自动滚到可见位置
  useEffect(() => {
    if (results.length > 0 && !working) resultRef.current?.scrollIntoView({ block: 'nearest' })
  }, [results, working])
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  const close = useCallback(() => {
    if (!working) onClose()
  }, [working, onClose])

  const updateForm = (patch: Partial<PaperForm>): void => {
    setForm((f) => ({ ...f, ...patch }))
    setError(null)
  }

  const chooseDirectory = async (): Promise<void> => {
    try {
      const picked = await window.workbench.exporter.chooseDirectory(directory)
      if (picked) {
        setDirectory(picked)
        setError(null)
      }
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const download = async (): Promise<void> => {
    setPhase('working')
    setError(null)
    const done: { job: Job; result: ExportResult }[] = []
    try {
      for (const [index, job] of jobs.entries()) {
        setProgress({ index: index + 1, total: jobs.length, label: job.kind === 'answer-sheet' ? '答题卡' : `${job.label} ${FORMAT_LABEL[job.options.format]}` })
        const result = await window.workbench.exporter.exportPaper({ paperId, kind: job.kind, options: job.options, directory })
        done.push({ job, result })
        onExported?.(result)
      }
      setPhase('done')
    } catch (e) {
      setError(done.length > 0 ? `已保存 ${done.length} 份，第 ${done.length + 1} 份失败：${errorMessage(e)}` : errorMessage(e))
      setPhase(done.length > 0 ? 'done' : 'idle')
    } finally {
      setProgress(null)
      setResults(done)
    }
  }

  const showInFolder = async (filePath: string): Promise<void> => {
    try {
      await window.workbench.exporter.showInFolder(filePath)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const blocked = check?.blocked ?? false
  const blockingIssues = check?.issues.filter((i) => i.blocking) ?? []
  const tips = check?.issues.filter((i) => !i.blocking) ?? []
  const busy = working || !loaded
  const downloadDisabled = busy || !directory || check === null || blocked
  const reason = !loaded ? '' : !directory ? '请先选择保存位置' : blocked ? (blockingIssues[0]?.message ?? '') : ''
  // 页签决定标题与按钮：下载试卷 / 下载答题卡；多份写份数。下载完成后同一配置再点会覆盖原文件，写「重新生成」
  const idleLabel = jobs.length > 1 ? `下载 ${jobs.length} 份` : kind === 'paper' ? '下载试卷' : '下载答题卡'
  const primaryLabel = working ? '正在生成…' : phase === 'done' ? (jobs.length > 1 ? `重新生成 ${jobs.length} 份` : '重新生成') : idleLabel

  const sourceChoices: { value: SourcePosition; label: string; disabled?: boolean; title: string }[] = [
    { value: 'none', label: '不显示', title: SOURCE_EXAMPLE.none },
    { value: 'before-stem', label: '题文前', title: SOURCE_EXAMPLE['before-stem'] },
    { value: 'answer', label: '答案处', disabled: form.edition === 'student' && !both, title: SOURCE_EXAMPLE.answer }
  ]
  const teacherAfter = form.teacherPos === 'after' && (form.edition === 'teacher' || both)
  // 联动只改显示，不改用户选过的值：学生版没有答案，来源不能放在答案处；答案在题后时不留作答区域（切回卷尾后恢复原选择）
  const sourceShown: SourcePosition = form.edition === 'student' && !both && form.sourcePosition === 'answer' ? 'none' : form.sourcePosition
  const areaShown = teacherAfter && !both ? false : form.answerArea

  return (
    <Modal
      open={open}
      title={kind === 'paper' ? '下载试卷' : '下载答题卡'}
      size="lg"
      locked={working}
      onClose={close}
      footer={
        <>
          <span className={`dl-foot-note${blocked ? ' is-block' : ''}`} id={statusId} role={reason ? 'status' : undefined}>
            {reason}
          </span>
          <Button disabled={working} onClick={close}>
            {phase === 'done' ? '关闭' : '取消'}
          </Button>
          <Button variant="primary" disabled={downloadDisabled} aria-describedby={reason ? statusId : undefined} onClick={() => void download()}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="dl-body">
        <div className="dl-kind">
          <Segmented
            label="下载内容"
            value={kind}
            onChange={(next) => {
              setKind(next)
              setError(null)
              // 上一类的下载结果不跟到另一页
              setResults([])
              setPhase('idle')
            }}
            disabled={working}
            options={[
              { value: 'paper', label: '试卷' },
              { value: 'answer-sheet', label: '答题卡' }
            ]}
          />
        </div>

        {(blockingIssues.length > 0 || tips.length > 0 || (check && check.issues.length === 0)) && (
          <section className="dl-check" aria-label="下载前检查">
            {check && check.issues.length === 0 ? (
              <p className="dl-clear">下载前检查：没有发现问题。</p>
            ) : (
              <ul>
                {[...blockingIssues, ...tips].map((issue, k) => (
                  <li key={`${issue.type}-${k}`} className={issue.blocking ? 'is-block' : 'is-tip'}>
                    <Tag tone={issue.blocking ? 'red' : 'warn'}>{ISSUE_LABEL[issue.type]}</Tag>
                    <span className="dl-issue-text">
                      <MessageWithNumbers issue={issue} onLocate={working ? undefined : onLocate} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {kind === 'paper' ? (
          <>
            <Row
              label="版别"
              hint={
                noAnswers
                  ? `整卷 ${check?.questionCount} 题都没有答案，教师版不能选。给题目添加答案后才能下载教师版。`
                  : both
                    ? '两份都生成：学生版没有答案，教师版带答案。'
                    : form.edition === 'student'
                      ? '学生版：只有题目，不带答案。'
                      : '教师版：题目加答案。'
              }
              hintTone={noAnswers ? 'warn' : undefined}
            >
              <Segmented
                label="版别"
                value={form.edition}
                onChange={(edition) => updateForm({ edition })}
                disabled={working || both}
                options={[
                  { value: 'student', label: '学生版' },
                  { value: 'teacher', label: '教师版', disabled: noAnswers, title: noAnswers ? '整卷没有答案，教师版不能选' : undefined }
                ]}
              />
            </Row>
            <div className="dl-row dl-row--tight">
              <span className="dl-label" />
              <Checkbox checked={both} disabled={working || noAnswers} onChange={(next) => setBoth(next)}>
                学生版和教师版各下载一份
              </Checkbox>
            </div>

            {(form.edition === 'teacher' || both) && (
              <Row label="答案位置" hint={form.teacherPos === 'end' ? '卷尾：正文之后另起一页，集中写「参考答案」。' : '题后：答案紧跟在每道题后面。'}>
                <Segmented
                  label="答案位置"
                  value={form.teacherPos}
                  onChange={(teacherPos) => updateForm({ teacherPos })}
                  disabled={working}
                  options={[
                    { value: 'end', label: '卷尾' },
                    { value: 'after', label: '题后' }
                  ]}
                />
              </Row>
            )}

            <Row label="试题来源" hint={sourceChoices[2].disabled ? `${SOURCE_EXAMPLE[sourceShown]}答案处仅教师版可选。` : SOURCE_EXAMPLE[sourceShown]}>
              <Segmented label="试题来源" value={sourceShown} onChange={(sourcePosition) => updateForm({ sourcePosition })} disabled={working} options={sourceChoices} />
            </Row>

            <Row
              label="作答区域"
              hint={
                teacherAfter
                  ? `答案在题后时不留作答区域${both ? '（学生版仍按所选留白）' : ''}。`
                  : areaShown
                    ? form.format === 'pdf'
                      ? `每页剩下的空间按比例摊给各题的作答空白（计算题 ${ANSWER_SPACE_MM.calc}mm 起，解答题 ${ANSWER_SPACE_MM.solve}mm 起，其他题 ${PDF_FILL_MM.single}mm 起），页底不留白；书面表达画横线。`
                      : `计算题留白 ${ANSWER_SPACE_MM.calc}mm，解答题 ${ANSWER_SPACE_MM.solve}mm，书面表达画横线。`
                    : '不留白，题目连续排版。'
              }
            >
              <Segmented
                label="作答区域"
                value={areaShown ? 'yes' : 'no'}
                onChange={(next) => updateForm({ answerArea: next === 'yes' })}
                disabled={working}
                options={[
                  { value: 'no', label: '不留' },
                  { value: 'yes', label: '留作答区域', disabled: teacherAfter && !both }
                ]}
              />
            </Row>

            <Row label="文件格式">
              <Segmented
                label="文件格式"
                value={form.format}
                onChange={(format) => updateForm({ format })}
                disabled={working}
                options={[
                  { value: 'pdf', label: 'PDF' },
                  { value: 'docx', label: 'Word（DOCX）' }
                ]}
              />
            </Row>
          </>
        ) : (
          <>
            <p className="dl-desc">答题卡按试卷的大题和题型自动排版：选择题为填写表格，填空题为横线，解答题每题一个黑框，书面表达为横线格。A4，只生成 PDF。</p>
            <Checkbox checked={alsoPaper} disabled={working} onChange={(next) => setAlsoPaper(next)}>
              同时下载试卷（学生版，沿用试卷页选的来源、作答区域与格式）
            </Checkbox>
          </>
        )}

        <div className="dl-divider" />

        <Row label="保存位置">
          <div className="dl-path">
            <span className="dl-path-text" title={directory}>
              {directory || '—'}
            </span>
            <Button size="sm" icon={<IconFolder size={16} />} disabled={busy} onClick={() => void chooseDirectory()}>
              更改…
            </Button>
          </div>
        </Row>
        <Row label="文件名">
          <ul className="dl-names">
            {names.length === 0 && <li className="dl-name">—</li>}
            {names.map(({ job, name, renamed }) => (
              <li key={`${job.kind}-${job.label}`} className="dl-name">
                {names.length > 1 && <span className="dl-name-tag">{job.label}</span>}
                <span className="dl-name-text" title={name}>
                  {name}
                </span>
                {renamed && <Tag tone="warn">保存位置里已有同名文件，自动改名保存</Tag>}
              </li>
            ))}
          </ul>
        </Row>

        {working && progress && (
          <div className="dl-status" role="status">
            <span className="dl-bar" aria-hidden="true" />
            正在生成{progress.total > 1 ? `（第 ${progress.index} / ${progress.total} 份）` : ''}：{progress.label}，请稍候
          </div>
        )}

        {results.length > 0 && !working && (
          <section className="dl-result" aria-label="下载结果" ref={resultRef}>
            <p className="dl-result-title">{results.every((r) => r.result.overwritten) ? `已重新生成 ${results.length} 份` : `已保存 ${results.length} 份`}</p>
            <ul>
              {results.map(({ job, result }) => (
                <li key={result.filePath}>
                  <span className="dl-result-main">
                    <strong>{job.label}</strong>
                    {result.pageCount != null && <span className="dl-result-pages">{result.pageCount} 页</span>}
                    {result.overwritten && <Tag tone="plain">已覆盖同名文件</Tag>}
                    <span className="dl-result-path" title={result.filePath}>
                      <span className="dl-result-dir">{result.filePath.slice(0, splitAt(result.filePath))}</span>
                      <span className="dl-result-file">{result.filePath.slice(splitAt(result.filePath))}</span>
                    </span>
                  </span>
                  <Button size="sm" variant="link" onClick={() => void showInFolder(result.filePath)}>
                    打开所在文件夹
                  </Button>
                </li>
              ))}
            </ul>
            <p className="dl-result-note">
              {results.some((r) => r.result.createdVersion)
                ? `当前草稿已保存为 v${results[0].result.versionNo}`
                : `对应版本 v${results[0].result.versionNo}`}
            </p>
          </section>
        )}

        {error && (
          <div className="dl-error" role="alert" ref={errorRef}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
