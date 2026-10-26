// 试题库页的一行题目：勾选框与序号、题型与答案标记、题干（过长折叠，短题不出「展开」）、章节 / 难度 / 知识点 / 标签、来源、加入试卷、标签与删除。
// 章节、难度、知识点、标签都是中性样式（印刷黑字、发丝线）：困难不标红、容易不标绿；没有的项不占位。
// 删除按钮平时是中性的灰框小按钮（红笔只标改动，一屏几十个红色删除会淹掉真正要看的东西）；
// 点了之后才进入确认：整行变红底，「试卷副本不受影响」（试卷里存的是题目副本，删原题不会动它）。
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { difficultyTier, type Tag as QuestionTag, type TagRef } from '@shared/classify'
import type { LibraryQuestion, PaperSummary } from '@shared/domain'
import { hasVisibleContent } from '@shared/numbering'
import { IconChevronDown, IconTrash } from '../../icons'
import { TagPicker } from '../classify'
import QuestionHtml from '../QuestionHtml'
import { Button, Checkbox, Popover, Tag } from '../ui'
import AddToPaperMenu from './AddToPaperMenu'
import { highlightHtml } from './highlight'
import './library.css'

// 题目行上的「标签」按钮：弹出 TagPicker，勾选已有标签或输入新建
export interface RowTagApi {
  tags: QuestionTag[] // 全部题目标签
  onToggle(question: LibraryQuestion, tag: TagRef, on: boolean): Promise<void>
  onCreate(name: string): Promise<TagRef>
  onManage(): void
  onClosed(): void // 选择框关闭：页面这时才刷新列表，打标签过程中这一行不会突然消失
}

interface Props {
  index: number
  question: LibraryQuestion
  selected: boolean
  onSelect(next: boolean): void
  chapterLabel: string | null // 「第一章 › 1.2 数轴」；未归章节为 null
  tagApi: RowTagApi
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
// 题目行上最多显示几个标签，其余折成「+N」（悬停列全部）
const TAGS_SHOWN = 3

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

export default function QuestionRow({ index, question: q, selected, onSelect, chapterLabel, tagApi, keyword, markNoAnswer, usage, recentPapers, adding, onAdd, onPick, onDelete }: Props) {
  const stemRef = useRef<HTMLDivElement>(null)
  const overflow = useOverflow(stemRef)
  const [expanded, setExpanded] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const hasAnswer = hasVisibleContent(q.answerHtml)
  const stemHtml = useMemo(() => highlightHtml(q.stemHtml, keyword), [q.stemHtml, keyword])
  const tier = difficultyTier(q.difficulty)
  const checkedTags = useMemo(() => new Set(q.tags.map((t) => t.id)), [q.tags])

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
    <article className={`lb-row${confirming ? ' is-confirming' : ''}${selected ? ' is-selected' : ''}`} data-testid="question-card">
      <div className="lb-sel">
        <Checkbox checked={selected} onChange={onSelect} aria-label={`选择第 ${index} 题`} />
        <span className="lb-idx">{index}</span>
      </div>
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
        {(chapterLabel || tier || q.knowledge.length > 0 || q.tags.length > 0) && (
          <div className="lb-meta" data-testid="question-meta">
            {(chapterLabel || tier) && (
              // 章节与难度同一行：章节路径过长时在末尾省略（悬停看全称），难度不被挤掉
              <span className="lb-meta-line">
                {chapterLabel && (
                  <span className="lb-meta-item lb-meta-chapter" data-testid="meta-chapter" title={chapterLabel}>
                    <span className="lb-meta-k">章节</span>
                    <span className="lb-meta-text">{chapterLabel}</span>
                  </span>
                )}
                {tier && (
                  <span className="lb-meta-item lb-meta-fixed" data-testid="meta-difficulty" title={`难度系数 ${q.difficulty}`}>
                    <span className="lb-meta-k">难度</span>
                    {tier.label}
                  </span>
                )}
              </span>
            )}
            {q.knowledge.length > 0 && (
              <span className="lb-meta-item lb-meta-knowledge" data-testid="meta-knowledge" title={q.knowledge.map((k) => k.name).join('、')}>
                <span className="lb-meta-k">知识点</span>
                <span className="lb-meta-text">{q.knowledge.slice(0, 2).map((k) => k.name).join('、')}</span>
                {q.knowledge.length > 2 && <span className="lb-meta-more">+{q.knowledge.length - 2}</span>}
              </span>
            )}
            {q.tags.slice(0, TAGS_SHOWN).map((tag) => (
              <span key={tag.id} className="lb-tagchip" data-testid="meta-tag" title={tag.name}>
                {tag.name}
              </span>
            ))}
            {q.tags.length > TAGS_SHOWN && (
              <span className="lb-meta-more" data-testid="meta-tags-more" title={q.tags.map((t) => t.name).join('、')}>
                +{q.tags.length - TAGS_SHOWN}
              </span>
            )}
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
            <div className="lb-ops-pair">
              <Popover
                trigger={
                  <Button size="sm" iconAfter={<IconChevronDown size={14} />} aria-label={`给第 ${index} 题打标签`}>
                    标签
                  </Button>
                }
                label="打标签"
                align="end"
                onOpenChange={(open) => !open && tagApi.onClosed()}
              >
                {({ close }) => (
                  <TagPicker
                    tags={tagApi.tags}
                    checked={checkedTags}
                    onToggle={(tag, on) => void tagApi.onToggle(q, tag, on)}
                    onCreate={tagApi.onCreate}
                    onManage={() => {
                      close({ restoreFocus: false })
                      tagApi.onManage()
                    }}
                  />
                )}
              </Popover>
              <Button size="sm" className="lb-del" icon={<IconTrash size={14} />} onClick={() => setConfirming(true)}>
                删除
              </Button>
            </div>
          </>
        )}
      </div>
    </article>
  )
}
