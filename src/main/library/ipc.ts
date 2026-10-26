// 试题库 IPC：读取、删除与入库（入库任务见 import-job.ts）
import { ipcMain } from 'electron'
import { LIBRARY_IPC, type FacetFilter, type QuestionFilter } from '@shared/library'
import type { AppContext } from '../context'
import { makeGuard, optionalId, toId, toIds } from '../ipc-guard'
import { changeTags, createTag, deleteTag, listTags, renameTag } from '../tags'
import { assignChapter, createChapter, deleteChapter, listChapters, moveChapter, renameChapter } from './classify'
import { ImportService } from './import-job'
import { deleteQuestion, getQuestion, libraryFacets, listQuestionIds, listQuestionTypes, listQuestions, listSourcePapers, questionUsage, resolveTarget } from './queries'

export function registerLibraryIpc(ctx: AppContext): void {
  const importer = new ImportService(ctx)

  ipcMain.handle(LIBRARY_IPC.listQuestions, (event, filter: QuestionFilter) => {
    if (!ctx.fromMainWindow(event)) return undefined
    return listQuestions(ctx.db(), filter ?? {})
  })

  ipcMain.handle(LIBRARY_IPC.listSourcePapers, (event) => (ctx.fromMainWindow(event) ? listSourcePapers(ctx.db()) : undefined))
  ipcMain.handle(LIBRARY_IPC.listQuestionTypes, (event) => (ctx.fromMainWindow(event) ? listQuestionTypes(ctx.db()) : undefined))
  ipcMain.handle(LIBRARY_IPC.facets, (event, filter: FacetFilter) => (ctx.fromMainWindow(event) ? libraryFacets(ctx.db(), filter ?? {}) : undefined))
  ipcMain.handle(LIBRARY_IPC.questionUsage, (event, ids: unknown) => {
    if (!ctx.fromMainWindow(event)) return undefined
    return questionUsage(ctx.db(), Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [])
  })

  // 归类：章节与题目标签。编号只认正整数，名称的规整与校验在数据层
  const guard = makeGuard(ctx)
  // 题目 id 只认正整数：'120'、[121]、true 这类值不能被 Number() 悄悄转成某道题
  ipcMain.handle(LIBRARY_IPC.getQuestion, guard((id: unknown) => getQuestion(ctx.db(), toId(id, '题目'))))
  ipcMain.handle(LIBRARY_IPC.deleteQuestion, guard((id: unknown) => deleteQuestion(ctx.db(), toId(id, '题目'))))
  ipcMain.handle(LIBRARY_IPC.listQuestionIds, guard((filter: FacetFilter) => listQuestionIds(ctx.db(), filter ?? {})))
  ipcMain.handle(LIBRARY_IPC.listChapters, guard(() => listChapters(ctx.db())))
  ipcMain.handle(LIBRARY_IPC.createChapter, guard((name: unknown, parentId: unknown) => createChapter(ctx.db(), name, optionalId(parentId, '章节'))))
  ipcMain.handle(LIBRARY_IPC.renameChapter, guard((id: unknown, name: unknown) => renameChapter(ctx.db(), toId(id, '章节'), name)))
  ipcMain.handle(LIBRARY_IPC.moveChapter, guard((id: unknown, toIndex: unknown) => moveChapter(ctx.db(), toId(id, '章节'), Number(toIndex))))
  ipcMain.handle(LIBRARY_IPC.deleteChapter, guard((id: unknown) => deleteChapter(ctx.db(), toId(id, '章节'))))
  ipcMain.handle(
    LIBRARY_IPC.assignChapter,
    guard((target: unknown, chapterId: unknown) => assignChapter(ctx.db(), resolveTarget(ctx.db(), target), optionalId(chapterId, '章节')))
  )
  ipcMain.handle(LIBRARY_IPC.listTags, guard(() => listTags(ctx.db(), 'question')))
  ipcMain.handle(LIBRARY_IPC.createTag, guard((name: unknown) => createTag(ctx.db(), 'question', name)))
  ipcMain.handle(LIBRARY_IPC.renameTag, guard((id: unknown, name: unknown) => renameTag(ctx.db(), 'question', toId(id, '标签'), name)))
  ipcMain.handle(LIBRARY_IPC.deleteTag, guard((id: unknown) => deleteTag(ctx.db(), 'question', toId(id, '标签'))))
  ipcMain.handle(
    LIBRARY_IPC.changeQuestionTags,
    guard((target: unknown, change: { add?: unknown; remove?: unknown } | undefined) =>
      changeTags(ctx.db(), 'question', resolveTarget(ctx.db(), target), { add: toIds(change?.add, '标签'), remove: toIds(change?.remove, '标签') })
    )
  )

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
