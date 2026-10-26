// 右侧停靠的抽屉（版本历史用，S17）。样式见 Overlay.css，类名前缀 ui-drawer。
//
// 与 Modal 的区别：抽屉不盖住主内容，而是作为 flex 横向容器里的一个并排子节点，打开时主内容被挤窄，
// 关闭（不渲染）时主内容恢复。所以必须放在 display:flex 的横向父容器里，与主内容并列：
//   <div className="editor-body">                       // display:flex
//     <main style={{ flex: 1, minWidth: 0 }}>试卷</main>
//     <Drawer open={showHistory} title="版本历史" width={360} onClose={() => setShowHistory(false)}>…</Drawer>
//   </div>
//
// 非模态：背景不 inert、焦点不锁定；打开时焦点移到抽屉，在抽屉里按 Esc 关闭，关闭后焦点回到打开前的元素。
// 主内容的 minWidth 要留够（编辑器线自己定），抽屉本身固定宽度，不参与收缩。
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { IconClose } from '../../icons'
import { IconButton } from './Button'
import { cx } from './cx'
import './Overlay.css'

export interface DrawerProps {
  open?: boolean
  title: string
  onClose(): void
  children?: ReactNode
  footer?: ReactNode
  /** 抽屉宽度（px），默认 360 */
  width?: number
  className?: string
}

export function Drawer({ open = true, ...rest }: DrawerProps) {
  return open ? <DrawerOpen {...rest} /> : null
}

function DrawerOpen({ title, onClose, children, footer, width = 360, className }: Omit<DrawerProps, 'open'>) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus({ preventScroll: true })
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <aside
      ref={ref}
      className={cx('ui-drawer', className)}
      style={{ width }}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) {
          event.stopPropagation()
          onCloseRef.current()
        }
      }}
    >
      <header className="ui-drawer-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="关闭" icon={<IconClose size={16} />} onClick={onClose} />
      </header>
      <div className="ui-drawer-body">{children}</div>
      {footer && <footer className="ui-drawer-foot">{footer}</footer>}
    </aside>
  )
}
