// 复选框，整行（含文字）可点。样式见 Form.css。onChange 直接给 boolean。
//
// <Checkbox checked={all} onChange={setAll}>学生版和教师版各下载一份</Checkbox>
// <Checkbox checked={selected === total} indeterminate={selected > 0 && selected < total} onChange={toggleAll}>全选</Checkbox>
// <Checkbox checked disabled>已加入</Checkbox>
//
// 没有可见文字时必须传 aria-label。其余 input 属性（ref、name、data-*）透传给 input。
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { cx } from './cx'
import './Form.css'

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'checked' | 'className' | 'children'> {
  checked: boolean
  onChange(checked: boolean): void
  indeterminate?: boolean
  children?: ReactNode
  className?: string
}

export function Checkbox({ checked, onChange, indeterminate, children, className, disabled, ref, ...rest }: CheckboxProps) {
  const inner = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])
  return (
    <label className={cx('ui-check', disabled && 'is-disabled', className)}>
      <input
        {...rest}
        ref={(node) => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children != null && <span>{children}</span>}
    </label>
  )
}
