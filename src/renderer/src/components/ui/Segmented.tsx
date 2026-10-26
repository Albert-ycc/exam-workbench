// 分段单选（下载弹窗的「答案位置」「文件格式」等）。样式见 Form.css。
// 底层是原生单选框：方向键切换、Tab 只停在选中项、读屏读作 radiogroup，这些都是浏览器自带的。
//
// <Segmented label="文件格式" value={format} onChange={setFormat}
//   options={[{ value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'DOCX', disabled: true, title: '暂不可用' }]} />
//
// label 是这一组的读屏名称（必填）。每个选项是一个 <label>，里面包着 radio，label 文字就是选项名称。
// disabled 作用于整组；选项的 disabled 作用于单项。
import { useId } from 'react'
import { cx } from './cx'
import './Form.css'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

export interface SegmentedProps<T extends string | number> {
  label: string
  value: T
  onChange(value: T): void
  options: SegmentedOption<T>[]
  disabled?: boolean
  size?: 'md' | 'sm'
  className?: string
}

export function Segmented<T extends string | number>({ label, value, onChange, options, disabled, size = 'md', className }: SegmentedProps<T>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cx('ui-seg', size === 'sm' && 'ui-seg--sm', className)}>
      {options.map((option) => (
        <label key={String(option.value)} className="ui-seg-item" title={option.title} aria-disabled={disabled || option.disabled || undefined}>
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            disabled={disabled || option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
