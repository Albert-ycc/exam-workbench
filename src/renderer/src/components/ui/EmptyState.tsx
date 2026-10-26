// 空状态：说清为什么空、下一步做什么。样式见 EmptyState.css。
//
// <EmptyState title="还没有试卷" description="点「新建试卷」，再从试题库里挑题拖进来。" actions={<Button variant="primary">新建试卷</Button>} />
// <EmptyState compact title="没有符合条件的题目" description="当前条件：题型「解答题」、关键词「绝对值」" actions={<Button variant="link">清除筛选</Button>} />
//
// compact 用在侧栏、列表内部（小留白）；bordered 画一圈虚线框，用在整页空态。
import type { ReactNode } from 'react'
import { cx } from './cx'
import './EmptyState.css'

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  /** 一个或多个按钮，放在文字下方 */
  actions?: ReactNode
  icon?: ReactNode
  compact?: boolean
  bordered?: boolean
  className?: string
}

export function EmptyState({ title, description, actions, icon, compact, bordered, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', compact && 'ui-empty--compact', bordered && 'ui-empty--bordered', className)}>
      {icon && <div className="ui-empty-icon">{icon}</div>}
      <p className="ui-empty-title">{title}</p>
      {description && <div className="ui-empty-desc">{description}</div>}
      {actions && <div className="ui-empty-actions">{actions}</div>}
    </div>
  )
}
