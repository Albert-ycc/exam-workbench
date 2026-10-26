// 试题库「标签」筛选：标签一排可切换，带题数。
//
// <TagFilter tags={tags} counts={new Map(facets.tags.map((t) => [t.id, t.count]))} selected={filter.tagIds}
//   onChange={(ids) => patch({ tagIds: ids })} onManage={openTagManager} />
//
// tags 是这一套的全部标签（名称取自它）；counts 没有的标签当 0，变淡但仍可选。名称最长 20 字，超出省略号截断并带悬停提示。
// 有题的标签排在前面（题多的在前，同题数按传入顺序），0 题的排在后面。
// 标签多于 12 个时顶部带搜索框（样式与知识点块相同）；选中的标签不受搜索影响，始终可见。
// 不设内部滚动框（左栏整体滚）；只有 compact（编辑器弹层）里保留一个 120px 的内框。
import { useMemo, useState } from 'react'
import type { Tag } from '@shared/classify'
import { IconSearch } from '../../icons'
import { Button, TextInput, cx } from '../ui'
import { FilterBlock, toggleIn } from './FilterBlock'

export interface TagFilterProps {
  tags: Tag[]
  counts: ReadonlyMap<number, number>
  selected: readonly number[]
  onChange(next: number[]): void
  onManage?(): void
  compact?: boolean
}

// 标签多到需要搜索的起点
const SEARCH_FROM = 12

export function TagFilter({ tags, counts, selected, onChange, onManage, compact }: TagFilterProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const searchable = tags.length > SEARCH_FROM

  const { shown, noMatch } = useMemo(() => {
    const sorted = tags.map((tag, index) => ({ tag, index, n: counts.get(tag.id) ?? 0 })).sort((a, b) => b.n - a.n || a.index - b.index)
    const searching = searchable && needle !== ''
    const list = sorted.map((x) => x.tag).filter((tag) => selected.includes(tag.id) || !searching || tag.name.toLowerCase().includes(needle))
    // 搜不到别的标签时要说一声，选中的标签照常留着
    return { shown: list, noMatch: searching && !list.some((tag) => !selected.includes(tag.id)) }
  }, [tags, counts, selected, needle, searchable])

  return (
    <FilterBlock
      title="标签"
      compact={compact}
      selectedCount={selected.length}
      onClear={() => onChange([])}
      foot={
        onManage && (
          <Button variant="link" size="sm" onClick={onManage}>
            管理标签
          </Button>
        )
      }
    >
      {tags.length === 0 ? (
        <p className="cf-note">还没有标签</p>
      ) : (
        <>
          {searchable && <TextInput className="cf-search" size="sm" value={query} onChange={setQuery} leading={<IconSearch size={14} />} clearable placeholder="搜索标签" aria-label="搜索标签" />}
          {shown.length > 0 && (
            <div className={cx(compact && 'cf-scroll cf-scroll--chips')}>
              <ul className="cf-chips" aria-label="标签">
                {shown.map((tag) => {
                  const on = selected.includes(tag.id)
                  const count = counts.get(tag.id) ?? 0
                  return (
                    <li key={tag.id}>
                      <button type="button" className={cx('cf-chip', on && 'is-on', !on && count === 0 && 'is-zero')} aria-pressed={on} title={tag.name} onClick={() => onChange(toggleIn(selected, tag.id))}>
                        <span>{tag.name}</span>
                        <em>{count}</em>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {noMatch && <p className="cf-note">没有匹配的标签</p>}
        </>
      )}
    </FilterBlock>
  )
}
