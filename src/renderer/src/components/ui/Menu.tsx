// 下拉菜单：题目「⋯」菜单、「加入试卷 ▾」。键盘可操作（WAI-ARIA 菜单按钮模式）。样式见 Menu.css。
//
// <Menu trigger={<IconButton label="更多操作" icon={<IconMore size={16} />} />} align="end" items={[
//   { label: '上移', icon: <IconUp size={16} />, disabled: first, onSelect: moveUp },
//   { label: '下移', onSelect: moveDown },
//   { heading: '移到大题' },
//   { label: '二、填空题', onSelect: () => moveTo(1) },
//   'separator',
//   { label: '删除', danger: true, hint: 'Del', onSelect: askDelete }
// ]} />
// <Menu trigger={<Button iconAfter={<IconChevronDown size={16} />}>加入试卷</Button>} items={…} />
//
// 键盘：触发元素上回车 / 空格 / ↓ / ↑ 打开并聚焦第一项（鼠标点开时聚焦菜单本身，↓ 进入第一项）；
// ↑ ↓ 移动（首尾循环、跳过禁用项），Home / End，回车 / 空格选中，Esc 或 Tab 关闭，焦点回到触发元素。
// onSelect 在菜单关闭、焦点还给触发元素之后才调用，所以 onSelect 里打开确认框，确认框关闭时焦点会回到触发元素。
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import { Popover, type PopoverApi } from './Popover'
import './Menu.css'

export interface MenuItem {
  label: string
  onSelect(): void
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** 右侧的快捷键说明，如 'Del' */
  hint?: string
}
export type MenuEntry = MenuItem | 'separator' | { heading: string }

export interface MenuProps {
  trigger: ReactElement<Record<string, unknown>>
  items: MenuEntry[]
  align?: 'start' | 'end'
  placement?: 'bottom' | 'top'
  /** 菜单的读屏名称 */
  label?: string
  className?: string
}

const isItem = (entry: MenuEntry): entry is MenuItem => typeof entry !== 'string' && 'label' in entry

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'))
}

export function Menu({ trigger, items, align = 'start', placement = 'bottom', label, className }: MenuProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, api: PopoverApi): void => {
    const menu = event.currentTarget
    const list = enabledItems(menu)
    const index = list.indexOf(document.activeElement as HTMLElement)
    const focusAt = (i: number): void => {
      event.preventDefault()
      list[(i + list.length) % list.length]?.focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        return focusAt(index + 1)
      case 'ArrowUp':
        return focusAt(index < 0 ? -1 : index - 1)
      case 'Home':
        return focusAt(0)
      case 'End':
        return focusAt(-1)
      case 'Tab':
        event.preventDefault()
        return api.close()
    }
  }

  return (
    <Popover
      trigger={trigger}
      role="menu"
      label={label}
      align={align}
      placement={placement}
      className={cx('ui-menu', className)}
      onPopoverKeyDown={onKeyDown}
      onOpened={(menu, how) => {
        const first = enabledItems(menu)[0]
        // 键盘打开直接落在第一项；鼠标打开落在菜单本身，避免第一项一直显示焦点环
        if (how === 'keyboard' && first) first.focus({ preventScroll: true })
        else menu.focus({ preventScroll: true })
        return true
      }}
    >
      {({ close }) =>
        items.map((entry, i) => {
          if (entry === 'separator') return <div key={i} className="ui-menu-sep" role="separator" />
          if (!isItem(entry)) {
            return (
              <div key={i} className="ui-menu-heading" role="presentation">
                {entry.heading}
              </div>
            )
          }
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={entry.disabled || undefined}
              className={cx('ui-menu-item', entry.danger && 'ui-menu-item--danger')}
              onClick={() => {
                if (entry.disabled) return
                close()
                entry.onSelect()
              }}
            >
              {entry.icon && <span className="ui-menu-icon">{entry.icon}</span>}
              <span className="ui-menu-label">{entry.label}</span>
              {entry.hint && <span className="ui-menu-hint">{entry.hint}</span>}
            </button>
          )
        })
      }
    </Popover>
  )
}
