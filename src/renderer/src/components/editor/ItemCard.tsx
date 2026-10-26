// 试卷里的一道题目副本：左侧拖动柄，正文（题号与题干同一行，宋体），右侧旁注栏放题型、来源、分值、答案与操作。
import { memo, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { PaperItem } from '@shared/domain'
import { hasVisibleContent } from '@shared/numbering'
import { Menu, NumberInput, Tag } from '../ui'
import { IconMore } from '../../icons'
import EditableHtml from './EditableHtml'
import { IconGrip } from './icons'
import MemoQuestionHtml from './MemoQuestionHtml'
import { SectionTargets } from './sectionsContext'

export interface ItemOps {
  select(itemId: string): void
  beginEdit(itemId: string): void
  toggleEdit(itemId: string): void
  change(itemId: string, patch: Partial<PaperItem>): void
  setScore(itemId: string, score: number | null): void
  remove(itemId: string): void
  moveBy(itemId: string, delta: -1 | 1): void
  moveTo(itemId: string, sectionId: string): void
  error(message: string): void
}

interface Props {
  item: PaperItem
  sectionId: string
  label: string // 题号标签，如「5」「5～7」
  firstNo: number
  scoreNote: string // itemScoreNote 的结果，未设分为空串
  inheritedScore: number | null // 所在大题的每小题默认分值
  selected: boolean
  editing: boolean
  dragging: boolean
  flash: boolean
  canUp: boolean
  canDown: boolean
  ops: ItemOps
}

function ScoreChip({ item, label, scoreNote, inheritedScore, ops }: Pick<Props, 'item' | 'label' | 'scoreNote' | 'inheritedScore' | 'ops'>) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const own = item.score != null
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])
  const multi = item.numberCount > 1

  if (editing) {
    return (
      <span
        className="ed-score-edit"
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setEditing(false)
          }
        }}
      >
        {multi ? '每小题' : '本题'}
        <NumberInput
          ref={inputRef}
          variant="inline"
          min={0.5}
          value={item.score ?? inheritedScore}
          onChange={(value) => ops.setScore(item.id, value)}
          aria-label={`第 ${label} 题${multi ? '每小题' : ''}分值`}
          unit="分"
          onBlur={() => setEditing(false)}
        />
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`ed-score${scoreNote ? '' : ' is-empty'}${own ? ' is-own' : ''}`}
      data-testid="score-chip"
      title={own ? '这道题单独设置了分值，点击修改；清空后跟随大题' : '点击修改这道题的分值'}
      onClick={() => setEditing(true)}
    >
      {scoreNote || '＋分值'}
    </button>
  )
}

function MoveMenu({ itemId, sectionId, canUp, canDown, ops }: { itemId: string; sectionId: string; canUp: boolean; canDown: boolean; ops: ItemOps }) {
  const targets = useContext(SectionTargets)
  return (
    <Menu
      align="end"
      label="题目操作"
      trigger={
        <button type="button" className="ed-note-more" aria-label="更多操作" title="更多操作">
          <IconMore size={16} />
        </button>
      }
      items={[
        { label: '上移', hint: 'Alt+↑', disabled: !canUp, onSelect: () => ops.moveBy(itemId, -1) },
        { label: '下移', hint: 'Alt+↓', disabled: !canDown, onSelect: () => ops.moveBy(itemId, 1) },
        ...(targets.length > 1
          ? ([{ heading: '移到大题' }, ...targets.filter((t) => t.id !== sectionId).map((t) => ({ label: t.label, onSelect: () => ops.moveTo(itemId, t.id) }))] as const)
          : [])
      ]}
    />
  )
}

function ItemCard({ item, sectionId, label, firstNo, scoreNote, inheritedScore, selected, editing, dragging, flash, canUp, canDown, ops }: Props) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [focusAnswer, setFocusAnswer] = useState(false)
  const { setNodeRef, setActivatorNodeRef, listeners } = useDraggable({ id: `item:${item.id}`, data: { kind: 'item', itemId: item.id, sectionId } })
  const hasAnswer = item.answerHtml != null
  const answered = hasVisibleContent(item.answerHtml)

  return (
    <article
      ref={setNodeRef}
      className={`ed-item${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}${flash ? ' is-flash' : ''}`}
      data-testid="paper-item"
      data-item-id={item.id}
      onClick={() => ops.select(item.id)}
    >
      <div className="ed-item-grip">
        <button type="button" className="ed-grip" tabIndex={-1} ref={setActivatorNodeRef} aria-label={`拖动第 ${label} 题`} title="拖动调整顺序" {...listeners}>
          <IconGrip />
        </button>
        <div className="ed-item-acts">
          <button type="button" className="ed-act" onClick={() => ops.toggleEdit(item.id)}>
            {editing ? '完成' : '编辑'}
          </button>
          <button type="button" className="ed-act is-danger" aria-label={`删除第 ${label} 题`} onClick={() => ops.remove(item.id)}>
            删除
          </button>
          <MoveMenu itemId={item.id} sectionId={sectionId} canUp={canUp} canDown={canDown} ops={ops} />
        </div>
      </div>
      <div className="ed-item-main">
        <span className="ed-qno" data-testid="item-no">
          {label}
        </span>
        {editing ? (
          <>
            <EditableHtml
              html={item.stemHtml}
              firstNo={firstNo}
              label="题干"
              testId="edit-stem"
              onChange={(html) => ops.change(item.id, { stemHtml: html })}
              onError={ops.error}
            />
            {hasAnswer && (
              <div className="ed-answer-edit">
                <div className="ed-answer-label">答案与解析</div>
                <EditableHtml
                  html={item.answerHtml ?? ''}
                  firstNo={firstNo}
                  label="答案与解析"
                  testId="edit-answer"
                  autoFocus={focusAnswer}
                  onChange={(html) => ops.change(item.id, { answerHtml: html })}
                  onError={ops.error}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div onDoubleClick={() => ops.toggleEdit(item.id)}>
              <MemoQuestionHtml html={item.stemHtml} firstNo={firstNo} />
            </div>
            {showAnswer && hasAnswer && (
              <div className="ed-answer-view">
                <MemoQuestionHtml html={item.answerHtml ?? ''} firstNo={firstNo} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="ed-note">
        <Tag title={item.questionType}>{item.questionType || '未分类'}</Tag>
        <div className="ed-note-src" title={item.sourceLabel}>
          {item.sourceLabel}
        </div>
        <div className="ed-note-row">
        <ScoreChip item={item} label={label} scoreNote={scoreNote} inheritedScore={inheritedScore} ops={ops} />
        {!answered && !(editing && hasAnswer) && (
          <button
            type="button"
            className="ed-note-link is-warn"
            data-testid="add-answer"
            onClick={() => {
              setFocusAnswer(true)
              if (!hasAnswer) ops.change(item.id, { answerHtml: '<p></p>' })
              ops.beginEdit(item.id)
            }}
          >
            添加答案
          </button>
        )}
        {answered && !editing && (
          <button type="button" className="ed-note-link" onClick={() => setShowAnswer((v) => !v)}>
            {showAnswer ? '收起答案' : '查看答案'}
          </button>
        )}
        </div>
      </div>
    </article>
  )
}

export default memo(ItemCard)
