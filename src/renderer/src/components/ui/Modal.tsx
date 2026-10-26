// 弹窗与确认框。样式见 Overlay.css，类名前缀 ui-modal。
//
// 行为（S4）：打开后焦点进入弹窗并锁在里面（Tab / Shift+Tab 循环），背景整体 inert，Esc 关闭最上面一层，
// 关闭后焦点回到打开前的元素。弹窗叠弹窗时，只有最上层响应 Esc 和键盘，下层同样 inert。
//
// 条件渲染或 open 属性都行：
//   {show && <Modal title="重命名" onClose={() => setShow(false)} footer={<Button variant="primary">保存</Button>}>…</Modal>}
//   <Modal open={show} title="版本预览" size="wide" flush onClose={…}>…</Modal>
//
// 忙碌时锁住：<Modal locked={busy} …>      生成中 Esc、点遮罩、右上角 × 都不生效
// 指定初始焦点：给元素加 data-autofocus，或传 initialFocusRef；都没有时依次落在正文第一个可聚焦元素、页脚第一个按钮、关闭按钮
// 确认框：
//   <ConfirmDialog title="删除试卷" danger confirmLabel="删除" onConfirm={doDelete} onClose={close}>删除后所有版本一并删除。</ConfirmDialog>
//   danger 时默认焦点在「取消」，回车不会误删；非 danger 时默认焦点在确认按钮。
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../../icons'
import { Button, IconButton } from './Button'
import { cx } from './cx'
import { pushModal, tabbables, topModal } from './layers'
import './Overlay.css'

export interface ModalProps {
  /** 默认 true；也可以不传，用条件渲染 */
  open?: boolean
  title: string
  onClose(): void
  children?: ReactNode
  footer?: ReactNode
  /** sm 400 / md 480（默认）/ lg 640 / wide 占满大部分窗口，用于整卷预览 */
  size?: 'sm' | 'md' | 'lg' | 'wide'
  /** 覆盖 size 的宽度（px） */
  width?: number
  /** 正文不留内边距（预览类内容自己铺满） */
  flush?: boolean
  /** 忙碌中：Esc、点遮罩、× 都不关 */
  locked?: boolean
  hideClose?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  describedBy?: string
  className?: string
}

export function Modal({ open = true, ...rest }: ModalProps) {
  return open ? <ModalOpen {...rest} /> : null
}

function ModalOpen({ title, onClose, children, footer, size = 'md', width, flush, locked, hideClose, initialFocusRef, describedBy, className }: Omit<ModalProps, 'open'>) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  const lockedRef = useRef(locked)
  onCloseRef.current = onClose
  lockedRef.current = locked

  // 进栈、移焦点；卸载时出栈并把焦点还给打开前的元素
  useLayoutEffect(() => {
    const backdrop = backdropRef.current!
    const dialog = dialogRef.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const pop = pushModal(backdrop)

    const preferred = initialFocusRef?.current ?? dialog.querySelector<HTMLElement>('[data-autofocus]')
    const body = dialog.querySelector<HTMLElement>('.ui-modal-body')
    const foot = dialog.querySelector<HTMLElement>('.ui-modal-foot')
    const target = preferred ?? (body && tabbables(body)[0]) ?? (foot && tabbables(foot)[0]) ?? tabbables(dialog)[0] ?? dialog
    target.focus({ preventScroll: true })

    return () => {
      pop()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const backdrop = backdropRef.current!
    const dialog = dialogRef.current!
    const isTop = (): boolean => topModal() === backdrop

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTop() || event.defaultPrevented || event.isComposing) return
      if (event.key === 'Escape') {
        if (!lockedRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = tabbables(dialog)
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    // 焦点被脚本或鼠标带到弹窗外（菜单等 data-ui-persist 的浮层除外）时拉回来
    const onFocusIn = (event: FocusEvent): void => {
      if (!isTop()) return
      const target = event.target
      if (!(target instanceof Element) || dialog.contains(target) || target.closest('[data-ui-persist]')) return
      ;(tabbables(dialog)[0] ?? dialog).focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  // 在遮罩上按下并在遮罩上抬起才算「点遮罩」，避免选文字时拖出弹窗误关
  const downOnBackdrop = useRef(false)

  return createPortal(
    <div
      ref={backdropRef}
      className="ui-backdrop"
      onMouseDown={(event) => {
        downOnBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (downOnBackdrop.current && event.target === event.currentTarget && !locked) onClose()
        downOnBackdrop.current = false
      }}
    >
      <div
        ref={dialogRef}
        className={cx('ui-modal', `ui-modal--${size}`, className)}
        style={width ? { width, maxWidth: 'calc(100vw - 48px)' } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <header className="ui-modal-head">
          <h2 id={titleId}>{title}</h2>
          {!hideClose && <IconButton label="关闭" icon={<IconClose size={16} />} disabled={locked} onClick={onClose} />}
        </header>
        <div className={cx('ui-modal-body', flush && 'ui-modal-body--flush')}>{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  )
}

export interface ConfirmDialogProps {
  open?: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作：确认按钮变红，默认焦点落在「取消」 */
  danger?: boolean
  /** 执行中：确认按钮禁用，弹窗锁住 */
  busy?: boolean
  size?: ModalProps['size']
  onConfirm(): void
  onClose(): void
}

export function ConfirmDialog({ open, title, children, confirmLabel = '确定', cancelLabel = '取消', danger, busy, size = 'sm', onConfirm, onClose }: ConfirmDialogProps) {
  const bodyId = useId()
  return (
    <Modal
      open={open}
      title={title}
      size={size}
      locked={busy}
      describedBy={bodyId}
      onClose={onClose}
      footer={
        <>
          <Button data-autofocus={danger ? '' : undefined} disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button data-autofocus={danger ? undefined : ''} variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div id={bodyId} className="ui-confirm-body">
        {children}
      </div>
    </Modal>
  )
}
