// 试卷库列表上方的标签条：一行，左边「标签」，中间一排标签，右端依次是「更多（共 N 个）」「清除」「管理标签」。
// 筛选本身（多选取并集、份数、选中态）是共用的 TagFilter；这里只管版面：
//   默认只显示一行，放不下时出现「更多（共 N 个）」展开（展开后最多三行再滚动，再点「收起」）；
//   TagFilter 自己把有题的标签排在前面（题多的在前）、标签多于 12 个时带搜索框；这里收起时把已选中的标签用 CSS 顶到最前、
//   搜索框只在展开后显示，键盘 Tab 到被收起的标签时自动展开。
//   没有任何标签时只写一句话，告诉用户标签从哪里建。
import { useLayoutEffect, useRef, useState } from 'react'
import type { Tag } from '@shared/classify'
import { TagFilter } from '../classify'
import { Button, cx } from '../ui'
import './papers.css'

export interface TagBarProps {
  tags: Tag[]
  counts: ReadonlyMap<number, number>
  selected: readonly number[]
  onChange(next: number[]): void
  onManage(): void
}

// 标签块高 28、行距 6：自然高度超过这个数就是排了两行以上
const ONE_ROW = 34

export function TagBar({ tags, counts, selected, onChange, onManage }: TagBarProps) {
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const chips = root?.querySelector<HTMLElement>('.cf-chips')
    if (!root || !chips) {
      setOverflow(false)
      return
    }
    const measure = (): void => setOverflow(chips.offsetHeight > ONE_ROW)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(chips)
    return () => observer.disconnect()
  }, [tags.length])

  // 收起时回到第一行：展开着滚动过、点选过，收起后不能停在被裁掉的那一行
  useLayoutEffect(() => {
    const wrap = rootRef.current?.querySelector('.cf-chips')?.parentElement
    if (!expanded && wrap) wrap.scrollTop = 0
  }, [expanded, selected, tags.length])

  if (tags.length === 0) {
    return (
      <div className="pp-tagbar pp-tagbar--empty">
        <span className="pp-tag-label">标签</span>
        <span className="pp-tag-note">还没有标签，在试卷的「⋯ › 标签…」里新建</span>
      </div>
    )
  }

  const collapsed = !expanded && overflow
  return (
    <div
      ref={rootRef}
      className={cx('pp-tagbar', expanded && 'is-expanded')}
      onFocus={(event) => {
        // 键盘走到被收起的标签上：展开，免得焦点落在看不见的地方
        if (collapsed && (event.target as HTMLElement).closest('.cf-chip') && (event.target as HTMLElement).matches(':focus-visible')) setExpanded(true)
      }}
    >
      <TagFilter tags={tags} counts={counts} selected={selected} onChange={onChange} onManage={onManage} />
      {(overflow || expanded) && (
        <Button variant="link" size="sm" className="pp-tag-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : `更多（共 ${tags.length} 个）`}
        </Button>
      )}
    </div>
  )
}
