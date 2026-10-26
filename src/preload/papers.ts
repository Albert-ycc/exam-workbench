import { ipcRenderer } from 'electron'
import { PAPERS_IPC, type PapersApi } from '@shared/papers'

export const papersApi: PapersApi = {
  list: () => ipcRenderer.invoke(PAPERS_IPC.list),
  create: (title) => ipcRenderer.invoke(PAPERS_IPC.create, title),
  get: (id) => ipcRenderer.invoke(PAPERS_IPC.get, id),
  rename: (id, title) => ipcRenderer.invoke(PAPERS_IPC.rename, id, title),
  remove: (id) => ipcRenderer.invoke(PAPERS_IPC.remove, id),
  saveDraft: (id, draft) => ipcRenderer.invoke(PAPERS_IPC.saveDraft, id, draft),
  saveEdits: (id, edits) => ipcRenderer.invoke(PAPERS_IPC.saveEdits, id, edits),
  saveEditsOnExit: (id, edits) => ipcRenderer.sendSync(PAPERS_IPC.saveEditsOnExit, id, edits) as boolean,
  pickImage: () => ipcRenderer.invoke(PAPERS_IPC.pickImage),
  listVersions: (id) => ipcRenderer.invoke(PAPERS_IPC.listVersions, id),
  getVersion: (versionId) => ipcRenderer.invoke(PAPERS_IPC.getVersion, versionId),
  saveVersion: (id, note) => ipcRenderer.invoke(PAPERS_IPC.saveVersion, id, note),
  restoreVersion: (id, versionId) => ipcRenderer.invoke(PAPERS_IPC.restoreVersion, id, versionId),
  duplicate: (id, options) => ipcRenderer.invoke(PAPERS_IPC.duplicate, id, options)
}
