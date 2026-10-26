// 试题库页的一行题目：序号、题型与答案标记、题干（过长折叠，短题不出「展开」）、来源、加入试卷与删除。
// 删除按钮平时是中性的灰框小按钮（红笔只标改动，一屏几十个红色删除会淹掉真正要看的东西）；
// 点了之后才进入确认：整行变红底，「试卷副本不受影响」（试卷里存的是题目副本，删原题不会动它）。
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LibraryQuestion, PaperSummary } from '@shared/domain'
import { hasVisibleContent } from '@shared/numbering'
import { IconTrash } from '../../icons'
import QuestionHtml from '../QuestionHtml'
import { Button, Tag } from '../ui'
import AddToPaperMenu from './AddToPaperMenu'
import { highlightHtml } from './highlight'
import './library.css'

interface Props {
  index: number
  question: LibraryQuestion
  keyword: string
  markNoAnswer: boolean // 全库都没有答案时为 false：只在页面顶部提示一次，行内不逐个标
  usage: number // 已用于几份试卷
  recentPapers: PaperSummary[]
  adding: boolean
  onAdd(question: LibraryQuestion, paperId: number): void
  onPick(question: LibraryQuestion): void
  onDelete(id: number): Promise<void>
}

const COLLAPSED_HEIGHT = 150

// 题干里的图片是异步加载的，高度会变化：用 ResizeObserver 持续判断是否超出折叠高度
function useOverflow(ref: RefObject<HTMLDivElement | null>): boolean {
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = (): void => setOverflow(el.scrollHeight > COLLAPSED_HEIGHT + 8)
    const observer = new ResizeObserver(check)
    observer.observe(el)
    Array.from(el.children).forEach((child) => observer.observe(child))
    check()
    return () => observer.disconnect()
  }, [ref])
  return overflow
}

export default function QuestionRow({ index, question: q, keyword, markNoAnswer, usage, recentPapers, adding, onAdd, onPick, onDelete }: Props) {
  const stemRef = useRef<HTMLDivElement>(null)
  const overflow = useOverflow(stemRef)
  const [expanded, setExpanded] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const hasAnswer = hasVisibleContent(q.answerHtml)
  const stemHtml = useMemo(() => highlightHtml(q.stemHtml, keyword), [q.stemHtml, keyword])

  const remove = async (): Promise<void> => {
    setDeleting(true)
    try {
      await onDelete(q.id)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <article className={`lb-row${confirming ? ' is-confirming' : ''}`} data-testid="question-card">
      <span className="lb-idx">{index}</span>
      <div className="lb-main">
        <div className="lb-tags">
          <Tag>{q.questionType || '题型未知'}</Tag>
          {q.numberCount > 1 && <Tag tone="plain">含 {q.numberCount} 小题</Tag>}
          {hasAnswer ? <Tag tone="ok">有答案</Tag> : markNoAnswer && <Tag tone="plain">无答案</Tag>}
        </div>
        <div className={`lb-stem${expanded ? ' is-expanded' : ''}${overflow && !expanded ? ' is-clamped' : ''}`} ref={stemRef}>
          <QuestionHtml html={stemHtml} firstNo={1} />
        </div>
        {(overflow || expanded || hasAnswer) && (
          <div className="lb-links">
            {(overflow || expanded) && (
              <Button variant="link" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                {expanded ? '收起题干' : '展开全部题干'}
              </Button>
            )}
            {hasAnswer && (
              <Button variant="link" size="sm" aria-expanded={showAnswer} onClick={() => setShowAnswer((v) => !v)}>
                {showAnswer ? '收起答案' : '查看答案'}
              </Button>
            )}
          </div>
        )}
        {showAnswer && q.answerHtml && (
          <div className="lb-answer" data-testid="question-answer">
            <QuestionHtml html={q.answerHtml} firstNo={1} />
          </div>
        )}
      </div>
      <div className="lb-src">
        {q.sourceLabel && <div className="lb-src-label">{q.sourceLabel}</div>}
        <div className="lb-src-paper" title={q.sourcePaperTitle}>
          {q.sourcePaperTitle ? `来源卷：${q.sourcePaperTitle}` : '无来源卷'}
        </div>
      </div>
      <div className="lb-ops">
        {confirming ? (
          <>
            <p className="lb-confirm-text">
              删除这道原题？
              <br />
              {usage > 0 ? `已用于 ${usage} 份试卷，试卷里的副本不受影响` : '试卷副本不受影响'}
            </p>
            <Button variant="danger" size="sm" disabled={deleting} onClick={() => void remove()}>
              确认删除
            </Button>
            <Button size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              取消
            </Button>
          </>
        ) : (
          <>
            <AddToPaperMenu recent={recentPapers} disabled={adding} onAdd={(paperId) => onAdd(q, paperId)} onPick={() => onPick(q)} />
            {usage > 0 && (
              <span className="lb-usage" data-testid="question-usage">
                已用于 {usage} 份试卷
              </span>
            )}
            <Button size="sm" className="lb-del" icon={<IconTrash size={14} />} onClick={() => setConfirming(true)}>
              删除
            </Button>
          </>
        )}
      </div>
    </article>
  )
}
