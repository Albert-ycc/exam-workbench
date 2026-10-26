// 试卷、版本、下载记录的数据操作。不依赖 Electron，可在 node 测试里直接用。
// 规则：草稿实时保存不算版本；版本只增不改；草稿与最新版本内容相同时视为「无改动」。
import type { DatabaseSync } from 'node:sqlite'
import type {
  DraftSection,
  ExportFormat,
  ExportKind,
  ExportOptions,
  ExportRecord,
  PaperDetail,
  PaperDraft,
  PaperItem,
  PaperSnapshot,
  PaperSummary,
  StructureSummary,
  VersionDetail,
  VersionOrigin,
  VersionSummary
} from '@shared/domain'
import { MAX_NUMBER_COUNT, normalizeScore, structureOf } from '../../shared/numbering.ts'
import { samePath } from '../export/file-name.ts'
import { copyTags, tagsOf } from '../tags.ts'
import { assertCategory } from './classify.ts'

interface PaperRow {
  id: number
  title: string
  draft_json: string
  created_at: string
  updated_at: string
  category_id: number | null
}

interface VersionRow {
  id: number
  paper_id: number
  version_no: number
  note: string
  origin: VersionOrigin
  snapshot_json: string
  created_at: string
}

interface ExportRow {
  id: number
  version_id: number
  kind: ExportKind
  format: ExportFormat
  options_json: string
  file_path: string
  created_at: string
}

const now = (): string => new Date().toISOString()

// 试卷标题上限 100 字（同时用于下载文件名，超长标题会让列表和文件名不可用）
export const TITLE_MAX = 100
// 版本说明上限 100 字，与编辑器输入框一致
const NOTE_MAX = 100
function cleanTitle(title: string): string {
  return Array.from(title.trim()).slice(0, TITLE_MAX).join('')
}

// 嵌套安全的事务：SAVEPOINT 可以嵌套，外层没有事务时自动开启
let savepointSeq = 0
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp_${++savepointSeq}`
  db.exec(`SAVEPOINT ${name}`)
  try {
    const result = fn()
    db.exec(`RELEASE ${name}`)
    return result
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`)
    db.exec(`RELEASE ${name}`)
    throw error
  }
}

// ---------- 规范化：固定字段顺序，保证同样内容序列化结果一致 ----------

function normalizeItem(raw: unknown): PaperItem {
  const item = raw as Partial<PaperItem>
  if (!item || typeof item.id !== 'string' || typeof item.stemHtml !== 'string') throw new Error('草稿格式不正确：题目缺少 id 或内容')
  return {
    id: item.id,
    originQuestionId: typeof item.originQuestionId === 'number' ? item.originQuestionId : null,
    sourceLabel: typeof item.sourceLabel === 'string' ? item.sourceLabel : '',
    questionType: typeof item.questionType === 'string' ? item.questionType : '',
    numberCount: Number.isInteger(item.numberCount) && (item.numberCount as number) >= 1 ? Math.min(item.numberCount as number, MAX_NUMBER_COUNT) : 1,
    stemHtml: item.stemHtml,
    answerHtml: typeof item.answerHtml === 'string' ? item.answerHtml : null,
    ...withScore('score', item.score)
  }
}

// 分值只在设了的时候出现在序列化结果里：没有分值的旧草稿与升级前逐字一致，不会被误判为有改动
function withScore<K extends 'score' | 'defaultScore'>(key: K, value: unknown): { [P in K]?: number } {
  const score = normalizeScore(value)
  return (score == null ? {} : { [key]: score }) as { [P in K]?: number }
}

// 大题 id、题目 id 在整份试卷里必须唯一，编辑器按 id 定位改哪一道。
// 编辑器送来的草稿遇到重复直接拒绝（reject）；库里读出的旧数据给重复的那一份换新 id（repair），保证还能打开。
// 换的 id 由原 id 加序号派生而不是随机：同一份数据每次读出来都一样，否则草稿永远和最新版本对不上
type DuplicateIds = 'reject' | 'repair'

