// 试卷库分类：一份试卷属于一个分类，删除分类后试卷回到「未分类」。试卷标签在 ../tags.ts（scope 'paper'）。
// 分类与标签只用于整理：不进版本快照，不改 papers.updated_at，不影响「有改动未存为版本」。不依赖 Electron。
import type { DatabaseSync } from 'node:sqlite'
import type { PaperCategory } from '@shared/classify'
import { checkClassName, CLASS_NAME_MAX } from '../../shared/classify.ts'
import { transaction } from './repo.ts'

const now = (): string => new Date().toISOString()

function categoryName(raw: unknown): string {
  return checkClassName(raw, CLASS_NAME_MAX, '分类名')
}

export function assertCategory(db: DatabaseSync, id: number): void {
  if (!db.prepare('SELECT 1 FROM paper_categories WHERE id = ?').get(id)) throw new Error('分类不存在')
}

// name 列是 COLLATE NOCASE，等号比较不分英文大小写
function assertNameFree(db: DatabaseSync, name: string, selfId: number | null): void {
  const row = db.prepare('SELECT id FROM paper_categories WHERE name = ?').get(name) as { id: number } | undefined
  if (row && row.id !== selfId) throw new Error(`已有分类「${name}」`)
}

function orderedIds(db: DatabaseSync): number[] {
  return (db.prepare('SELECT id FROM paper_categories ORDER BY position, id').all() as { id: number }[]).map((r) => r.id)
}

function renumber(db: DatabaseSync, ids: number[]): void {
  const update = db.prepare('UPDATE paper_categories SET position = ? WHERE id = ?')
  ids.forEach((id, i) => update.run(i, id))
}

export function listCategories(db: DatabaseSync): PaperCategory[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.position, (SELECT COUNT(*) FROM papers p WHERE p.category_id = c.id) AS count
       FROM paper_categories c ORDER BY c.position, c.id`
    )
    .all() as { id: number; name: string; position: number; count: number }[]
  return rows.map((r) => ({ id: r.id, name: r.name, position: r.position, count: r.count }))
}

export function createCategory(db: DatabaseSync, raw: unknown): PaperCategory {
  const name = categoryName(raw)
  return transaction(db, () => {
    assertNameFree(db, name, null)
    const position = orderedIds(db).length
    const id = Number(db.prepare('INSERT INTO paper_categories (name, position, created_at) VALUES (?, ?, ?)').run(name, position, now()).lastInsertRowid)
    return { id, name, position, count: 0 }
  })
}

export function renameCategory(db: DatabaseSync, id: number, raw: unknown): void {
  const name = categoryName(raw)
  assertCategory(db, id)
  assertNameFree(db, name, id)
  db.prepare('UPDATE paper_categories SET name = ? WHERE id = ?').run(name, id)
}

// 调到第 toIndex 位（超出范围按两端算），其余依次顺移
export function moveCategory(db: DatabaseSync, id: number, toIndex: number): void {
  assertCategory(db, id)
  transaction(db, () => {
    const ids = orderedIds(db).filter((x) => x !== id)
    const at = Math.min(Math.max(Math.trunc(Number.isFinite(toIndex) ? toIndex : 0), 0), ids.length)
    ids.splice(at, 0, id)
    renumber(db, ids)
  })
}

// 删除分类，其中的试卷回到「未分类」（外键 ON DELETE SET NULL）。返回这些试卷的份数
export function deleteCategory(db: DatabaseSync, id: number): { papers: number } {
  assertCategory(db, id)
  return transaction(db, () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM papers WHERE category_id = ?').get(id) as { n: number }
    db.prepare('DELETE FROM paper_categories WHERE id = ?').run(id)
    renumber(db, orderedIds(db))
    return { papers: n }
  })
}

// 移到分类；categoryId 为 null 时移出分类。只改 category_id，不动修改时间
export function setCategory(db: DatabaseSync, paperIds: number[], categoryId: number | null): void {
  if (categoryId !== null) assertCategory(db, categoryId)
  const update = db.prepare('UPDATE papers SET category_id = ? WHERE id = ?')
  transaction(db, () => {
    for (const id of new Set(paperIds)) update.run(categoryId, id)
  })
}
