// 编辑器中栏：卷面。白纸、宋体，大题序号、题号、分值说明一律来自 shared/numbering。
import { useMemo, type Ref } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { DraftSection } from '@shared/domain'
import {
  itemScoreNote,
  normalizeScore,
  numberLabel,
  paperTotalNote,
  sectionHeading,
  sectionScoreNote,
  type NumberedItem,
  type PaperStructure,
  type SectionStructure
} from '@shared/numbering'
import { IconChevronDown, IconDown, IconPlus, IconTrash, IconUp } from '../../icons'
import { IconButton, Menu, NumberInput, RedCaret, RedPen } from '../ui'
import type { DropMark } from './draftOps'
import { IconChevronRight } from './icons'
import ItemCard, { type ItemOps } from './ItemCard'
import { SECTION_PRESETS } from './sectionPresets'

export interface SectionOps {
  rename(sectionId: string, title: string): void
  setScore(sectionId: string, score: number | null): void
  move(sectionId: string, delta: -1 | 1): void
  remove(sectionId: string): void
  toggleFold(sectionId: string): void
}

interface Props {
  title: string
  sections: DraftSection[]
  structure: PaperStructure
  numbered: ReadonlyMap<string, NumberedItem>
  mark: DropMark | null
  dropHint: string // 「插入为第 4 题」
  draggingItemId: string | null
  selectedId: string | null
  editingId: string | null
  collapsed: ReadonlySet<string>
  flashIds: ReadonlySet<string>
  itemOps: ItemOps
  sectionOps: SectionOps
  focusSectionId: string | null // 刚新建的大题，名称框自动获得焦点
  scrollRef: Ref<HTMLDivElement>
  onScroll(): void
  onAddSection(title?: string): void
}

function DropLine({ hint }: { hint: string }) {
  return (
    <div className="ed-drop" aria-hidden="true">
      <RedCaret className="ed-drop-caret" />
      <span className="ed-drop-line" />
      <RedPen className="ed-drop-hint">{hint}</RedPen>
    </div>
  )
}

interface SectionBlockProps {
  section: DraftSection
  stats: SectionStructure
  index: number
  count: number
  numbered: ReadonlyMap<string, NumberedItem>
  flatIds: readonly string[]
  mark: DropMark | null
  dropHint: string
  draggingItemId: string | null
  selectedId: string | null
  editingId: string | null
  folded: boolean
  flashIds: ReadonlySet<string>
  flashSelf: boolean
  itemOps: ItemOps
  sectionOps: SectionOps
  autoFocus: boolean
}