function normalizeSections(raw: unknown, duplicates: DuplicateIds = 'repair'): DraftSection[] {
  if (!Array.isArray(raw)) throw new Error('草稿格式不正确：缺少大题列表')
  const seen = new Set<string>()
  const unique = (id: string, what: string): string => {
    if (!seen.has(id)) {
      seen.add(id)
      return id
    }
    if (duplicates === 'reject') throw new Error(`草稿格式不正确：${what} id 重复（${id}）`)
    let n = 2
    while (seen.has(`${id}~${n}`)) n++
    const fresh = `${id}~${n}`
    seen.add(fresh)
    return fresh
  }
  return raw.map((s) => {
    const section = s as Partial<DraftSection>
    if (!section || typeof section.id !== 'string' || !Array.isArray(section.items)) throw new Error('草稿格式不正确：大题缺少 id 或题目列表')
    return {
      id: unique(section.id, '大题'),
      title: typeof section.title === 'string' ? section.title : '',
      ...withScore('defaultScore', section.defaultScore),
      items: section.items.map((raw) => {
        const item = normalizeItem(raw)
        return { ...item, id: unique(item.id, '题目') }
      })
    }
  })
}

export function normalizeDraft(raw: unknown, duplicates: DuplicateIds = 'reject'): PaperDraft {
  const target = normalizeScore((raw as Partial<PaperDraft>)?.targetScore)
  return { sections: normalizeSections((raw as Partial<PaperDraft>)?.sections, duplicates), ...(target == null ? {} : { targetScore: target }) }
}

function snapshotJson(title: string, draft: PaperDraft): string {
  const snapshot: PaperSnapshot = { title, sections: normalizeSections(draft.sections) }
  return JSON.stringify(snapshot)
}

function parseDraft(json: string): PaperDraft {
  return normalizeDraft(JSON.parse(json), 'repair')
}

export function summarizeStructure(sections: DraftSection[]): StructureSummary {
  const s = structureOf(sections)
  return { sectionCount: sections.length, questionCount: s.questionCount, totalScore: s.totalScore, unscoredCount: s.unscoredNos.length }
}

// ---------- 试卷 ----------

function paperRow(db: DatabaseSync, id: number): PaperRow {
  const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as PaperRow | undefined
  if (!row) throw new Error(`试卷不存在：${id}`)
  return row
}

function latestVersionRow(db: DatabaseSync, paperId: number): VersionRow | undefined {
  return db.prepare('SELECT * FROM paper_versions WHERE paper_id = ? ORDER BY version_no DESC LIMIT 1').get(paperId) as VersionRow | undefined
}

export function isDraftDirty(db: DatabaseSync, paperId: number): boolean {
  const row = paperRow(db, paperId)
  // 草稿自最新版本之后没写过就一定没改动，免得列表里每份试卷都整份反序列化比对。
  // 必须严格早于：同一毫秒内先存版本再改草稿的，时间戳相等，要走完整比对
  const stamp = db.prepare('SELECT created_at FROM paper_versions WHERE paper_id = ? ORDER BY version_no DESC LIMIT 1').get(paperId) as { created_at: string } | undefined
  if (stamp && row.updated_at < stamp.created_at) return false
  const latest = latestVersionRow(db, paperId)
  return !latest || snapshotJson(row.title, parseDraft(row.draft_json)) !== latest.snapshot_json
}

