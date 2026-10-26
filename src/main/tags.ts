// 标签：题目标签与试卷标签各自一套（scope），命名、合并、删除规则相同。不依赖 Electron。
import type { DatabaseSync } from 'node:sqlite'
import type { Tag, TagChange, TagRenameResult, TagScope } from '@shared/classify'
import { checkClassName, TAG_NAME_MAX } from '../shared/classify.ts'
import { transaction } from './papers/repo.ts'

// 每套标签挂在哪张表上；表名只来自这里，不拼接外部输入
const LINK = {
  question: { table: 'question_tags', owner: 'question_id', owners: 'questions' },
  paper: { table: 'paper_tags', owner: 'paper_id', owners: 'papers' }
} as const

const now = (): string => new Date().toISOString()

export function tagName(raw: unknown): string {
  return checkClassName(raw, TAG_NAME_MAX, '标签名')
}

function tagRow(db: DatabaseSync, scope: TagScope, id: number): { id: number; name: string } {
  const row = db.prepare('SELECT id, name FROM tags WHERE id = ? AND scope = ?').get(id, scope) as { id: number; name: string } | undefined
  if (!row) throw new Error('标签不存在')
  return row
}

// name 列是 COLLATE NOCASE，等号比较不分英文大小写
function findByName(db: DatabaseSync, scope: TagScope, name: string): { id: number; name: string } | undefined {
  return db.prepare('SELECT id, name FROM tags WHERE scope = ? AND name = ?').get(scope, name) as { id: number; name: string } | undefined
}

function countOf(db: DatabaseSync, scope: TagScope, id: number): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${LINK[scope].table} WHERE tag_id = ?`).get(id) as { n: number }).n
}

export function listTags(db: DatabaseSync, scope: TagScope): Tag[] {
  const { table } = LINK[scope]
  const rows = db
    .prepare(`SELECT t.id, t.name, COUNT(l.tag_id) AS count FROM tags t LEFT JOIN ${table} l ON l.tag_id = t.id WHERE t.scope = ? GROUP BY t.id`)
    .all(scope) as { id: number; name: string; count: number }[]
  return rows.map((r) => ({ id: r.id, name: r.name, count: r.count })).sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

// 已有同名标签时返回那一个，不新建
export function createTag(db: DatabaseSync, scope: TagScope, raw: unknown): Tag {
  const name = tagName(raw)
  const existing = findByName(db, scope, name)
  if (existing) return { ...existing, count: countOf(db, scope, existing.id) }
  const id = Number(db.prepare('INSERT INTO tags (scope, name, created_at) VALUES (?, ?, ?)').run(scope, name, now()).lastInsertRowid)
  return { id, name, count: 0 }
}

// 改成另一个标签的名字时合并：本标签下的题（试卷）挂到那个标签上，本标签删除
export function renameTag(db: DatabaseSync, scope: TagScope, id: number, raw: unknown): TagRenameResult {
  const name = tagName(raw)
  const { table, owner } = LINK[scope]
  return transaction(db, () => {
    tagRow(db, scope, id)
    const other = findByName(db, scope, name)
    if (other && other.id !== id) {
      db.prepare(`INSERT OR IGNORE INTO ${table} (${owner}, tag_id) SELECT ${owner}, ? FROM ${table} WHERE tag_id = ?`).run(other.id, id)
      db.prepare('DELETE FROM tags WHERE id = ?').run(id)
      return { id: other.id, mergedInto: other.id }
    }
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
    return { id, mergedInto: null }
  })
}

export function deleteTag(db: DatabaseSync, scope: TagScope, id: number): void {
  tagRow(db, scope, id)
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

// 批量打标签 / 去标签。题（试卷）不存在的跳过；标签必须属于这一套。返回实际涉及的题（试卷）数
export function changeTags(db: DatabaseSync, scope: TagScope, ownerIds: number[], change: TagChange): number {
  const { table, owner, owners } = LINK[scope]
  const add = [...new Set(change.add ?? [])]
  const remove = [...new Set(change.remove ?? [])]
  for (const id of [...add, ...remove]) tagRow(db, scope, id)
  const exists = db.prepare(`SELECT 1 FROM ${owners} WHERE id = ?`)
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${owner}, tag_id) VALUES (?, ?)`)
  const del = db.prepare(`DELETE FROM ${table} WHERE ${owner} = ? AND tag_id = ?`)
  return transaction(db, () => {
    let touched = 0
    for (const ownerId of new Set(ownerIds)) {
      if (!exists.get(ownerId)) continue
      for (const tagId of add) insert.run(ownerId, tagId)
      for (const tagId of remove) del.run(ownerId, tagId)
      touched++
    }
    return touched
  })
}

// 一批题（试卷）各自的标签，按名称排序
export function tagsOf(db: DatabaseSync, scope: TagScope, ownerIds: number[]): Map<number, { id: number; name: string }[]> {
  const { table, owner } = LINK[scope]
  const result = new Map<number, { id: number; name: string }[]>()
  if (ownerIds.length === 0) return result
  const rows = db
    .prepare(`SELECT l.${owner} AS owner, t.id, t.name FROM ${table} l JOIN tags t ON t.id = l.tag_id WHERE l.${owner} IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ownerIds)) as { owner: number; id: number; name: string }[]
  for (const row of rows) {
    const list = result.get(row.owner) ?? []
    list.push({ id: row.id, name: row.name })
    result.set(row.owner, list)
  }
  for (const list of result.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return result
}

// 复制一份试卷时把标签一起带过去
export function copyTags(db: DatabaseSync, scope: TagScope, fromId: number, toId: number): void {
  const { table, owner } = LINK[scope]
  db.prepare(`INSERT OR IGNORE INTO ${table} (${owner}, tag_id) SELECT ?, tag_id FROM ${table} WHERE ${owner} = ?`).run(toId, fromId)
}
