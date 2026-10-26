// 试卷库左侧一列分类：「全部」「各分类」「未分类」，都带份数。写法照试题库左栏的题型按钮（lb-types）。
// 份数由页面按列表算好传入（不含正在等待删除的试卷）；分类的新建、改名、调序、删除都回调出去。
import type { PaperCategory } from '@shared/classify'
import { IconMore } from '../../icons'
import { Button, IconButton, Menu, cx } from '../ui'
import './papers.css'

// 试卷库当前看的范围：全部、未分类，或某个分类的 id
export type PaperView = 'all' | 'none' | number

export const isPaperView = (value: unknown): value is PaperView => value === 'all' || value === 'none' || (typeof value === 'number' && Number.isInteger(value))

export interface CategoryRailProps {
  categories: PaperCategory[] // count 已是页面按列表算的份数
  total: number
  uncategorized: number
  view: PaperView
  onView(next: PaperView): void
  onCreate(): void
  onRename(category: PaperCategory): void
  onMove(category: PaperCategory, delta: -1 | 1): void
  onDelete(category: PaperCategory): void
}

function Row({ name, count, on, onClick, ops }: { name: string; count: number; on: boolean; onClick(): void; ops?: React.ReactNode }) {
  return (
    <li className={cx('pp-cat', on && 'is-on', !on && count === 0 && 'is-zero')} data-testid="category-row">
      <button type="button" className="pp-cat-main" aria-pressed={on} title={name} onClick={onClick}>
        <span>{name}</span>
        <em>{count}</em>
      </button>
      <span className="pp-cat-ops">{ops}</span>
    </li>
  )
}

export function CategoryRail({ categories, total, uncategorized, view, onView, onCreate, onRename, onMove, onDelete }: CategoryRailProps) {
  return (
    <aside className="pp-rail" aria-label="分类">
      <div className="pp-rail-head">
        <h2 className="pp-rail-title">分类</h2>
        <Button variant="link" size="sm" onClick={onCreate}>
          新建分类
        </Button>
      </div>
      <ul className="pp-cats" aria-label="分类">
        <Row name="全部" count={total} on={view === 'all'} onClick={() => onView('all')} />
        {categories.map((category, index) => (
          <Row
            key={category.id}
            name={category.name}
            count={category.count}
            on={view === category.id}
            onClick={() => onView(category.id)}
            ops={
              <Menu
                label={`分类「${category.name}」的更多操作`}
                align="end"
                trigger={<IconButton label={`分类「${category.name}」的更多操作`} size="sm" icon={<IconMore size={16} />} />}
                items={[
                  { label: '重命名', onSelect: () => onRename(category) },
                  { label: '上移', disabled: index === 0, onSelect: () => onMove(category, -1) },
                  { label: '下移', disabled: index === categories.length - 1, onSelect: () => onMove(category, 1) },
                  'separator',
                  { label: '删除', danger: true, onSelect: () => onDelete(category) }
                ]}
              />
            }
          />
        ))}
        <Row name="未分类" count={uncategorized} on={view === 'none'} onClick={() => onView('none')} />
      </ul>
    </aside>
  )
}
