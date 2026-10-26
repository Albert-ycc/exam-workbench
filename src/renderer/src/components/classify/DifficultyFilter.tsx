// 试题库「难度」筛选：按档位一排可切换的小块。档位名、顺序一律取 DIFFICULTY_TIERS，不在这里另写。
//
// <DifficultyFilter items={facets.difficulties} selected={filter.difficulties} onChange={(keys) => patch({ difficulties: keys })} />
//
// items 只含库里出现的档位（选中的以 0 列出）；为空时，filtered（页面有其他筛选条件）写「当前条件下没有可选的难度」，否则写「暂无难度信息」。
// 中性样式：困难不标红、容易不标绿，选中一律蓝黑。
import { DIFFICULTY_TIERS, type DifficultyKey } from '@shared/classify'
import { cx } from '../ui'
import { FilterBlock, toggleIn } from './FilterBlock'

export interface DifficultyFilterProps {
  items: { key: DifficultyKey; count: number }[]
  selected: readonly DifficultyKey[]
  onChange(next: DifficultyKey[]): void
  compact?: boolean
  /** 页面当前有其他筛选条件：列表为空可能只是被筛空了 */
  filtered?: boolean
}

export function DifficultyFilter({ items, selected, onChange, compact, filtered }: DifficultyFilterProps) {
  const shown = DIFFICULTY_TIERS.flatMap((tier) => {
    const item = items.find((i) => i.key === tier.key)
    return item ? [{ tier, count: item.count }] : []
  })
  return (
    <FilterBlock title="难度" compact={compact} selectedCount={selected.length} onClear={() => onChange([])}>
      {shown.length === 0 ? (
        <p className="cf-note">{filtered ? '当前条件下没有可选的难度' : '暂无难度信息'}</p>
      ) : (
        <ul className="cf-chips cf-chips--tiles" aria-label="难度">
          {shown.map(({ tier, count }) => {
            const on = selected.includes(tier.key)
            return (
              <li key={tier.key}>
                <button type="button" className={cx('cf-chip', on && 'is-on', !on && count === 0 && 'is-zero')} aria-pressed={on} onClick={() => onChange(toggleIn(selected, tier.key))}>
                  <span>{tier.label}</span>
                  <em>{count}</em>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </FilterBlock>
  )
}
