// 题型标签：方向 C 的 1px 黑框小方格，像答题卡上的格子。样式见 Tag.css。
//
// <Tag>单选题</Tag>                      黑框方格（题型、来源）
// <Tag tone="plain">无答案</Tag>          无框灰字（次要状态）
// <Tag tone="ok">有答案</Tag>             绿框
// <Tag tone="warn">缺答案</Tag>           琥珀框
// <Tag tone="red">已加入</Tag>            红框（红笔只标改动，慎用）
// <Tag tone="blue">当前</Tag>             蓝黑框 + 浅蓝底
// <Tag size="md">…</Tag>                 13px，默认 sm = 12px
import type { ComponentProps } from 'react'
import { cx } from './cx'
import './Tag.css'

export interface TagProps extends ComponentProps<'span'> {
  tone?: 'default' | 'plain' | 'ok' | 'warn' | 'red' | 'blue'
  size?: 'sm' | 'md'
}

export function Tag({ tone = 'default', size = 'sm', className, ...rest }: TagProps) {
  return <span className={cx('ui-tag', `ui-tag--${tone}`, size === 'md' && 'ui-tag--md', className)} {...rest} />
}
