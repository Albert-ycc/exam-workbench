// 试题库 IPC：读取、删除与入库（入库任务见 import-job.ts）
import { ipcMain } from 'electron'
import { LIBRARY_IPC, type FacetFilter, type QuestionFilter } from '@shared/library'
import type { AppContext } from '../context'
import { ImportService } from './import-job'
import { deleteQuestion, getQuestion, libraryFacets, listQuestionTypes, listQuestions, listSourcePapers, questionUsage } from './queries'

export function registerLibraryIpc(ctx: AppContext): void {
  const importer = new ImportService(ctx)

  ipcMain.handle(LIBRARY_IPC.listQuestions, (event, filter: QuestionFilter) => {
    if (!ctx.fromMainWindow(event)) return undefined
    return listQuestions(ctx.db(), filter ?? {})
  })
  ipcMain.handle(LIBRARY_IPC.getQuestion, (event, id: number) => (ctx.fromMainWindow(event) ? getQuestion(ctx.db(), Number(id)) : undefined))
  ipcMain.handle(LIBRARY_IPC.listSourcePapers, (event) => (ctx.fromMainWindow(event) ? listSourcePapers(ctx.db()) : undefined))
  ipcMain.handle(LIBRARY_IPC.listQuestionTypes, (event) => (ctx.fromMainWindow(event) ? listQuestionTypes(ctx.db()) : undefined))
  ipcMain.handle(LIBRARY_IPC.facets, (event, filter: FacetFilter) => (ctx.fromMainWindow(event) ? libraryFacets(ctx.db(), filter ?? {}) : undefined))
  ipcMain.handle(LIBRARY_IPC.questionUsage, (event, ids: unknown) => {
    if (!ctx.fromMainWindow(event)) return undefined
    return questionUsage(ctx.db(), Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [])
  })
  ipcMain.handle(LIBRARY_IPC.deleteQuestion, (event, id: number) => {
    if (ctx.fromMainWindow(event)) deleteQuestion(ctx.db(), Number(id))
  })

  ipcMain.handle(LIBRARY_IPC.importUrls, (event, urls: unknown) => {
    if (!ctx.fromMainWindow(event)) return undefined
    if (!Array.isArray(urls) || !urls.every((u) => typeof u === 'string')) throw new Error('链接格式不正确')
    return importer.startUrls(urls)
  })
  ipcMain.handle(LIBRARY_IPC.importCurrentPage, (event) => (ctx.fromMainWindow(event) ? importer.startCurrentPage() : undefined))
  ipcMain.handle(LIBRARY_IPC.commitImport, (event, jobId: string) => (ctx.fromMainWindow(event) ? importer.commit(String(jobId)) : undefined))
  ipcMain.handle(LIBRARY_IPC.cancelImport, (event, jobId: string) => {
    if (ctx.fromMainWindow(event)) importer.cancel(String(jobId))
  })
}
