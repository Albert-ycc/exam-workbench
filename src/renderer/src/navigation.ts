// 跨页面跳转：页面里的「去采集」「去试题库看本次入库」「打开这份试卷」等按钮用它，App 统一处理
export type PageKey = 'collect' | 'library' | 'papers' | 'settings'

export interface NavigateDetail {
  page: PageKey
  paperId?: number | null // page 为 papers 时：数字＝打开该试卷，null＝回到试卷列表，不传＝保持当前
}

export const NAVIGATE_EVENT = 'ewb-navigate'

export function navigateTo(page: PageKey, options: { paperId?: number | null } = {}): void {
  window.dispatchEvent(new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, { detail: { page, ...options } }))
}
