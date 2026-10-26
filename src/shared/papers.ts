// 试卷与版本接口
import type { PaperDetail, PaperDraft, PaperSummary, VersionDetail, VersionSummary } from './domain'

// 保存草稿或标题后的结果：draftDirty 表示相对最新版本是否有未存改动
export interface PaperSaveResult {
  updatedAt: string
  draftDirty: boolean
}

// 编辑器一次保存的内容：标题和草稿都可选，同一次调用里一起写入
export interface PaperEdits {
  title?: string
  draft?: PaperDraft
}

export interface PapersApi {
  list(): Promise<PaperSummary[]>
  create(title: string): Promise<number>
  get(id: number): Promise<PaperDetail>
  rename(id: number, title: string): Promise<PaperSaveResult>
  remove(id: number): Promise<void>
  saveDraft(id: number, draft: PaperDraft): Promise<PaperSaveResult>
  saveEdits(id: number, edits: PaperEdits): Promise<PaperSaveResult>
  // 同步写入，只在窗口即将关闭时用：异步请求赶不上页面卸载
  saveEditsOnExit(id: number, edits: PaperEdits): boolean
  // 弹出选择框挑一张本地图片，存进数据目录并返回 ewb-asset 地址；取消返回 null
  pickImage(): Promise<string | null>
  listVersions(id: number): Promise<VersionSummary[]>
  getVersion(versionId: number): Promise<VersionDetail>
  saveVersion(id: number, note: string): Promise<VersionSummary>
  restoreVersion(id: number, versionId: number): Promise<PaperDetail>
  // 另存为新试卷：复制当前草稿（或 versionId 指定的历史版本）为一份新试卷，返回新试卷 id
  duplicate(id: number, options?: { versionId?: number; title?: string }): Promise<number>
}

export const PAPERS_IPC = {
  list: 'papers:list',
  create: 'papers:create',
  get: 'papers:get',
  rename: 'papers:rename',
  remove: 'papers:remove',
  saveDraft: 'papers:save-draft',
  saveEdits: 'papers:save-edits',
  saveEditsOnExit: 'papers:save-edits-on-exit',
  pickImage: 'papers:pick-image',
  listVersions: 'papers:list-versions',
  getVersion: 'papers:get-version',
  saveVersion: 'papers:save-version',
  restoreVersion: 'papers:restore-version',
  duplicate: 'papers:duplicate'
} as const
