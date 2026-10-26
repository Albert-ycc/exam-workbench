// 试卷库的一行：勾选框、标题（下面是所属分类与标签）、题数分值、最新版本、修改时间、操作。
// 「⋯」菜单里的「移到分类」「标签」点开后在同一位置弹出小框（移到分类的列表、打标签的 TagPicker），不另开窗口。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PaperCategory, Tag, TagRef } from '@shared/classify'
import type { PaperSummary } from '@shared/domain'
import { IconCheck, IconFolder, IconMore } from '../../icons'
import { TagPicker } from '../classify'
import { formatTime, structureLine } from '../library/format'
import { Button, Checkbox, IconButton, Menu, Popover, Tag as MarkTag, cx } from '../ui'
import './papers.css'

// 搜索命中的字用荧光笔标出
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

function secondLine(paper: PaperSummary): string {
  const { sectionCount, questionCount, totalScore, unscoredCount } = paper.structure
  if (questionCount === 0) return ''
  return `${sectionCount} 个大题${unscoredCount > 0 && totalScore != null ? `，${unscoredCount} 题未设分` : ''}`
}

// 行上最多渲染这么多个标签块（再多的只在「+N」里），其中放得下几个由 MetaLine 按行宽量
const RENDER_MAX = 8

// 分类名与标签排成一行：放不下的标签收进「+N」（悬停看全名），不换行，行高不被撑开
function MetaLine({ categoryName, tags }: { categoryName: string | null; tags: TagRef[] }) {
  const lineRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(Math.min(tags.length, RENDER_MAX))
  useLayoutEffect(() => {
    const line = lineRef.current
    if (!line) return
    const measure = (): void => {
      const chips = Array.from(line.querySelectorAll<HTMLElement>('[data-testid="paper-tag"]'))
      for (const chip of chips) {
        chip.style.display = '' // 先全部摆出来量自然宽度
        chip.style.flex = ''
        chip.style.minWidth = ''
      }
      const origin = line.getBoundingClientRect().left
      const room = line.clientWidth
      const reserve = 44 // 「+N」要的位置
      let shown = 0
      for (let i = 0; i < chips.length; i++) {
        const right = chips[i].getBoundingClientRect().right - origin
        if (right <= room - (i === tags.length - 1 ? 0 : reserve)) shown = i + 1
        else break
      }
      if (chips.length > 0 && shown === 0) {
        // 一个都放不下：至少露一个，让它缩短、用省略号结尾，分类名不动
        shown = 1
        chips[0].style.flex = '0 1 auto'
        chips[0].style.minWidth = '0'
      }
      chips.forEach((chip, i) => (chip.style.display = i < shown ? '' : 'none'))
      setFit(shown)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(line)
    return () => observer.disconnect()
  }, [tags])
  const hidden = tags.length - fit
  return (
    <div className="pp-meta" ref={lineRef}>
      {categoryName && (
        <span className="pp-cat-label" data-testid="paper-category" title={`所属分类：${categoryName}`}>
          <IconFolder size={13} />
          <span>{categoryName}</span>
        </span>
      )}
      {tags.slice(0, RENDER_MAX).map((tag) => (
        <span key={tag.id} className="pp-chip" data-testid="paper-tag" title={tag.name}>
          {tag.name}
        </span>
      ))}
      {hidden > 0 && (
        <span className="pp-chip pp-chip--more" data-testid="paper-tag-more" title={tags.slice(fit).map((t) => t.name).join('、')}>
          +{hidden}
        </span>
      )}
    </div>
  )
}

export interface PaperRowProps {
  paper: PaperSummary
  query: string
  selected: boolean
  /** 只在「全部」下传：行上显示所属分类名 */
  categoryName: string | null
  categories: PaperCategory[]
  /** 这一套的全部标签（份数已扣掉等待删除的试卷） */
  tags: Tag[]
  onSelect(next: boolean): void
  onOpen(): void
  onRename(): void
  onDuplicate(): void
  onDelete(): void
  onMove(categoryId: number | null): void
  onToggleTag(tag: TagRef, next: boolean): void
  onCreateTag(name: string): Promise<TagRef>
  onManageTags(): void
  onNewCategory(): void
  /** 打标签的小框打开 / 关上：页面把期间的改动汇总成一条提示，小框开着时点一下不弹一条 */
  onTagsOpen(): void
  onTagsClose(): void
}

export function PaperRow({ paper, query, selected, categoryName, categories, tags, onSelect, onOpen, onRename, onDuplicate, onDelete, onMove, onToggleTag, onCreateTag, onManageTags, onNewCategory, onTagsOpen, onTagsClose }: PaperRowProps) {
  // 「⋯」菜单选中后在原位弹出的小框
  const [panel, setPanel] = useState<'move' | 'tags' | null>(null)
  const opsRef = useRef<HTMLDivElement>(null)
  // 没设过版本时没有可比对的版本，只写「未存为版本」；有版本且草稿改过，用编辑器同一状态的原词
  const dirty = paper.latestVersionNo !== null && paper.draftDirty
  const sub = secondLine(paper)
  const moreLabel = `「${paper.title}」的更多操作`
  const checked = new Set(paper.tags.map((t) => t.id))

  // 小框关掉后焦点回到「⋯」；点在别处关掉时不抢焦点
  const panelRef = useRef(panel)
  panelRef.current = panel
  const closeRef = useRef(onTagsClose)
  closeRef.current = onTagsClose
  // 小框开着时这一行消失了（比如在标签筛选下把筛选用的标签去掉）：汇总提示照样发出去
  useEffect(
    () => () => {
      if (panelRef.current === 'tags') closeRef.current()
    },
    []
  )
  const closePanel = (): void => {
    if (panel === 'tags') onTagsClose()
    setPanel(null)
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body || active.closest('.pp-anchor')) opsRef.current?.querySelector<HTMLElement>('.ui-icon-btn')?.focus({ preventScroll: true })
    })
  }

  return (
    <div className={cx('pp-row pp-grid', selected && 'is-selected')} data-testid="paper-row">
      <div className="pp-check">
        <Checkbox checked={selected} onChange={onSelect} aria-label={`选择「${paper.title}」`} />
      </div>
      <div className="pp-title-cell">
        {/* 键盘走同一行的「打开」按钮；标题按钮只服务鼠标，不再多一个等效的 Tab 停靠点 */}
        {/* 标题最多两行，全名放在 title 里 */}
        <button type="button" className="pp-title" title={paper.title} tabIndex={-1} onClick={onOpen}>
          <Highlight text={paper.title} query={query} />
        </button>
        {(categoryName || paper.tags.length > 0) && <MetaLine categoryName={categoryName} tags={paper.tags} />}
      </div>
      <div className="pp-structure">
        <div className="pp-structure-main">{structureLine(paper)}</div>
        {sub && <div className="pp-sub">{sub}</div>}
      </div>
      <div className="pp-version">
        {paper.latestVersionNo == null ? <span className="pp-muted">未存为版本</span> : <span className="pp-vno">v{paper.latestVersionNo}</span>}
        {dirty && <MarkTag tone="red">有改动未存为版本</MarkTag>}
      </div>
      <div className="pp-time">{formatTime(paper.updatedAt)}</div>
      <div className="pp-ops" ref={opsRef}>
        <Button size="sm" onClick={onOpen}>
          打开
        </Button>
        <Menu
          label={moreLabel}
          align="end"
          trigger={<IconButton label={moreLabel} size="sm" icon={<IconMore size={16} />} />}
          items={[
            { label: '重命名', onSelect: onRename },
            { label: '另存为新试卷', onSelect: onDuplicate },
            'separator',
            { label: '移到分类…', onSelect: () => setPanel('move') },
            {
              label: '标签…',
              onSelect: () => {
                onTagsOpen()
                setPanel('tags')
              }
            },
            'separator',
            { label: '删除', danger: true, onSelect: onDelete }
          ]}
        />
        {/* 菜单项选中后菜单已关闭，小框贴在「⋯」的位置弹出：用一个看不见的锚点承接 */}
        <Popover
          open={panel !== null}
          onOpenChange={(open) => {
            if (!open) closePanel()
          }}
          align="end"
          label={panel === 'tags' ? '打标签' : '移到分类'}
          className={panel === 'move' ? 'pp-pop' : undefined}
          trigger={<span className="pp-anchor" aria-hidden="true" />}
        >
          {({ close }) =>
            panel === 'tags' ? (
              <TagPicker
                tags={tags}
                checked={checked}
                unit="份试卷"
                onToggle={onToggleTag}
                onCreate={onCreateTag}
                onManage={() => {
                  close({ restoreFocus: false })
                  onManageTags()
                }}
              />
            ) : (
              <MovePanel
                categories={categories}
                current={paper.categoryId}
                onPick={(id) => {
                  close()
                  if (id !== paper.categoryId) onMove(id)
                }}
                onNew={() => {
                  close({ restoreFocus: false })
                  onNewCategory()
                }}
              />
            )
          }
        </Popover>
      </div>
    </div>
  )
}

// 移到分类的小框：各分类、「未分类」，当前所在的打勾
export function MovePanel({ categories, current, onPick, onNew }: { categories: PaperCategory[]; current: number | null; onPick(id: number | null): void; onNew(): void }) {
  const option = (id: number | null, name: string): ReactNode => (
    <button key={id ?? 'none'} type="button" className="ui-menu-item pp-pop-item" aria-pressed={current === id} title={name} onClick={() => onPick(id)}>
      <span className="ui-menu-label">{name}</span>
      {current === id && <IconCheck size={16} />}
    </button>
  )
  return (
    <div className="pp-move">
      <div className="ui-menu-heading">移到分类</div>
      {categories.length === 0 ? (
        <div className="pp-move-empty">
          <p>还没有分类</p>
          <Button variant="link" size="sm" onClick={onNew}>
            新建分类
          </Button>
        </div>
      ) : (
        <>
          {/* 分类多了只滚分类这一段，「未分类」钉在下面不用翻到底 */}
          <div className="pp-move-list">{categories.map((c) => option(c.id, c.name))}</div>
          <div className="ui-menu-sep" role="separator" />
          {option(null, '未分类')}
        </>
      )}
    </div>
  )
}
