// 下拉选择。底层是原生 <select>：键盘、读屏、弹出的选项列表都用系统自带的。样式见 Form.css。
// 长文字在框内截断成省略号，不撑宽外框；外框默认撑满父容器宽度（在 grid / flex 里给父级 minmax(0,1fr) 或 min-width:0）。
//
// <Select value={sourceId} onChange={setSourceId} aria-label="来源卷"
//   options={[{ value: 0, label: '全部来源卷' }, { value: 12, label: '山东德州市庆云县东郎务中学2026-2027学年七年级第一学期10月学情自测数学试题' }]} />
// <Select value={type} onChange={setType} placeholder="选择题型" options={…} />      value 不在 options 里时显示 placeholder
//
// value 可以是 string 或 number，onChange 给回 options 里原样的值。className / style 作用在外框上。
import type { CSSProperties } from 'react'
import { IconChevronDown } from '../../icons'
import { cx } from './cx'
import './Form.css'

export interface SelectOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T extends string | number> {
  value: T
  onChange(value: T): void
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  size?: 'md' | 'sm'
  id?: string
  'aria-label'?: string
  className?: string
  style?: CSSProperties
}

export function Select<T extends string | number>({ value, onChange, options, placeholder, disabled, invalid, size = 'md', id, className, style, ...aria }: SelectProps<T>) {
  const index = options.findIndex((option) => option.value === value)
  return (
    <span className={cx('ui-select', size === 'sm' && 'ui-select--sm', invalid && 'is-invalid', className)} style={style}>
      <select
        id={id}
        value={index >= 0 ? String(index) : ''}
        disabled={disabled}
        title={index >= 0 ? options[index].label : undefined}
        aria-invalid={invalid || undefined}
        aria-label={aria['aria-label']}
        onChange={(event) => {
          const next = options[Number(event.target.value)]
          if (next) onChange(next.value)
        }}
      >
        {index < 0 && (
          <option value="" disabled hidden>
            {placeholder ?? ''}
          </option>
        )}
        {options.map((option, i) => (
          <option key={i} value={String(i)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={16} />
    </span>
  )
}