function SectionBlock({
  section,
  stats,
  index,
  count,
  numbered,
  flatIds,
  mark,
  dropHint,
  draggingItemId,
  selectedId,
  editingId,
  folded,
  flashIds,
  flashSelf,
  itemOps,
  sectionOps,
  autoFocus
}: SectionBlockProps) {
  const { setNodeRef } = useDroppable({ id: `sec:${section.id}`, data: { kind: 'section', sectionId: section.id } })
  const marked = mark?.sectionId === section.id
  const prefix = sectionHeading(index, '')
  const inherited = normalizeScore(section.defaultScore)
  const note = sectionScoreNote(stats)

  return (
    <section
      ref={setNodeRef}
      className={`ed-sec${marked ? ' is-target' : ''}${flashSelf ? ' is-flash' : ''}`}
      data-testid="section"
      data-section-id={section.id}
    >
      <header className="ed-sec-head">
        <button
          type="button"
          className={`ed-fold${folded ? '' : ' is-open'}`}
          aria-label={`${folded ? '展开' : '折叠'}${prefix}${section.title}`}
          aria-expanded={!folded}
          title={folded ? '展开本大题' : '折叠本大题'}
          onClick={() => sectionOps.toggleFold(section.id)}
        >
          <IconChevronRight />
        </button>
        <span className="ed-sec-prefix" data-testid="section-prefix">
          {prefix}
        </span>
        <textarea
          className="ed-sec-name"
          data-testid="section-name"
          aria-label={`${prefix}大题名称`}
          rows={1}
          value={section.title}
          placeholder="大题名称"
          autoFocus={autoFocus}
          onFocus={(e) => autoFocus && e.target.select()}
          onChange={(e) => sectionOps.rename(section.id, e.target.value.replace(/[\r\n]+/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
        <Menu
          align="start"
          label="大题名称预设"
          trigger={<IconButton size="sm" label="选用预设名称" icon={<IconChevronDown size={14} />} />}
          items={SECTION_PRESETS.map((name) => ({ label: name, onSelect: () => sectionOps.rename(section.id, name) }))}
        />
        {note && (
          <span className="ed-sec-note" data-testid="section-note">
            {note}
          </span>
        )}
        <div className="ed-sec-ops">
          <span className="ed-sec-score">
            每小题
            <NumberInput variant="inline" min={0.5} value={inherited} onChange={(v) => sectionOps.setScore(section.id, v)} aria-label={`${prefix}${section.title}每小题分值`} unit="分" placeholder="—" />
          </span>
          <IconButton size="sm" label="大题上移" title="上移" icon={<IconUp size={16} />} disabled={index === 0} onClick={() => sectionOps.move(section.id, -1)} />
          <IconButton size="sm" label="大题下移" title="下移" icon={<IconDown size={16} />} disabled={index === count - 1} onClick={() => sectionOps.move(section.id, 1)} />
          <IconButton size="sm" label="删除大题" title="删除大题" icon={<IconTrash size={16} />} onClick={() => sectionOps.remove(section.id)} />
        </div>
      </header>
      {folded ? (
        <button type="button" className="ed-sec-folded" onClick={() => sectionOps.toggleFold(section.id)}>
          已折叠，共 {stats.questionCount} 题，点击展开
        </button>
      ) : (
        <div className="ed-sec-items">
          {section.items.map((item) => {
            const n = numbered.get(item.id)
            const flat = flatIds.indexOf(item.id)
            return (
              <div key={item.id}>
                {marked && mark?.beforeItemId === item.id && <DropLine hint={dropHint} />}
                <ItemCard
                  item={item}
                  sectionId={section.id}
                  label={n ? numberLabel(n) : ''}
                  firstNo={n?.firstNo ?? 1}
                  scoreNote={itemScoreNote(item, section)}
                  inheritedScore={inherited}
                  selected={selectedId === item.id}
                  editing={editingId === item.id}
                  dragging={draggingItemId === item.id}
                  flash={flashIds.has(item.id)}
                  canUp={flat > 0}
                  canDown={flat >= 0 && flat < flatIds.length - 1}
                  ops={itemOps}
                />
              </div>
            )
          })}
          {section.items.length === 0 && <p className="ed-sec-empty">把题目拖到这里，或在左侧点题目上的「加入试卷」</p>}
          {marked && mark?.beforeItemId == null && <DropLine hint={dropHint} />}
        </div>
      )}
    </section>
  )
}

function NewSectionZone({ empty, active }: { empty: boolean; active: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'new-section', data: { kind: 'new-section' } })
  return (
    <div ref={setNodeRef} className={`ed-new-zone${empty ? ' is-big' : ''}${active ? ' is-active' : ''}`} data-testid="new-section-zone">
      {empty ? '从左侧试题库把题目拖到这里，或点题目上的「加入试卷」，开始组卷' : '拖到这里新建大题'}
    </div>
  )
}

export default function PaperPane({
  title,
  sections,
  structure,
  numbered,
  mark,
  dropHint,
  draggingItemId,
  selectedId,
  editingId,
  collapsed,
  flashIds,
  itemOps,
  sectionOps,
  focusSectionId,
  scrollRef,
  onScroll,
  onAddSection
}: Props) {
  const flatIds = useMemo(() => sections.flatMap((s) => s.items.map((i) => i.id)), [sections])
  const total = paperTotalNote(structure)
  return (
    <div className="ed-desk" data-paper-pane ref={scrollRef} onScroll={onScroll}>
      <div className="ed-sheet">
        <h2 className="ed-sheet-title" data-testid="sheet-title">
          {title}
        </h2>
        {total && (
          <p className="ed-sheet-sub" data-testid="sheet-total">
            {total}
          </p>
        )}
        {sections.map((section, index) => (
          <SectionBlock
            key={section.id}
            section={section}
            stats={structure.sections[index]}
            index={index}
            count={sections.length}
            numbered={numbered}
            flatIds={flatIds}
            mark={mark}
            dropHint={dropHint}
            draggingItemId={draggingItemId}
            selectedId={selectedId}
            editingId={editingId}
            folded={collapsed.has(section.id)}
            flashIds={flashIds}
            flashSelf={flashIds.has(section.id)}
            itemOps={itemOps}
            sectionOps={sectionOps}
            autoFocus={section.id === focusSectionId}
          />
        ))}
        <NewSectionZone empty={sections.length === 0} active={mark != null && mark.sectionId === null} />
        <div className="ed-sheet-foot">
          <Menu
            align="start"
            placement="top"
            label="新建大题"
            trigger={
              <button type="button" className="ed-add-section" data-testid="add-section" aria-label="新建大题">
                <IconPlus size={16} />
                新建大题
                <IconChevronDown size={14} />
              </button>
            }
            items={[
              ...SECTION_PRESETS.map((name) => ({ label: name, onSelect: () => onAddSection(name) })),
              'separator' as const,
              { label: '自定义名称…', onSelect: () => onAddSection() }
            ]}
          />
        </div>
      </div>
    </div>
  )
}
