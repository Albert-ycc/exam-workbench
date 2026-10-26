// 界面各处共用的文字整理：时间、文件名、错误原因、截断。页面与组件从 '../ui' 引，不各自再写一份
const pad = (n: number): string => String(n).padStart(2, '0')

// 2026-10-25T02:20:11.000Z → 2026-10-25 10:20（本地时区）；不是时间就原样返回
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 10:20:11（本地时区）；不是时间就返回空串
export function formatClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 路径可能来自 Windows，也可能来自 macOS，两种分隔符都要认
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

// 长标题截断成固定字数（按码点计）
export function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : text
}

// ipcRenderer.invoke 的错误带有 "Error invoking remote method 'x': Error: " 前缀，界面只显示原因
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:\w*Error):\s*/, '')
}
