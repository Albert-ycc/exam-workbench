import { ipcRenderer } from 'electron'
import { EXPORT_IPC, type ExportApi } from '@shared/export'

export const exportApi: ExportApi = {
  getDefaults: () => ipcRenderer.invoke(EXPORT_IPC.getDefaults),
  chooseDirectory: (current) => ipcRenderer.invoke(EXPORT_IPC.chooseDirectory, current),
  setDefaultDirectory: (directory) => ipcRenderer.invoke(EXPORT_IPC.setDefaultDirectory, directory),
  previewFileName: (paperId, options, kind, directory) => ipcRenderer.invoke(EXPORT_IPC.previewFileName, paperId, options, kind, directory),
  checkExport: (paperId, options, kind) => ipcRenderer.invoke(EXPORT_IPC.checkExport, paperId, options, kind),
  exportPaper: (request) => ipcRenderer.invoke(EXPORT_IPC.exportPaper, request),
  reexport: (exportId) => ipcRenderer.invoke(EXPORT_IPC.reexport, exportId),
  showInFolder: (filePath) => ipcRenderer.invoke(EXPORT_IPC.showInFolder, filePath)
}
