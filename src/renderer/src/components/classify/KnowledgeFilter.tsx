// 试题库「知识点」筛选：组卷网自带的知识点，只读，多选；题多的在前。
//
// <KnowledgeFilter items={facets.knowledge} selected={filter.knowledgeIds} onChange={(ids) => patch({ knowledgeIds: ids })} />
//
// - 搜索框按名称包含过滤（英文不分大小写）。
// - 已选中的排在最前，单独一块不跟着滚动、不受搜索影响（始终可见）；其余按学科分组（库里有两个以上学科时才分，标题取 subjectName），
//   默认与选中的合计列 10 行，剩下的收在「展开全部（共 N 个）」后面，展开后列表最高 320px（compact 220px）内部滚动。
// - 题数为 0 的变淡（选中的以 0 列出时保持选中色）。名称最多两行换行，不用省略号截掉后缀。
import { useMemo, useState } from 'react'
import { subjectName } from '@shared/classify'
import type { KnowledgeCount } from '@shared/library'
import { IconSearch } from '../../icons'
import { Button, TextInput, cx } from '../ui'
import { FilterBlock, FilterRow, toggleIn } from './FilterBlock'

export interface KnowledgeFilterProps {
  /** facets.knowledge：题多的在前 */
  items: KnowledgeCount[]
  selected: readonly number[]
  onChange(next: number[]): void
  compact?: boolean
  /** 页面当前有其他筛选条件：列表为空可能只是被筛空了 */
  filtered?: boolean
}

const LIMIT = 10

export function KnowledgeFilter({ items, selected, onChange, compact, filtered }: KnowledgeFilterProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const needle = query.trim().toLowerCase()

  const view = useMemo(() => {
    const on = new Set(selected)
    const pinned = items.filter((i) => on.has(i.id))
    const rest = items.filter((i) => !on.has(i.id) && (!needle || i.name.toLowerCase().includes(needle)))
    // 选中 3 个就再列 7 个，整体稳定在 10 行
    const listed = expanded ? rest : rest.slice(0, Math.max(0, LIMIT - pinned.length))
    const subjects = [...new Set(items.map((i) => i.subject))]
    const groups = subjects.map((subject) => ({ subject, rows: listed.filter((i) => i.subject === subject) })).filter((g) => g.rows.length > 0)
    return { pinned, groups, total: pinned.length + rest.length, hidden: rest.length - listed.length, grouped: subjects.length >= 2 }
  }, [items, selected, needle, expanded])

  const canFold = expanded && view.total > LIMIT
  return (
    <FilterBlock
      title="知识点"
      compact={compact}
      selectedCount={selected.length}
      onClear={() => onChange([])}
      foot={
        view.hidden > 0 ? (
          <Button variant="link" size="sm" onClick={() => setExpanded(true)}>
            展开全部（共 {view.total} 个）
          </Button>
        ) : canFold ? (
          <Button variant="link" size="sm" onClick={() => setExpanded(false)}>
            收起
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="cf-note">{filtered ? '当前条件下没有可选的知识点' : '暂无知识点信息'}</p>
      ) : (
        <>
          <TextInput className="cf-search" size="sm" value={query} onChange={setQuery} leading={<IconSearch size={14} />} clearable placeholder="搜索知识点" aria-label="搜索知识点" />
          {view.pinned.length > 0 && (
            <ul className="cf-list cf-pinned" aria-label="已选知识点">
              {view.pinned.map((item) => (
                <li key={item.id}>
                  <FilterRow wrap name={item.name} count={item.count} on onClick={() => onChange(toggleIn(selected, item.id))} />
                </li>
              ))}
            </ul>
          )}
          {view.groups.length === 0 ? (
            view.pinned.length === 0 && <p className="cf-note">没有匹配的知识点</p>
          ) : (
            <div className={cx('cf-scroll', expanded && 'cf-scroll--capped')}>
              {view.groups.map((group) => (
                <div key={group.subject} className="cf-group">
                  {view.grouped && <div className="cf-group-name">{subjectName(group.subject)}</div>}
                  <ul className="cf-list" aria-label={view.grouped ? subjectName(group.subject) : '知识点'}>
                    {group.rows.map((item) => (
                      <li key={item.id}>
                        <FilterRow wrap name={item.name} count={item.count} on={false} onClick={() => onChange(toggleIn(selected, item.id))} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </FilterBlock>
  )
}
