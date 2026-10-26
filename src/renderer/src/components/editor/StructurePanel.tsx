// 试卷结构面板（T3）：结构表（题型、题数、题号、每题分、小计，可拖动调大题顺序）、题号方格（标缺答案与未设分，点击定位）、
// 目标满分，另有逐题分值表（Tab 连续填）。窗口够宽时常驻右栏（variant=pane），较窄时从结构条的「试卷结构」按钮弹出（variant=popover）。
// 题数一律按题号数，数字都来自 shared/numbering 的 structureOf。
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraftSection } from '@shared/domain'
import { primaryQuestionType } from '@shared/library'
import { chineseNumeral, formatScore, normalizeScore, numberLabel, type NumberedItem, type PaperStructure, type SectionStructure } from '@shared/numbering'
import { IconChevronDown, IconPlus } from '../../icons'
import { Button, Menu, NumberInput, Segmented, usePersistentState } from '../ui'
import { IconGrip } from './icons'
import { plainText } from './html'
import { SECTION_PRESETS } from './sectionPresets'

export interface StructureActions {
  locateSection(sectionId: string): void
  locateNo(no: number): void
  setSectionScore(sectionId: string, score: number | null): void
  setItemScore(itemId: string, score: number | null): void
  clearItemScores(sectionId: string): void
  reorderSection(sectionId: string, toIndex: number): void
  setTarget(score: number | null): void
  addSection(title?: string): void
  foldAll(): void
  unfoldAll(): void
}

interface Props {
  variant: 'pane' | 'popover'
  sections: DraftSection[]
  structure: PaperStructure
  numbered: ReadonlyMap<string, NumberedItem>
  activeSectionId: string | null
  selectedNos: readonly number[]
  targetScore: number | null
  actions: StructureActions
  onAfterJump?(): void // 弹出层里点了定位就收起，让出试卷
}

type Tab = 'structure' | 'scores'
const isTab = (value: unknown): value is Tab => value === 'structure' || value === 'scores'

// 大题里的题型：全是同一大类写大类，混着写「单选题×8、填空题×2」
export function typesSummary(section: DraftSection): string {
  const counts = new Map<string, number>()
  for (const item of section.items) {
    const type = primaryQuestionType(item.questionType.trim()) || '未分类'
    counts.set(type, (counts.get(type) ?? 0) + Math.max(1, item.numberCount || 1))
  }
  if (counts.size === 0) return '—'
  if (counts.size === 1) return [...counts.keys()][0]
  return [...counts].map(([type, n]) => `${type}×${n}`).join('、')
}

export function targetNote(structure: PaperStructure, target: number | null): { text: string; tone: 'ok' | 'warn' } | null {
  if (target == null) return null
  const total = structure.totalScore ?? 0
  const diff = Math.round((target - total) * 10) / 10
  const unscored = structure.unscoredNos.length
  const tail = unscored > 0 ? `（另有 ${unscored} 题未设分）` : ''
  if (diff === 0) return { text: `✓ 与当前总分一致${tail}`, tone: unscored > 0 ? 'warn' : 'ok' }
  return { text: `${diff > 0 ? `还差 ${formatScore(diff)} 分` : `超出 ${formatScore(-diff)} 分`}${tail}`, tone: 'warn' }
}

function scoreCell(stats: SectionStructure): string {
  if (stats.questionCount === 0) return '—'
  if (stats.unscoredNos.length === stats.questionCount) return '—'
  return formatScore(stats.totalScore)
}

function rangeCell(stats: SectionStructure): string {
  if (stats.firstNo == null || stats.lastNo == null) return '—'
  return stats.firstNo === stats.lastNo ? String(stats.firstNo) : `${stats.firstNo}–${stats.lastNo}`
}

interface RowProps {
  section: DraftSection
  stats: SectionStructure
  variant: Props['variant']
  active: boolean
  actions: StructureActions
  jump(fn: () => void): void
}

