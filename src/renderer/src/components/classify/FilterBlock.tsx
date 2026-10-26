// 筛选块的共用外壳与选项行（内部模块，不对外导出）。
// 外壳：标题与试题库左栏的 lb-label 同款（宋体粗体 + 黑色下线），本块有选中项时右侧出现「清除」。
// 选项行：照 lb-types 的写法（30px 高、发丝线分隔、选中蓝黑底白字、题数用宋体 <em>），多了「当前条件下为 0 则变淡」。
import { useId, type ReactNode } from 'react'
import { Button, cx } from '../ui'
import './classify.css'

export function FilterBlock({
  title,
  compact,
  selectedCount,
  onClear,
  foot,
  className,
  children
}: {
  title: string
  compact?: boolean
  selectedCount: number
  onClear(): void
  /** 底部一行：展开全部、管理章节等 */
  foot?: ReactNode
  className?: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section className={cx('cf-block', compact && 'cf-block--compact', className)} aria-labelledby={titleId}>
      <div className="cf-head">
        <h3 id={titleId} className="cf-title">
          {title}
        </h3>
        {selectedCount > 0 && (
          <Button variant="link" size="sm" className="cf-clear" aria-label={`清除${title}的选择`} onClick={onClear}>
            清除
          </Button>
        )}
      </div>
      {children}
      {foot && <div className="cf-foot">{foot}</div>}
    </section>
  )
}

export function FilterRow({
  name,
  count,
  on,
  lead,
  sub,
  wrap,
  onClick
}: {
  name: string
  count: number
  on: boolean
  /** 名称左边的东西（章的展开箭头） */
  lead?: ReactNode
  /** 节：整行缩进 */
  sub?: boolean
  /** 名称最多两行换行显示，不用省略号截掉后缀（知识点用） */
  wrap?: boolean
  onClick(): void
}) {
  return (
    <div className={cx('cf-row', on && 'is-on', !on && count === 0 && 'is-zero', sub && 'cf-row--sub')}>
      {lead}
      <button type="button" className={cx('cf-item', wrap && 'cf-item--wrap')} aria-pressed={on} title={name} onClick={onClick}>
        <span>{name}</span>
        <em>{count}</em>
      </button>
    </div>
  )
}

export const toggleIn = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