// categoryId：在某个分类下新建时直接归入（分类不存在时报错）
export function createPaper(db: DatabaseSync, title: string, options: { categoryId?: number | null } = {}): number {
  const name = cleanTitle(title) || '未命名试卷'
  const categoryId = options.categoryId ?? null
  if (categoryId !== null) assertCategory(db, categoryId)
  const time = now()
  const result = db
    .prepare('INSERT INTO papers (title, draft_json, created_at, updated_at, category_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, JSON.stringify({ sections: [] }), time, time, categoryId)
  return Number(result.lastInsertRowid)
}

export function listPapers(db: DatabaseSync): PaperSummary[] {
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT MAX(version_no) FROM paper_versions v WHERE v.paper_id = p.id) AS latest_no
       FROM papers p ORDER BY p.updated_at DESC`
    )
    .all() as unknown as (PaperRow & { latest_no: number | null })[]
  const tags = tagsOf(db, 'paper', rows.map((r) => r.id))
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    latestVersionNo: r.latest_no,
    draftDirty: isDraftDirty(db, r.id),
    structure: summarizeStructure(parseDraft(r.draft_json).sections),
    updatedAt: r.updated_at,
    categoryId: r.category_id,
    tags: tags.get(r.id) ?? []
  }))
}

export function getPaper(db: DatabaseSync, id: number): PaperDetail {
  const row = paperRow(db, id)
  const latest = latestVersionRow(db, id)
  return {
    id: row.id,
    title: row.title,
    draft: parseDraft(row.draft_json),
    latestVersionNo: latest?.version_no ?? null,
    draftDirty: isDraftDirty(db, id),
    updatedAt: row.updated_at
  }
}

export function renamePaper(db: DatabaseSync, id: number, title: string): { updatedAt: string; draftDirty: boolean } {
  const name = cleanTitle(title)
  if (!name) throw new Error('试卷标题不能为空')
  paperRow(db, id)
  const time = now()
  db.prepare('UPDATE papers SET title = ?, updated_at = ? WHERE id = ?').run(name, time, id)
  return { updatedAt: time, draftDirty: isDraftDirty(db, id) }
}

export function deletePaper(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM papers WHERE id = ?').run(id)
}

export function saveDraft(db: DatabaseSync, id: number, draft: unknown): { updatedAt: string; draftDirty: boolean } {
  const normalized = normalizeDraft(draft)
  paperRow(db, id)
  const time = now()
  db.prepare('UPDATE papers SET draft_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(normalized), time, id)
  return { updatedAt: time, draftDirty: isDraftDirty(db, id) }
}

// 编辑器自动保存：标题与草稿在同一个事务里写入，任何一项不合法都不会落下另一项
export function saveEdits(db: DatabaseSync, id: number, edits: { title?: string; draft?: unknown }): { updatedAt: string; draftDirty: boolean } {
  return transaction(db, () => {
    const row = paperRow(db, id)
    const draft = edits.draft === undefined ? undefined : normalizeDraft(edits.draft)
    const title = edits.title === undefined ? undefined : cleanTitle(String(edits.title))
    if (title === '') throw new Error('试卷标题不能为空')
    const time = now()
    db.prepare('UPDATE papers SET title = ?, draft_json = ?, updated_at = ? WHERE id = ?').run(
      title ?? row.title,
      draft ? JSON.stringify(draft) : row.draft_json,
      time,
      id
    )
    return { updatedAt: time, draftDirty: isDraftDirty(db, id) }
  })
}

// ---------- 版本 ----------

function exportsOf(db: DatabaseSync, versionId: number): ExportRecord[] {
  const rows = db.prepare('SELECT * FROM exports WHERE version_id = ? ORDER BY id DESC').all(versionId) as unknown as ExportRow[]
  return rows.map(toExport)
}

function toExport(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    versionId: row.version_id,
    kind: row.kind,
    format: row.format,
    options: JSON.parse(row.options_json) as ExportOptions,
    filePath: row.file_path,
    createdAt: row.created_at
  }
}

function toSummary(db: DatabaseSync, row: VersionRow): VersionSummary {
  return {
    id: row.id,
    paperId: row.paper_id,
    versionNo: row.version_no,
    note: row.note,
    origin: row.origin,
    createdAt: row.created_at,
    structure: summarizeStructure((JSON.parse(row.snapshot_json) as PaperSnapshot).sections ?? []),
    exports: exportsOf(db, row.id)
  }
}

export function createVersion(db: DatabaseSync, paperId: number, origin: VersionOrigin, note: string): VersionSummary {
  return transaction(db, () => {
    const row = paperRow(db, paperId)
    const nextNo = (latestVersionRow(db, paperId)?.version_no ?? 0) + 1
    const result = db
      .prepare('INSERT INTO paper_versions (paper_id, version_no, note, origin, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(paperId, nextNo, Array.from(note.trim()).slice(0, NOTE_MAX).join(''), origin, snapshotJson(row.title, parseDraft(row.draft_json)), now())
    const version = db.prepare('SELECT * FROM paper_versions WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as VersionRow
    return toSummary(db, version)
  })
}

export function listVersions(db: DatabaseSync, paperId: number): VersionSummary[] {
  const rows = db.prepare('SELECT * FROM paper_versions WHERE paper_id = ? ORDER BY version_no DESC').all(paperId) as unknown as VersionRow[]
  return rows.map((r) => toSummary(db, r))
}

export function getVersion(db: DatabaseSync, versionId: number): VersionDetail {
  const row = db.prepare('SELECT * FROM paper_versions WHERE id = ?').get(versionId) as VersionRow | undefined
  if (!row) throw new Error(`版本不存在：${versionId}`)
  return { ...toSummary(db, row), snapshot: JSON.parse(row.snapshot_json) as PaperSnapshot }
}

// 下载前调用：草稿有改动时先存一版，否则沿用最新版本
export function ensureVersionForDownload(db: DatabaseSync, paperId: number, note: string): { version: VersionDetail; created: boolean } {
  return transaction(db, () => {
    if (isDraftDirty(db, paperId)) {
      const created = createVersion(db, paperId, 'download', note)
      return { version: getVersion(db, created.id), created: true }
    }
    return { version: getVersion(db, latestVersionRow(db, paperId)!.id), created: false }
  })
}

// 恢复：草稿有未存改动时先存一版，再用目标版本覆盖草稿；已有版本一律不动
export function restoreVersion(db: DatabaseSync, paperId: number, versionId: number): PaperDetail {
  return transaction(db, () => {
    const target = getVersion(db, versionId)
    if (target.paperId !== paperId) throw new Error('版本不属于这份试卷')
    if (isDraftDirty(db, paperId)) createVersion(db, paperId, 'before_restore', `恢复 v${target.versionNo} 前自动保存`)
    // 目标满分不进版本快照，恢复时沿用当前草稿上的值
    const current = parseDraft(paperRow(db, paperId).draft_json)
    const draft: PaperDraft = { ...current, sections: normalizeSections(target.snapshot.sections) }
    db.prepare('UPDATE papers SET title = ?, draft_json = ?, updated_at = ? WHERE id = ?').run(target.snapshot.title, JSON.stringify(draft), now(), paperId)
    return getPaper(db, paperId)
  })
}

// 另存为新试卷：从当前草稿或某个历史版本复制出一份新试卷，新试卷没有版本，从 v1 开始；分类与标签一起复制
const COPY_SUFFIX = '（副本）'
export function duplicatePaper(db: DatabaseSync, sourcePaperId: number, options: { versionId?: number; title?: string } = {}): number {
  return transaction(db, () => {
    const source = paperRow(db, sourcePaperId)
    let title = source.title
    let draft = parseDraft(source.draft_json)
    if (options.versionId != null) {
      const version = getVersion(db, options.versionId)
      if (version.paperId !== sourcePaperId) throw new Error('版本不属于这份试卷')
      title = version.snapshot.title
      draft = { sections: normalizeSections(version.snapshot.sections) }
    }
    // 标题先截出放得下后缀的长度，免得 cleanTitle 把「（副本）」截掉一半
    const id = createPaper(db, options.title?.trim() ? options.title : `${Array.from(title.trim()).slice(0, TITLE_MAX - COPY_SUFFIX.length).join('')}${COPY_SUFFIX}`, { categoryId: source.category_id })
    db.prepare('UPDATE papers SET draft_json = ? WHERE id = ?').run(JSON.stringify(draft), id)
    copyTags(db, 'paper', sourcePaperId, id)
    return id
  })
}

// ---------- 下载记录 ----------

export function recordExport(
  db: DatabaseSync,
  versionId: number,
  format: ExportFormat,
  options: ExportOptions,
  filePath: string,
  kind: ExportKind = 'paper'
): ExportRecord {
  // 同一版本再次下载到同一个文件会覆盖它：沿用那条记录、更新时间与配置，版本历史里不出现两条指向同一文件的记录
  // 路径比较与下载时选文件名用同一个规则（不分大小写），不在 SQL 里按字面相等比
  const candidates = db.prepare('SELECT id, file_path FROM exports WHERE version_id = ? AND kind = ? ORDER BY id DESC').all(versionId, kind) as unknown as { id: number; file_path: string }[]
  const existing = candidates.find((r) => samePath(r.file_path, filePath))
  let id: number
  if (existing) {
    db.prepare('UPDATE exports SET format = ?, options_json = ?, created_at = ? WHERE id = ?').run(format, JSON.stringify(options), now(), existing.id)
    id = existing.id
  } else {
    const result = db
      .prepare('INSERT INTO exports (version_id, kind, format, options_json, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(versionId, kind, format, JSON.stringify(options), filePath, now())
    id = Number(result.lastInsertRowid)
  }
  return toExport(db.prepare('SELECT * FROM exports WHERE id = ?').get(id) as unknown as ExportRow)
}

export function getExport(db: DatabaseSync, exportId: number): ExportRecord {
  const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId) as ExportRow | undefined
  if (!row) throw new Error(`下载记录不存在：${exportId}`)
  return toExport(row)
}
