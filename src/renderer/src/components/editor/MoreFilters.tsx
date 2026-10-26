// 题库栏的「更多筛选」：按钮 + 弹层（章节、难度、知识点、标签四块，与试题库页同序），以及弹层外的生效条件小条。
// 只筛选：不传 onManage，所以块里没有「管理章节」「管理标签」；打标签、归章节都在试题库页做。
import { useLayoutEffect, useRef, useState } from 'react'
import type { Chapter, Tag } from '@shared/classify'
import type { LibraryFacets } from '@shared/library'
import { IconChevronDown, IconClose } from '../../icons'
import { Button, Popover, cx } from '../ui'
import { ChapterFilter, DifficultyFilter, KnowledgeFilter, TagFilter } from '../classify'
import { classCount, type ClassCondition, type Filters } from './libraryFilters'

type ClassPatch = Partial<Pick<Filters, 'chapterIds' | 'knowledgeIds' | 'difficulties' | 'tagIds'>>

interface MoreProps {
  open: boolean
  onOpenChange(open: boolean): void
  filters: Filters
  patch(next: ClassPatch): void
  clearClass(): void
  chapters: Chapter[]
  tags: Tag[]
  facets: LibraryFacets | null
  /** 选项或题数读取失败的原因 */
  error: string | null
  onRetry(): void
  /** 当前条件下共几道题，弹层底部随选随看 */
  total: number
  /** 题库栏上有任何条件（题型、来源卷、关键词或更多筛选）：难度、知识点列表为空时写「当前条件下没有可选的…」 */
  filtered: boolean
}

// 弹层最高到窗口底边：触发按钮下方的剩余高度。四块叠起来比窗口高，超出的部分在弹层内部滚动
function useBelowHeight(open: boolean, anchor: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(480)
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const rect = anchor.current?.getBoundingClientRect()
      if (rect) setHeight(Math.max(240, Math.floor(window.innerHeight - rect.bottom - 4 - 8 - 2)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, anchor])
  return height
}

export function MoreFilters({ open, onOpenChange, filters, patch, clearClass, chapters, tags, facets, error, onRetry, total, filtered }: MoreProps) {
  const anchor = useRef<HTMLButtonElement>(null)
  const maxHeight = useBelowHeight(open, anchor)
  const active = classCount(filters)
  const chapterCounts = new Map((facets?.chapters ?? []).map((c) => [c.id, c.count]))
  const tagCounts = new Map((facets?.tags ?? []).map((t) => [t.id, t.count]))

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      label="更多筛选"
      className="ed-more-pop"
      // 初始焦点落在弹层本身：焦点落在头上的「清除全部」时，回车一下就清掉了所有条件
      onOpened={(popover) => {
        popover.focus({ preventScroll: true })
        return true
      }}
      trigger={
        <Button
          ref={anchor}
          className={cx('ed-more-btn', active > 0 && 'is-active')}
          aria-label={active > 0 ? `更多筛选，已选 ${active} 项` : '更多筛选'}
          iconAfter={<IconChevronDown size={14} />}
        >
          更多筛选
          {active > 0 && (
            <em className="ed-more-n" data-testid="more-count">
              {active}
            </em>
          )}
        </Button>
      }
    >
      {({ close }) => (
        <div className="ed-more" style={{ maxHeight }} data-testid="more-filters">
          <header className="ed-more-head">
            <h3>更多筛选</h3>
            {active > 0 && (
              <Button variant="link" size="sm" onClick={clearClass}>
                清除全部
              </Button>
            )}
          </header>
          <div className="ed-more-body">
            {error && (
              <p className="ed-more-error" role="alert">
                {error}
                <Button variant="link" size="sm" onClick={onRetry}>
                  重试
                </Button>
              </p>
            )}
            {facets ? (
              <>
                <ChapterFilter compact chapters={chapters} counts={chapterCounts} selected={filters.chapterIds} onChange={(chapterIds) => patch({ chapterIds })} />
                <DifficultyFilter compact filtered={filtered} items={facets.difficulties} selected={filters.difficulties} onChange={(difficulties) => patch({ difficulties })} />
                <KnowledgeFilter compact filtered={filtered} items={facets.knowledge} selected={filters.knowledgeIds} onChange={(knowledgeIds) => patch({ knowledgeIds })} />
                <TagFilter compact tags={tags} counts={tagCounts} selected={filters.tagIds} onChange={(tagIds) => patch({ tagIds })} />
              </>
            ) : (
              !error && <p className="ed-more-wait">读取中…</p>
            )}
          </div>
          <footer className="ed-more-foot">
            <span data-testid="more-total">共 {total} 道题</span>
            <Button size="sm" variant="primary" onClick={() => close()}>
              完成
            </Button>
          </footer>
        </div>
      )}
    </Popover>
  )
}

// 弹层外的生效条件：一项一个小块，点 × 去掉这一项；「清除全部」放在滚动区外，条件再多也看得到
export function ActiveConditions({ items, onRemove, onClear }: { items: ClassCondition[]; onRemove(item: ClassCondition): void; onClear(): void }) {
  if (items.length === 0) return null
  return (
    <div className="ed-lib-active" data-testid="active-conditions">
      <ul className="ed-lib-conds" aria-label="生效的更多筛选">
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="ed-lib-cond" data-kind={item.kind}>
            <span className="ed-lib-cond-kind">{item.kindLabel}</span>
            <span className="ed-lib-cond-name" title={item.label}>
              {item.label}
            </span>
            <button type="button" className="ed-lib-cond-x" aria-label={`清除${item.kindLabel}「${item.label}」`} title="清除这一项" onClick={() => onRemove(item)}>
              <IconClose size={12} />
            </button>
          </li>
        ))}
      </ul>
      {items.length > 1 && (
        <Button variant="link" size="sm" onClick={onClear}>
          清除全部
        </Button>
      )}
    </div>
  )
}
