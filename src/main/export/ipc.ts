// 下载 IPC：把渲染器接到下载流程上，并处理选择文件夹、在文件夹中显示这类需要 Electron 的动作。
import { app, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EXPORT_IPC } from '@shared/export'
import type { AppContext } from '../context'
import { makeGuard, toId } from '../ipc-guard'
import { buildDocx, collectMeasureRequests } from './docx'
import { prepareWordImages, upscaleSmallImagesForPrint } from './images'
import { measureTexts } from './measure'
import { renderPdf, renderPdfByCss } from './pdf'
import { renderCardHtml } from './render-card-html'
import { renderHtml } from './render-html'
import { createExportService } from './service'
import { isDirectory } from './settings'

export function registerExportIpc(ctx: AppContext): void {
  const service = createExportService({
    db: () => ctx.db(),
    dataDir: () => ctx.dataDir(),
    settingsFile: () => join(app.getPath('userData'), 'export-settings.json'),
    defaultDirectory: () => app.getPath('downloads'),
    renderers: {
      pdf: async (doc) => {
        await upscaleSmallImagesForPrint(doc, ctx.dataDir())
        return renderPdf(renderHtml(doc))
      },
      docx: async (doc) => {
        const images = await prepareWordImages(doc, ctx.dataDir())
        // 选项排几列、数据表列宽要按实际字体测宽：先空跑一遍列出要量的文字，在隐藏窗口里量好，再正式生成
        const measure = await measureTexts(collectMeasureRequests(doc, images))
        return buildDocx(doc, images, measure)
      },
      card: async (doc) => renderPdfByCss(renderCardHtml(doc))
    }
  })

  const guard = makeGuard(ctx)
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, guard(fn))
  }

  handle(EXPORT_IPC.getDefaults, () => service.getDefaults())
  handle(EXPORT_IPC.chooseDirectory, async (current: string) => {
    const options = {
      title: '选择保存位置',
      defaultPath: typeof current === 'string' && isDirectory(current) ? current : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const win = ctx.mainWindow()
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  })
  handle(EXPORT_IPC.setDefaultDirectory, (directory: string) => service.setDefaultDirectory(directory))
  handle(EXPORT_IPC.previewFileName, (paperId: number, options: unknown, kind: unknown, directory?: string) => service.previewFileName(toId(paperId), options, kind, directory))
  handle(EXPORT_IPC.checkExport, (paperId: number, options: unknown, kind: unknown) => service.checkExport(toId(paperId), options, kind))
  handle(EXPORT_IPC.exportPaper, (request: Parameters<typeof service.exportPaper>[0]) => service.exportPaper({ ...request, paperId: toId(request?.paperId) }))
  handle(EXPORT_IPC.reexport, (exportId: number) => service.reexport(toId(exportId, '下载记录')))
  handle(EXPORT_IPC.showInFolder, (filePath: string) => {
    if (typeof filePath !== 'string' || !service.isRecordedPath(filePath)) throw new Error('只能打开下载记录里的文件')
    if (!existsSync(filePath)) throw new Error('文件已被移动或删除')
    shell.showItemInFolder(filePath)
  })
}
