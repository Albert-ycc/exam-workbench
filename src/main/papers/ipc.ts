// 试卷与版本 IPC
import { ipcMain } from 'electron'
import { PAPERS_IPC, type PaperEdits } from '@shared/papers'
import type { AppContext } from '../context'
import { pickImage } from './images'
import {
  createPaper,
  createVersion,
  deletePaper,
  duplicatePaper,
  getPaper,
  getVersion,
  listPapers,
  listVersions,
  renamePaper,
  restoreVersion,
  saveDraft,
  saveEdits
} from './repo'

export function registerPapersIpc(ctx: AppContext): void {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (event: Electron.IpcMainInvokeEvent, ...args: A): R => {
      if (!ctx.fromMainWindow(event)) throw new Error('拒绝来自非主窗口的请求')
      return fn(...args)
    }
  // 试卷、版本的 id 只认正整数：true、[1]、'1abc' 这类值不能被 Number() 悄悄转成某份试卷
  const toId = (value: unknown, what = '试卷'): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${what} id 不正确`)
    return value
  }

  ipcMain.handle(PAPERS_IPC.list, guard(() => listPapers(ctx.db())))
  ipcMain.handle(PAPERS_IPC.create, guard((title: string) => createPaper(ctx.db(), String(title ?? ''))))
  ipcMain.handle(PAPERS_IPC.get, guard((id: unknown) => getPaper(ctx.db(), toId(id))))
  ipcMain.handle(PAPERS_IPC.rename, guard((id: unknown, title: string) => renamePaper(ctx.db(), toId(id), String(title ?? ''))))
  ipcMain.handle(PAPERS_IPC.remove, guard((id: unknown) => deletePaper(ctx.db(), toId(id))))
  ipcMain.handle(PAPERS_IPC.saveDraft, guard((id: unknown, draft: unknown) => saveDraft(ctx.db(), toId(id), draft)))
  ipcMain.handle(PAPERS_IPC.saveEdits, guard((id: unknown, edits: PaperEdits) => saveEdits(ctx.db(), toId(id), edits ?? {})))
  ipcMain.handle(PAPERS_IPC.pickImage, guard(() => pickImage(ctx)))
  ipcMain.handle(PAPERS_IPC.listVersions, guard((id: unknown) => listVersions(ctx.db(), toId(id))))
  ipcMain.handle(PAPERS_IPC.getVersion, guard((versionId: unknown) => getVersion(ctx.db(), toId(versionId, '版本'))))
  ipcMain.handle(PAPERS_IPC.saveVersion, guard((id: unknown, note: string) => createVersion(ctx.db(), toId(id), 'manual', String(note ?? ''))))
  ipcMain.handle(PAPERS_IPC.restoreVersion, guard((id: unknown, versionId: unknown) => restoreVersion(ctx.db(), toId(id), toId(versionId, '版本'))))
  ipcMain.handle(
    PAPERS_IPC.duplicate,
    guard((id: unknown, options?: { versionId?: unknown; title?: unknown }) =>
      duplicatePaper(ctx.db(), toId(id), {
        versionId: options?.versionId == null ? undefined : toId(options.versionId, '版本'),
        title: typeof options?.title === 'string' ? options.title : undefined
      })
    )
  )

  // 窗口关闭前的同步保存：渲染进程在 beforeunload 里阻塞等待结果，必须保证写回 returnValue
  ipcMain.on(PAPERS_IPC.saveEditsOnExit, (event, id: unknown, edits: PaperEdits) => {
    let ok = false
    try {
      if (ctx.fromMainWindow(event)) {
        saveEdits(ctx.db(), toId(id), edits ?? {})
        ok = true
      }
    } catch (error) {
      console.error('[papers] 关闭前保存失败', error)
    }
    event.returnValue = ok
  })
}
