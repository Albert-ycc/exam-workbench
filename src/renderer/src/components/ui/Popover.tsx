// 浮层与菜单的共用底座：点触发元素开合、Esc 关闭并把焦点还给触发元素、点外面关闭、贴着触发元素定位并在放不下时翻转。
// 浮层挂在 body 下，带 data-ui-persist，所以在弹窗（背景 inert）里也能操作。样式见 Menu.css。
//
// Popover：任意内容的浮层，焦点移到浮层内第一个可聚焦元素（没有则落在浮层本身）。
//   <Popover trigger={<Button iconAfter={<IconChevronDown size={16} />}>试卷结构</Button>} label="试卷结构" align="start">
//     {({ close }) => <StructurePanel onJump={(no) => { jump(no); close() }} />}
//   </Popover>
//
// trigger 必须是 Button / IconButton 或原生元素（要能接收 ref、onClick、onKeyDown、aria-*）。
// 受控用法：open + onOpenChange。placement 是偏好方向（默认 bottom），放不下自动翻到另一侧；align 决定与触发元素哪一边对齐。
// 菜单见 Menu.tsx。
import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'
import { tabbables } from './layers'
import './Menu.css'

export interface PopoverApi {
  close(options?: { restoreFocus?: boolean }): void
}

export interface PopoverProps {
  trigger: ReactElement<Record<string, unknown>>
  children: ReactNode | ((api: PopoverApi) => ReactNode)
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?(open: boolean): void
  placement?: 'bottom' | 'top'
  align?: 'start' | 'end'
  /** 浮层的读屏名称 */
  label?: string
  /** 浮层最小宽度跟随触发元素 */
  matchTriggerWidth?: boolean
  className?: string
  /** 内部使用：Menu 传 'menu' */
  role?: 'dialog' | 'menu'
  /** 内部使用：浮层内按键处理 */
  onPopoverKeyDown?(event: ReactKeyboardEvent<HTMLDivElement>, api: PopoverApi): void
  /** 内部使用：打开后的初始焦点；返回 true 表示已处理 */
  onOpened?(popover: HTMLElement, how: 'pointer' | 'keyboard'): boolean | void
}

const GAP = 4
const EDGE = 8

export function Popover({ trigger, children, open: controlled, defaultOpen = false, onOpenChange, placement = 'bottom', align = 'start', label, matchTriggerWidth, className, role = 'dialog', onPopoverKeyDown, onOpened }: PopoverProps) {
  const [inner, setInner] = useState(defaultOpen)
  const open = controlled ?? inner
  const triggerRef = useRef<HTMLElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const openedBy = useRef<'pointer' | 'keyboard'>('pointer')
  const popId = useId()
  const [position, setPosition] = useState<{ left: number; top: number; minWidth?: number } | null>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setInner(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange]
  )

  const close = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
    },
    [setOpen]
  )
  const api: PopoverApi = { close }

  // 定位：先在原位渲染（不可见）量尺寸，再算坐标
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = (): void => {
      const anchor = triggerRef.current
      const pop = popRef.current
      if (!anchor || !pop) return
      const a = anchor.getBoundingClientRect()
      const w = pop.offsetWidth
      const h = pop.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const below = a.bottom + GAP
      const above = a.top - GAP - h
      let top = placement === 'bottom' ? below : above
      if (placement === 'bottom' && below + h > vh - EDGE && above >= EDGE) top = above
      if (placement === 'top' && above < EDGE && below + h <= vh - EDGE) top = below
      top = Math.min(Math.max(top, EDGE), Math.max(vh - h - EDGE, EDGE))
      const left = Math.min(Math.max(align === 'start' ? a.left : a.right - w, EDGE), Math.max(vw - w - EDGE, EDGE))
      setPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top, minWidth: matchTriggerWidth ? a.width : undefined }))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, placement, align, matchTriggerWidth])

  // 定位完成后移焦点
  const placed = position != null
  useEffect(() => {
    if (!open || !placed) return
    const pop = popRef.current!
    if (onOpened?.(pop, openedBy.current)) return
    ;(tabbables(pop)[0] ?? pop).focus({ preventScroll: true })
    // 只在打开瞬间处理一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placed])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    // 捕获阶段拦 Esc：浮层在弹窗里时，Esc 只关浮层，不让弹窗跟着关
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, setOpen, close])

  const triggerProps = trigger.props as { onClick?: (event: React.MouseEvent) => void; onKeyDown?: (event: React.KeyboardEvent) => void; ref?: React.Ref<HTMLElement> }
  const clone = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const own = triggerProps.ref
      if (typeof own === 'function') own(node)
      else if (own) (own as { current: HTMLElement | null }).current = node
    },
    'aria-haspopup': role === 'menu' ? 'menu' : 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? popId : undefined,
    onClick: (event: React.MouseEvent) => {
      triggerProps.onClick?.(event)
      if (event.defaultPrevented) return
      // detail === 0：键盘触发的 click（回车 / 空格）
      openedBy.current = event.detail === 0 ? 'keyboard' : 'pointer'
      setOpen(!open)
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      triggerProps.onKeyDown?.(event)
      if (event.defaultPrevented || role !== 'menu' || open) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        openedBy.current = 'keyboard'
        setOpen(true)
      }
    }
  })

  return (
    <>
      {clone}
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            className={cx('ui-popover', className)}
            data-ui-persist=""
            role={role}
            aria-label={label}
            tabIndex={-1}
            style={{ left: position?.left ?? 0, top: position?.top ?? 0, minWidth: position?.minWidth, visibility: position ? 'visible' : 'hidden' }}
            onKeyDown={(event) => onPopoverKeyDown?.(event, api)}
          >
            {typeof children === 'function' ? children(api) : children}
          </div>,
          document.body
        )}
    </>
  )
}
