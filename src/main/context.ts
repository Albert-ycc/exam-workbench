// 各功能模块注册 IPC 时拿到的运行环境
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { CollectBrowser } from './browser'

export interface AppContext {
  db(): DatabaseSync
  dataDir(): string
  mainWindow(): BrowserWindow | null
  collectBrowser(): CollectBrowser | null
  // IPC 请求是否来自主窗口；所有 handler 先用它校验
  fromMainWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean
}

export function nowIso(): string {
  return new Date().toISOString()
}
