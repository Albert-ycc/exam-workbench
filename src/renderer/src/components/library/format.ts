import type { PaperSummary } from '@shared/domain'
import { formatScore } from '@shared/numbering'

// 试卷库、设置页里的时间与错误文字整理
const pad = (n: number): string => String(n).padStart(2, '0')

// 2026-10-25T02:20:11.000Z → 2026-10-25 10:20（本地时区）
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ipcRenderer.invoke 的错误带有 "Error invoking remote method 'x': Error: " 前缀，界面只显示原因
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:\w*Error):\s*/, '')
}

// 界面里长标题截断成固定字数
export function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : text
}

// 试卷库一行里的结构摘要：「21 题 · 100 分」（题数按题号计）；没设分值写「未设分」
export function structureLine(paper: PaperSummary): string {
  const { questionCount, totalScore } = paper.structure
  if (questionCount === 0) return '空白试卷'
  return `${questionCount} 题 · ${totalScore == null ? '未设分' : `${formatScore(totalScore)} 分`}`
}
