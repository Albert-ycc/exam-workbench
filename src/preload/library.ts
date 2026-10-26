import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { LIBRARY_IPC, type ImportProgress, type LibraryApi } from '@shared/library'

export const libraryApi: LibraryApi = {
  listQuestions: (filter) => ipcRenderer.invoke(LIBRARY_IPC.listQuestions, filter),
  getQuestion: (id) => ipcRenderer.invoke(LIBRARY_IPC.getQuestion, id),
  listSourcePapers: () => ipcRenderer.invoke(LIBRARY_IPC.listSourcePapers),
  listQuestionTypes: () => ipcRenderer.invoke(LIBRARY_IPC.listQuestionTypes),
  deleteQuestion: (id) => ipcRenderer.invoke(LIBRARY_IPC.deleteQuestion, id),
  importUrls: (urls) => ipcRenderer.invoke(LIBRARY_IPC.importUrls, urls),
  importCurrentPage: () => ipcRenderer.invoke(LIBRARY_IPC.importCurrentPage),
  onImportProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: ImportProgress): void => listener(progress)
    ipcRenderer.on(LIBRARY_IPC.importProgress, handler)
    return () => ipcRenderer.removeListener(LIBRARY_IPC.importProgress, handler)
  },
  commitImport: (jobId) => ipcRenderer.invoke(LIBRARY_IPC.commitImport, jobId),
  cancelImport: (jobId) => ipcRenderer.invoke(LIBRARY_IPC.cancelImport, jobId),
  facets: (filter) => ipcRenderer.invoke(LIBRARY_IPC.facets, filter),
  questionUsage: (ids) => ipcRenderer.invoke(LIBRARY_IPC.questionUsage, ids)
}
