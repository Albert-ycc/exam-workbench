// 数字输入（分值用）。样式见 Form.css。
// 值是 number | null，null = 清空（没设）。
//
// 输入规则（手打、粘贴、输入法提交走同一套）：
// - 全角数字、全角小数点（．。）、全角减号先转成半角再判断。
// - 合法：空（回调 null），或 [min, max] 内、是 step 整数倍的数；「12.」「.5」这类半截写法也算合法。
// - 不合法（负数、超出范围、不是步长整数倍、含字母或科学计数法）：保留用户敲的字，输入框变红并在下方给一句短提示，
//   这期间不回调 onChange；失焦时仍不合法就恢复成上一个合法值（value）。
// - 键盘 ↑ / ↓ 加减一个步长，Shift+↑ / ↓ 一次十个步长，结果限制在 [min, max] 内；− + 按钮同理。
//
// <NumberInput value={score} onChange={setScore} min={0.5} aria-label="每小题分值" unit="分" />
// <NumberInput variant="inline" value={score} onChange={setScore} min={0.5} aria-label="每题分值" />   卷面大题头里的小方框
// <NumberInput value={score} onChange={setScore} stepper placeholder="未设" />                          带 − + 按钮
// 默认 min=0、max=999、step=0.5，与 normalizeScore 的取值范围一致；提示语是「请填 min–max 之间、以 step 为单位的分值」，
// 量词不是分值时传 noun。
import { useId, useState, type KeyboardEvent, type Ref } from 'react'
import { IconPlus } from '../../icons'
import { cx } from './cx'
import { IconButton } from './Button'
import './Form.css'

export interface NumberInputProps {
  value: number | null
  onChange(value: number | null): void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  /** 输入框后面的单位文字，如「分」 */
  unit?: string
  /** 提示语里的量词，默认「分值」 */
  noun?: string
  variant?: 'box' | 'inline'
  /** 两侧加 − + 按钮（variant=box 时才有） */
  stepper?: boolean
  disabled?: boolean
  invalid?: boolean
  id?: string
  'aria-label'?: string
  className?: string
  onBlur?(): void
  ref?: Ref<HTMLInputElement>
}

function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** 全角数字、小数点、减号转半角，去掉首尾空白 */
function toHalfWidth(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[－−]/g, '-')
    .trim()
}

export function NumberInput({ value, onChange, min = 0, max = 999, step = 0.5, placeholder = '—', unit, noun = '分值', variant = 'box', stepper, disabled, invalid, id, className, onBlur, ref, ...aria }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const hintId = useId()
  const decimals = decimalsOf(step)
  const snap = (n: number): number => Number((Math.round(Math.min(Math.max(n, min), max) / step) * step).toFixed(decimals))
  const onStep = (n: number): boolean => Math.abs(n / step - Math.round(n / step)) < 1e-9

  const check = (text: string): { ok: true; value: number | null } | { ok: false } => {
    if (text === '') return { ok: true, value: null }
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false }
    const n = Number(text) || 0 // 「-0」按 0
    return Number.isFinite(n) && n >= min && n <= max && onStep(n) ? { ok: true, value: n } : { ok: false }
  }

  const text = draft ?? (value == null ? '' : String(value))
  const bad = draft != null && !composing && !check(draft).ok

  const handle = (raw: string, isComposing: boolean): void => {
    // 输入法组字过程中不动输入框里的字，提交后再按规则处理
    if (isComposing) return setDraft(raw)
    const next = toHalfWidth(raw)
    setDraft(next)
    const result = check(next)
    if (result.ok) onChange(result.value)
  }

  const bump = (direction: 1 | -1, multiplier = 1): void => {
    onChange(snap((value ?? 0) + direction * step * multiplier))
    setDraft(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    bump(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1)
  }

  const field = (
    <span className={cx('ui-input ui-num-field', variant === 'inline' && 'ui-num-field--inline', (invalid || bad) && 'is-invalid', disabled && 'is-disabled')}>
      <input
        ref={ref}
        id={id}
        type="text"
        role="spinbutton"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={aria['aria-label']}
        aria-invalid={invalid || bad || undefined}
        aria-describedby={bad ? hintId : undefined}
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => {
          setComposing(false)
          handle(event.currentTarget.value, false)
        }}
        onChange={(event) => handle(event.target.value, (event.nativeEvent as InputEvent).isComposing)}
        onBlur={() => {
          // 失焦时仍不合法：丢掉草稿，显示回上一个合法值
          setDraft(null)
          setComposing(false)
          onBlur?.()
        }}
      />
    </span>
  )

  return (
    <span className={cx('ui-num', variant === 'inline' && 'ui-num--inline', className)}>
      {stepper && variant === 'box' && (
        <IconButton variant="default" label="减少" tabIndex={-1} disabled={disabled || (value ?? 0) <= min} icon={<span className="ui-num-minus" />} onClick={() => bump(-1)} />
      )}
      {field}
      {stepper && variant === 'box' && <IconButton variant="default" label="增加" tabIndex={-1} disabled={disabled || (value ?? 0) >= max} icon={<IconPlus size={14} />} onClick={() => bump(1)} />}
      {unit && <span className="ui-num-unit">{unit}</span>}
      {bad && (
        <span id={hintId} role="alert" className="ui-num-hint">
          请填 {min}–{max} 之间、以 {step} 为单位的{noun}
        </span>
      )}
    </span>
  )
}
