// 单行输入框。样式见 Form.css。onChange 直接给字符串，不是事件。
//
// <TextInput value={q} onChange={setQ} placeholder="题干关键词" leading={<IconSearch size={16} />} clearable aria-label="题干关键词" />
// <TextInput variant="underline" value={title} onChange={setTitle} aria-label="试卷标题" style={{ font: '700 18px var(--song)', width: 330 }} />
// <TextInput value={name} onChange={setName} invalid={!name.trim()} />
//
// className / style 作用在外框上（用来定宽、定字体）；其余 input 属性（ref、aria-label、onKeyDown、maxLength…）透传给 input。
// variant="underline" 是卷面上直接改字的样子（大题名、试卷标题）：无框，只有一条点线，字体跟随外层。
import { useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { IconClose } from '../../icons'
import { cx } from './cx'
import './Form.css'

export interface TextInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'className' | 'style' | 'size'> {
  value: string
  onChange(value: string): void
  variant?: 'box' | 'underline'
  size?: 'md' | 'sm'
  invalid?: boolean
  /** 输入框左边的图标 */
  leading?: ReactNode
  /** 有内容时右边出现 ×，点一下清空并回到输入框 */
  clearable?: boolean
  className?: string
  style?: CSSProperties
}

export function TextInput({ value, onChange, variant = 'box', size = 'md', invalid, leading, clearable, className, style, disabled, ref, ...rest }: TextInputProps) {
  const inner = useRef<HTMLInputElement | null>(null)
  return (
    <span
      className={cx('ui-input', variant === 'underline' && 'ui-input--underline', size === 'sm' && 'ui-input--sm', invalid && 'is-invalid', disabled && 'is-disabled', className)}
      style={style}
    >
      {leading && <span className="ui-input-leading">{leading}</span>}
      <input
        {...rest}
        ref={(node) => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="text"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {clearable && value && !disabled && (
        <button
          type="button"
          className="ui-input-clear"
          aria-label="清除"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('')
            inner.current?.focus()
          }}
        >
          <IconClose size={14} />
        </button>
      )}
    </span>
  )
}