function SectionRow({ section, stats, variant, active, actions, jump }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const wide = variant === 'popover'
  const unscored = stats.unscoredNos.length
  return (
    <tr
      ref={setNodeRef}
      className={`${active ? 'is-active' : ''}${isDragging ? ' is-dragging' : ''}`}
      data-testid="struct-row"
      data-section-id={section.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <td className="ed-st-grip">
        <button type="button" className="ed-grip" ref={setActivatorNodeRef} aria-label={`拖动调整${stats.heading}的顺序`} title="拖动调整大题顺序" {...attributes} {...listeners}>
          <IconGrip />
        </button>
      </td>
      {wide && <td className="ed-st-no">{chineseNumeral(stats.index + 1)}</td>}
      <td className="ed-st-name">
        <button type="button" className="ed-st-link" title={`${stats.heading}，点击定位`} onClick={() => jump(() => actions.locateSection(section.id))}>
          {wide ? section.title || '未命名' : `${chineseNumeral(stats.index + 1)}　${section.title || '未命名'}`}
        </button>
      </td>
      {wide && <td className="ed-st-types">{typesSummary(section)}</td>}
      <td className="ed-st-num" data-testid="struct-count">
        {stats.questionCount}
      </td>
      {wide && <td className="ed-st-num">{rangeCell(stats)}</td>}
      {wide && (
        <td className="ed-st-per">
          <NumberInput
            variant="inline"
            min={0.5}
            value={normalizeScore(section.defaultScore)}
            onChange={(v) => actions.setSectionScore(section.id, v)}
            aria-label={`${stats.heading}每小题分值（结构面板）`}
            placeholder="—"
          />
        </td>
      )}
      <td className="ed-st-num" data-testid="struct-score" title={unscored > 0 ? `另有 ${unscored} 题未设分` : undefined}>
        {scoreCell(stats)}
        {unscored > 0 && unscored < stats.questionCount ? '+' : ''}
      </td>
    </tr>
  )
}

function SectionTable({ sections, structure, variant, activeSectionId, actions, jump }: Pick<Props, 'sections' | 'structure' | 'variant' | 'activeSectionId' | 'actions'> & { jump(fn: () => void): void }) {
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const wide = variant === 'popover'
  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const to = sections.findIndex((s) => s.id === over.id)
    if (to >= 0) actions.reorderSection(String(active.id), to)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <table className={`ed-struct-table${wide ? ' is-wide' : ''}`} data-testid="struct-table">
        <colgroup>
          <col style={{ width: 22 }} />
          {wide && <col style={{ width: 44 }} />}
          <col />
          {wide && <col style={{ width: 130 }} />}
          <col style={{ width: 48 }} />
          {wide && <col style={{ width: 58 }} />}
          {wide && <col style={{ width: 76 }} />}
          <col style={{ width: 52 }} />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="拖动" />
            {wide && <th>大题</th>}
            <th>{wide ? '名称' : '大题'}</th>
            {wide && <th>题型</th>}
            <th>题数</th>
            {wide && <th>题号</th>}
            {wide && <th>每题分</th>}
            <th>{wide ? '小计' : '分值'}</th>
          </tr>
        </thead>
        <tbody>
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map((section, index) => (
              <SectionRow key={section.id} section={section} stats={structure.sections[index]} variant={variant} active={activeSectionId === section.id} actions={actions} jump={jump} />
            ))}
          </SortableContext>
          {sections.length === 0 && (
            <tr>
              <td colSpan={wide ? 8 : 4} className="ed-st-empty">
                还没有大题
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={wide ? 4 : 2}>合计</td>
            <td className="ed-st-num" data-testid="struct-total-count">
              {structure.questionCount}
            </td>
            {wide && <td colSpan={2} />}
            <td className="ed-st-num" data-testid="struct-total-score" title={structure.unscoredNos.length > 0 ? `另有 ${structure.unscoredNos.length} 题未设分` : undefined}>
              {structure.totalScore == null ? '—' : formatScore(structure.totalScore)}
            </td>
          </tr>
        </tfoot>
      </table>
    </DndContext>
  )
}

const COLUMNS = 5

function NumberGrid({ structure, selectedNos, actions, jump }: Pick<Props, 'structure' | 'selectedNos' | 'actions'> & { jump(fn: () => void): void }) {
  const missing = new Set(structure.missingAnswerNos)
  const unscored = new Set(structure.unscoredNos)
  const selected = new Set(selectedNos)
  return (
    <>
      <div className="ed-grid-label">
        <span>题号</span>
        <span>点题号跳到该题</span>
      </div>
      <div className="ed-grid" data-testid="number-grid" role="group" aria-label="题号">
        {structure.sections.map((stats) => {
          if (stats.firstNo == null || stats.lastNo == null) return null
          const nos = Array.from({ length: stats.lastNo - stats.firstNo + 1 }, (_, k) => stats.firstNo! + k)
          const rows = Math.ceil(nos.length / COLUMNS)
          // 大题序号格跨满本大题的所有行，号码每 5 个一行，从第 2 列起排
          const at = (k: number): { gridColumn: number; gridRow: number } => ({ gridColumn: (k % COLUMNS) + 2, gridRow: Math.floor(k / COLUMNS) + 1 })
          return (
            <div key={stats.sectionId} className="ed-grid-row" data-section-id={stats.sectionId} style={{ gridTemplateRows: `repeat(${rows}, 30px)` }}>
              <span className="ed-grid-sec" title={stats.heading} style={{ gridColumn: 1, gridRow: `1 / span ${rows}` }}>
                {chineseNumeral(stats.index + 1)}
              </span>
              {nos.map((no, k) => {
                const notes = [missing.has(no) && '缺答案', unscored.has(no) && '未设分'].filter(Boolean).join('、')
                return (
                  <button
                    key={no}
                    type="button"
                    className={`ed-cell${selected.has(no) ? ' is-current' : ''}${missing.has(no) ? ' is-missing' : ''}${unscored.has(no) ? ' is-unscored' : ''}`}
                    style={at(k)}
                    data-no={no}
                    data-testid="grid-cell"
                    aria-label={`第 ${no} 题${notes ? `，${notes}` : ''}`}
                    title={notes ? `第 ${no} 题：${notes}` : `第 ${no} 题`}
                    onClick={() => jump(() => actions.locateNo(no))}
                  >
                    {no}
                  </button>
                )
              })}
              {Array.from({ length: rows * COLUMNS - nos.length }, (_, k) => (
                <span key={`e${k}`} className="ed-cell is-empty" style={at(nos.length + k)} aria-hidden="true" />
              ))}
            </div>
          )
        })}
        {structure.questionCount === 0 && <p className="ed-grid-empty">还没有题目</p>}
      </div>
      {(structure.missingAnswerNos.length > 0 || structure.unscoredNos.length > 0) && (
        <p className="ed-grid-legend" data-testid="grid-legend">
          {structure.missingAnswerNos.length > 0 && (
            <span>
              <i className="ed-key is-missing" />
              缺答案 {structure.missingAnswerNos.length} 题
            </span>
          )}
          {structure.unscoredNos.length > 0 && (
            <span>
              <i className="ed-key is-unscored" />
              未设分 {structure.unscoredNos.length} 题
            </span>
          )}
        </p>
      )}
    </>
  )
}

function ScoreTable({ sections, structure, numbered, actions, jump }: Pick<Props, 'sections' | 'structure' | 'numbered' | 'actions'> & { jump(fn: () => void): void }) {
  if (sections.every((s) => s.items.length === 0)) return <p className="ed-grid-empty">还没有题目</p>
  return (
    <div className="ed-scoretab" data-testid="score-table">
      <p className="ed-scoretab-hint">在分值框里输入后按 Tab 跳到下一题；留空表示跟随大题的每小题分值。</p>
      {sections.map((section, index) => {
        if (section.items.length === 0) return null
        const stats = structure.sections[index]
        const overrides = section.items.filter((i) => i.score != null).length
        return (
          <div key={section.id} className="ed-scoretab-sec">
            <div className="ed-scoretab-head">
              <span className="ed-scoretab-title">
                {stats.heading}
              </span>
              <span className="ed-scoretab-per">
                每小题
                <NumberInput variant="inline" min={0.5} value={normalizeScore(section.defaultScore)} onChange={(v) => actions.setSectionScore(section.id, v)} aria-label={`${stats.heading}每小题分值（分值表）`} placeholder="—" />
              </span>
              {overrides > 0 && (
                <button type="button" className="ed-st-link" onClick={() => actions.clearItemScores(section.id)} title="清除这个大题里每道题的单独分值，都按大题的每小题分值算">
                  全部跟随大题（{overrides} 题单独设分）
                </button>
              )}
            </div>
            {section.items.map((item) => {
              const n = numbered.get(item.id)
              const label = n ? numberLabel(n) : ''
              const inherited = normalizeScore(section.defaultScore)
              return (
                <div key={item.id} className="ed-scoretab-row">
                  <button type="button" className="ed-st-link ed-scoretab-no" tabIndex={-1} onClick={() => n && jump(() => actions.locateNo(n.firstNo))} title="定位到这道题">
                    {label}
                  </button>
                  <span className="ed-scoretab-stem" title={plainText(item.stemHtml, 80, '[公式]')}>
                    {plainText(item.stemHtml, 14, '[公式]')}
                  </span>
                  <NumberInput
                    variant="inline"
                    min={0.5}
                    value={normalizeScore(item.score)}
                    onChange={(v) => actions.setItemScore(item.id, v)}
                    placeholder={inherited != null ? formatScore(inherited) : '—'}
                    aria-label={`第 ${label} 题${item.numberCount > 1 ? '每小题' : ''}分值（分值表）`}
                  />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default function StructurePanel({ variant, sections, structure, numbered, activeSectionId, selectedNos, targetScore, actions, onAfterJump }: Props) {
  const [tab, setTab] = usePersistentState<Tab>('ewb.editor.structTab', 'structure', { validate: isTab })
  const jump = (fn: () => void): void => {
    fn()
    onAfterJump?.()
  }
  const note = targetNote(structure, targetScore)
  return (
    <div className={`ed-struct-panel is-${variant}`} data-testid={variant === 'pane' ? 'struct-pane' : 'struct-popover'}>
      <header className="ed-struct-head">
        <h3>试卷结构</h3>
        <Segmented<Tab>
          size="sm"
          label="结构面板视图"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'structure', label: '结构' },
            { value: 'scores', label: '分值表' }
          ]}
        />
      </header>
      {tab === 'structure' ? (
        <>
          <SectionTable sections={sections} structure={structure} variant={variant} activeSectionId={activeSectionId} actions={actions} jump={jump} />
          <NumberGrid structure={structure} selectedNos={selectedNos} actions={actions} jump={jump} />
        </>
      ) : (
        <ScoreTable sections={sections} structure={structure} numbered={numbered} actions={actions} jump={jump} />
      )}
      <div className="ed-target">
        <label className="ed-target-label">
          目标满分
          <NumberInput variant="inline" min={0.5} value={targetScore} onChange={actions.setTarget} aria-label="目标满分" unit="分" placeholder="未设" />
        </label>
        {note && (
          <span className={`ed-target-note is-${note.tone}`} data-testid="target-note">
            {note.text}
          </span>
        )}
      </div>
      <div className="ed-struct-foot">
        <Menu
          align="start"
          placement="top"
          label="新建大题"
          trigger={
            <Button size="sm" icon={<IconPlus size={16} />} iconAfter={<IconChevronDown size={14} />} data-testid="panel-add-section">
              新建大题
            </Button>
          }
          items={[...SECTION_PRESETS.map((name) => ({ label: name, onSelect: () => actions.addSection(name) })), 'separator' as const, { label: '自定义名称…', onSelect: () => actions.addSection() }]}
        />
        <span className="ed-struct-fold">
          <Button size="sm" variant="ghost" onClick={actions.foldAll}>
            全部折叠
          </Button>
          <Button size="sm" variant="ghost" onClick={actions.unfoldAll}>
            全部展开
          </Button>
        </span>
      </div>
    </div>
  )
}
