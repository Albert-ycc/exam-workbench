// 试卷标题的字数上限，与主进程 papers/repo.ts 的 TITLE_MAX 相同；界面上不能多写出存不下的字
export const TITLE_MAX = 100

// 默认标题加后缀后超限会被服务端从尾部截掉，后缀丢了新旧两份就同名；先把原标题截短再拼
export function withSuffix(title: string, suffix: string): string {
  return Array.from(title).slice(0, TITLE_MAX - Array.from(suffix).length).join('') + suffix
}
