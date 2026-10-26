import { ipcRenderer } from 'electron'
import { PAPERS_IPC, type PapersApi } from '@shared/papers'

export const papersApi: PapersApi = {
  list: () => ipcRenderer.invoke(PAPERS_IPC.list),
  create: (title, options) => ipcRenderer.invoke(PAPERS_IPC.create, title, options),
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
  duplicate: (id, options) => ipcRenderer.invoke(PAPERS_IPC.duplicate, id, options),
  listCategories: () => ipcRenderer.invoke(PAPERS_IPC.listCategories),
  createCategory: (name) => ipcRenderer.invoke(PAPERS_IPC.createCategory, name),
  renameCategory: (id, name) => ipcRenderer.invoke(PAPERS_IPC.renameCategory, id, name),
  moveCategory: (id, toIndex) => ipcRenderer.invoke(PAPERS_IPC.moveCategory, id, toIndex),
  deleteCategory: (id) => ipcRenderer.invoke(PAPERS_IPC.deleteCategory, id),
  setCategory: (paperIds, categoryId) => ipcRenderer.invoke(PAPERS_IPC.setCategory, paperIds, categoryId),
  listTags: () => ipcRenderer.invoke(PAPERS_IPC.listTags),
  createTag: (name) => ipcRenderer.invoke(PAPERS_IPC.createTag, name),
  renameTag: (id, name) => ipcRenderer.invoke(PAPERS_IPC.renameTag, id, name),
  deleteTag: (id) => ipcRenderer.invoke(PAPERS_IPC.deleteTag, id),
  changeTags: (paperIds, change) => ipcRenderer.invoke(PAPERS_IPC.changeTags, paperIds, change)
}
