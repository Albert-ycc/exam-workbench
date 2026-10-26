// 试卷与版本接口
import type { PaperCategory, Tag, TagChange, TagRenameResult } from './classify'
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
  // categoryId：在某个分类下新建时直接归入（P4）
  create(title: string, options?: { categoryId?: number | null }): Promise<number>
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
  // 另存为新试卷：复制当前草稿（或 versionId 指定的历史版本）为一份新试卷，分类与标签一起复制，返回新试卷 id
  duplicate(id: number, options?: { versionId?: number; title?: string }): Promise<number>

  // 分类与标签只用于整理：不进版本快照，不改「修改时间」，不产生「有改动未存为版本」（P5）
  // 分类：名称按 normalizeClassName(…, CLASS_NAME_MAX) 规整，重名报错；删除后其中的试卷回到「未分类」
  listCategories(): Promise<PaperCategory[]> // 按 position
  createCategory(name: string): Promise<PaperCategory>
  renameCategory(id: number, name: string): Promise<void>
  moveCategory(id: number, toIndex: number): Promise<void>
  deleteCategory(id: number): Promise<{ papers: number }> // 返回回到「未分类」的份数
  setCategory(paperIds: number[], categoryId: number | null): Promise<void> // null 为移出分类
  // 试卷标签：与题目标签各自一套，规则相同
  listTags(): Promise<Tag[]>
  createTag(name: string): Promise<Tag>
  renameTag(id: number, name: string): Promise<TagRenameResult>
  deleteTag(id: number): Promise<void>
  changeTags(paperIds: number[], change: TagChange): Promise<void>
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
  duplicate: 'papers:duplicate',
  listCategories: 'papers:list-categories',
  createCategory: 'papers:create-category',
  renameCategory: 'papers:rename-category',
  moveCategory: 'papers:move-category',
  deleteCategory: 'papers:delete-category',
  setCategory: 'papers:set-category',
  listTags: 'papers:list-tags',
  createTag: 'papers:create-tag',
  renameTag: 'papers:rename-tag',
  deleteTag: 'papers:delete-tag',
  changeTags: 'papers:change-tags'
} as const
