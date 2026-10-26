// 弹窗层栈：背景 inert、Esc 只关最上面一层、Toast 找得到当前弹窗。内部模块，不对外导出。
//
// 约定：弹窗根节点（遮罩）直接挂在 document.body 下。弹窗打开时，body 下其余节点一律 inert
// （不可聚焦、不可点、读屏不可见），带 data-ui-persist 的除外（Toast、从弹窗里弹出的菜单）。

const stack: HTMLElement[] = []
const listeners = new Set<() => void>()
const managed = new Set<Element>() // 由本模块设置过 inert 的节点，关闭时只还原它们

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'])

function syncInert(): void {
  const top = stack.at(-1) ?? null
  for (const el of Array.from(document.body.children)) {
    if (SKIP.has(el.tagName)) continue
    const keep = el === top || el.hasAttribute('data-ui-persist')
    if (top && !keep && !el.hasAttribute('inert')) {
      el.setAttribute('inert', '')
      managed.add(el)
    } else if ((!top || keep) && managed.has(el)) {
      el.removeAttribute('inert')
      managed.delete(el)
    }
  }
  for (const el of Array.from(managed)) if (!el.isConnected) managed.delete(el)
}

function emit(): void {
  for (const fn of listeners) fn()
}

export function pushModal(el: HTMLElement): () => void {
  stack.push(el)
  syncInert()
  emit()
  return () => {
    const i = stack.indexOf(el)
    if (i >= 0) stack.splice(i, 1)
    syncInert()
    emit()
  }
}

export function topModal(): HTMLElement | null {
  return stack.at(-1) ?? null
}

export function subscribeModals(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const TABBABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]'

/** 容器内按 Tab 顺序可停留的元素：排除禁用、隐藏、tabindex=-1，同名单选框只留选中的那个 */
export function tabbables(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('tabindex') === '-1') return false
    if (el.closest('[inert]') && el.closest('[inert]') !== root) return false
    if (el.getClientRects().length === 0) return false
    return getComputedStyle(el).visibility !== 'hidden'
  })
  const checkedNames = new Set(all.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio' && el.checked).map((el) => el.name))
  const seenNames = new Set<string>()
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true
    if (checkedNames.has(el.name)) return el.checked
    if (seenNames.has(el.name)) return false
    seenNames.add(el.name)
    return true
  })
}

/** 给 useSyncExternalStore 用：当前最上层弹窗的根节点（没有弹窗时为 null） */
export function getModalSnapshot(): HTMLElement | null {
  return stack.at(-1) ?? null
}
