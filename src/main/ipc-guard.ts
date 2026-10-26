// IPC 入口共用的校验：来源只认主窗口，id 只认正整数
import type { AppContext } from './context'

// id 只认正整数：true、[1]、'1abc' 这类值不能被 Number() 悄悄转成某份试卷或某道题
export function toId(value: unknown, what = '试卷'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${what} id 不正确`)
  return value
}

export const toIds = (value: unknown, what = '试卷'): number[] => (Array.isArray(value) ? value.map((v) => toId(v, what)) : [])

export const optionalId = (value: unknown, what: string): number | null => (value == null ? null : toId(value, what))

export function makeGuard(ctx: AppContext) {
  return <A extends unknown[], R>(fn: (...args: A) => R) =>
    (event: Electron.IpcMainInvokeEvent, ...args: A): R => {
      if (!ctx.fromMainWindow(event)) throw new Error('拒绝来自非主窗口的请求')
      return fn(...args)
    }
}
