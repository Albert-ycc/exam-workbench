// 按钮与图标按钮。样式见 Button.css，类名前缀 ui-btn。
//
// <Button>存为版本</Button>                                     默认：黑框白底
// <Button variant="primary" icon={<IconDownload size={16} />}>下载</Button>   主操作：蓝黑底
// <Button variant="danger">确认删除</Button>                      危险：红底（二次确认处使用）
// <Button variant="ghost">取消</Button>                           无边框，悬停才有底
// <Button variant="link">展开</Button>                            行内链接式，蓝黑字
// <Button variant="danger-ghost" size="sm">删除</Button>          行内红字
// <Button dot="有改动未存为版本">存为版本</Button>                  右侧红点角标；传字符串时作为读屏说明
// <Button iconAfter={<IconChevronDown size={16} />}>加入试卷</Button>
// <IconButton label="上移" icon={<IconUp size={16} />} onClick={…} />   label 同时是 aria-label 与悬停提示
//
// type 默认 "button"，放进表单也不会误提交。其余原生 button 属性（disabled、onClick、ref、aria-*）原样透传。
import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import './Button.css'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'link' | 'danger-ghost'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  /** md = 34px（编辑器顶栏、弹窗页脚），sm = 28px（列表行内） */
  size?: 'md' | 'sm'
  icon?: ReactNode
  iconAfter?: ReactNode
  /** 红点角标，表示「有改动」。传字符串时作为读屏说明 */
  dot?: boolean | string
  /** 撑满父容器宽度 */
  block?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, iconAfter, dot, block, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('ui-btn', `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm', block && 'ui-btn--block', className)} {...rest}>
      {icon}
      {children != null && children !== false && <span className="ui-btn-label">{children}</span>}
      {iconAfter}
      {dot && (typeof dot === 'string' ? <span className="ui-btn-dot" role="img" aria-label={dot} /> : <span className="ui-btn-dot" aria-hidden="true" />)}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** 必填：读屏名称与悬停提示 */
  label: string
  icon: ReactNode
  size?: 'md' | 'sm'
  variant?: 'ghost' | 'danger-ghost' | 'default'
  /** 开关式按钮的按下态（aria-pressed） */
  pressed?: boolean
}

export function IconButton({ label, icon, size = 'md', variant = 'ghost', pressed, className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-icon-btn', `ui-icon-btn--${variant}`, size === 'sm' && 'ui-icon-btn--sm', className)}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      {...rest}
    >
      {icon}
    </button>
  )
}
