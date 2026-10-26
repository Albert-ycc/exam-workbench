// 试题库归类：章节（老师自建两级目录）、入库时写知识点与难度、题目列表带上归类。不依赖 Electron。
// 标签的增删改与批量打标签在 ../tags.ts（题目标签与试卷标签共用一套实现）。
import type { DatabaseSync } from 'node:sqlite'
import type { Chapter, KnowledgeRef } from '@shared/classify'
import type { LibraryQuestion } from '@shared/domain'
import { checkClassName, CLASS_NAME_MAX, normalizeClassName } from '../../shared/classify.ts'
import { transaction } from '../papers/repo.ts'
import { tagsOf } from '../tags.ts'

const now = (): string => new Date().toISOString()

// ---------- 章节 ----------

interface ChapterRow {
  id: number
  parent_id: number | null
  name: string
  position: number
}

function chapterName(raw: unknown): string {
  return checkClassName(raw, CLASS_NAME_MAX, '章节名')
}

function chapterRow(db: DatabaseSync, id: number): ChapterRow {
  const row = db.prepare('SELECT id, parent_id, name, position FROM chapters WHERE id = ?').get(id) as ChapterRow | undefined
  if (!row) throw new Error('章节不存在')
  return row
}

function siblingIds(db: DatabaseSync, parentId: number | null): number[] {
  const rows = db.prepare('SELECT id FROM chapters WHERE parent_id IS ? ORDER BY position, id').all(parentId) as { id: number }[]
  return rows.map((r) => r.id)
}

// 同一级重名（不分英文大小写）
function assertNameFree(db: DatabaseSync, parentId: number | null, name: string, selfId: number | null): void {
  const row = db.prepare('SELECT id FROM chapters WHERE parent_id IS ? AND name = ?').get(parentId, name) as { id: number } | undefined
  if (row && row.id !== selfId) throw new Error(`同一级已有「${name}」`)
}

// 章在前、节紧跟其章，各按 position；题数：章包含其下各节
export function listChapters(db: DatabaseSync): Chapter[] {
  const rows = db.prepare('SELECT id, parent_id, name, position FROM chapters ORDER BY position, id').all() as unknown as ChapterRow[]
  const direct = new Map<number, number>()
  for (const r of db.prepare('SELECT chapter_id AS id, COUNT(*) AS n FROM question_chapter GROUP BY chapter_id').all() as { id: number; n: number }[]) direct.set(r.id, r.n)
  const result: Chapter[] = []
  for (const top of rows.filter((r) => r.parent_id === null)) {
    const children = rows.filter((r) => r.parent_id === top.id)
    const count = (direct.get(top.id) ?? 0) + children.reduce((sum, c) => sum + (direct.get(c.id) ?? 0), 0)
    result.push({ id: top.id, parentId: null, name: top.name, position: top.position, count })
    for (const c of children) result.push({ id: c.id, parentId: top.id, name: c.name, position: c.position, count: direct.get(c.id) ?? 0 })
  }
  return result
}

export function createChapter(db: DatabaseSync, rawName: unknown, parentId: number | null = null): Chapter {
  const name = chapterName(rawName)
  return transaction(db, () => {
    if (parentId !== null && chapterRow(db, parentId).parent_id !== null) throw new Error('章节只有章、节两级')
    assertNameFree(db, parentId, name, null)
    const position = siblingIds(db, parentId).length
    const id = Number(db.prepare('INSERT INTO chapters (parent_id, name, position, created_at) VALUES (?, ?, ?, ?)').run(parentId, name, position, now()).lastInsertRowid)
    return { id, parentId, name, position, count: 0 }
  })
}

export function renameChapter(db: DatabaseSync, id: number, rawName: unknown): void {
  const name = chapterName(rawName)
  const row = chapterRow(db, id)
  assertNameFree(db, row.parent_id, name, id)
  db.prepare('UPDATE chapters SET name = ? WHERE id = ?').run(name, id)
}

// 同级内调到第 toIndex 位（超出范围按两端算），其余依次顺移
export function moveChapter(db: DatabaseSync, id: number, toIndex: number): void {
  const row = chapterRow(db, id)
  transaction(db, () => {
    const ids = siblingIds(db, row.parent_id).filter((x) => x !== id)
    const at = Math.min(Math.max(Math.trunc(Number.isFinite(toIndex) ? toIndex : 0), 0), ids.length)
    ids.splice(at, 0, id)
    const update = db.prepare('UPDATE chapters SET position = ? WHERE id = ?')
    ids.forEach((x, i) => update.run(i, x))
  })
}

// 删除章连同其下各节；归在里面的题回到「未归章节」。返回这些题的数量
export function deleteChapter(db: DatabaseSync, id: number): { questions: number } {
  const row = chapterRow(db, id)
  return transaction(db, () => {
    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM question_chapter WHERE chapter_id = ? OR chapter_id IN (SELECT id FROM chapters WHERE parent_id = ?)')
      .get(id, id) as { n: number }
    db.prepare('DELETE FROM chapters WHERE id = ?').run(row.id)
    const left = siblingIds(db, row.parent_id)
    const update = db.prepare('UPDATE chapters SET position = ? WHERE id = ?')
    left.forEach((x, i) => update.run(i, x))
    return { questions: n }
  })
}

// 归到章节；chapterId 为 null 时移出章节。不存在的题跳过。返回涉及的题数
export function assignChapter(db: DatabaseSync, questionIds: number[], chapterId: number | null): number {
  if (chapterId !== null) chapterRow(db, chapterId)
  const exists = db.prepare('SELECT 1 FROM questions WHERE id = ?')
  const put = db.prepare('INSERT INTO question_chapter (question_id, chapter_id) VALUES (?, ?) ON CONFLICT(question_id) DO UPDATE SET chapter_id = excluded.chapter_id')
  const clear = db.prepare('DELETE FROM question_chapter WHERE question_id = ?')
  return transaction(db, () => {
    let touched = 0
    for (const id of new Set(questionIds)) {
      if (!exists.get(id)) continue
      if (chapterId === null) clear.run(id)
      else put.run(id, chapterId)
      touched++
    }
    return touched
  })
}

// ---------- 知识点与难度（入库时写，只增不改） ----------

export interface QuestionMeta {
  knowledge: KnowledgeRef[]
  difficulty: number | null
}

export const KNOWLEDGE_PER_QUESTION_MAX = 20
const KNOWLEDGE_NAME_MAX = 60

// 页面上读来的值不可信：编号要是正整数，名称规整后非空，学科代码只认小写字母，难度在 0–1 之间；同一编号只留第一个
export function sanitizeMeta(raw: unknown): QuestionMeta {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as { knowledge?: unknown; difficulty?: unknown }
  const knowledge: KnowledgeRef[] = []
  const seen = new Set<number>()
  for (const item of Array.isArray(r.knowledge) ? r.knowledge : []) {
    if (knowledge.length >= KNOWLEDGE_PER_QUESTION_MAX) break
    const k = (typeof item === 'object' && item !== null ? item : {}) as Partial<KnowledgeRef>
    const id = typeof k.id === 'number' && Number.isSafeInteger(k.id) && k.id > 0 ? k.id : null
    const name = normalizeClassName(k.name, KNOWLEDGE_NAME_MAX)
    if (id === null || !name || seen.has(id)) continue
    seen.add(id)
    knowledge.push({ id, name, subject: typeof k.subject === 'string' && /^[a-z]{2,8}$/.test(k.subject) ? k.subject : '' })
  }
  const d = r.difficulty
  const difficulty = typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= 1 ? d : null
  return { knowledge, difficulty }
}

// 这道题缺不缺知识点、难度（入库预览判断「补齐」用）
export function metaGaps(db: DatabaseSync, questionId: number): { knowledge: boolean; difficulty: boolean } {
  const k = db.prepare('SELECT 1 FROM question_knowledge WHERE question_id = ? LIMIT 1').get(questionId)
  const d = db.prepare('SELECT 1 FROM question_difficulty WHERE question_id = ?').get(questionId)
  return { knowledge: !k, difficulty: !d }
}

// 只补缺：这道题还没有知识点时才写知识点，还没有难度时才写难度，已有的不动。返回这次写了哪几项
export function saveQuestionMeta(db: DatabaseSync, questionId: number, raw: unknown): { knowledge: boolean; difficulty: boolean } {
  const meta = sanitizeMeta(raw)
  return transaction(db, () => {
    const gaps = metaGaps(db, questionId)
    const wrote = { knowledge: false, difficulty: false }
    if (gaps.knowledge && meta.knowledge.length > 0) {
      const point = db.prepare('INSERT INTO knowledge_points (id, name, subject) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
      const link = db.prepare('INSERT INTO question_knowledge (question_id, knowledge_id, position) VALUES (?, ?, ?)')
      meta.knowledge.forEach((k, i) => {
        point.run(k.id, k.name, k.subject)
        link.run(questionId, k.id, i)
      })
      wrote.knowledge = true
    }
    if (gaps.difficulty && meta.difficulty !== null) {
      db.prepare('INSERT INTO question_difficulty (question_id, coefficient) VALUES (?, ?)').run(questionId, meta.difficulty)
      wrote.difficulty = true
    }
    return wrote
  })
}

// ---------- 题目列表带上归类 ----------

type BareQuestion = Omit<LibraryQuestion, 'chapterId' | 'knowledge' | 'difficulty' | 'tags'>

export function withClassification(db: DatabaseSync, questions: BareQuestion[]): LibraryQuestion[] {
  if (questions.length === 0) return []
  const ids = JSON.stringify(questions.map((q) => q.id))
  const chapter = new Map<number, number>()
  for (const r of db.prepare('SELECT question_id AS q, chapter_id AS c FROM question_chapter WHERE question_id IN (SELECT value FROM json_each(?))').all(ids) as { q: number; c: number }[]) {
    chapter.set(r.q, r.c)
  }
  const difficulty = new Map<number, number>()
  for (const r of db.prepare('SELECT question_id AS q, coefficient AS d FROM question_difficulty WHERE question_id IN (SELECT value FROM json_each(?))').all(ids) as { q: number; d: number }[]) {
    difficulty.set(r.q, r.d)
  }
  const knowledge = new Map<number, KnowledgeRef[]>()
  const kRows = db
    .prepare(
      `SELECT qk.question_id AS q, kp.id, kp.name, kp.subject FROM question_knowledge qk JOIN knowledge_points kp ON kp.id = qk.knowledge_id
       WHERE qk.question_id IN (SELECT value FROM json_each(?)) ORDER BY qk.question_id, qk.position`
    )
    .all(ids) as { q: number; id: number; name: string; subject: string }[]
  for (const r of kRows) {
    const list = knowledge.get(r.q) ?? []
    list.push({ id: r.id, name: r.name, subject: r.subject })
    knowledge.set(r.q, list)
  }
  const tags = tagsOf(db, 'question', questions.map((q) => q.id))
  return questions.map((q) => ({
    ...q,
    chapterId: chapter.get(q.id) ?? null,
    knowledge: knowledge.get(q.id) ?? [],
    difficulty: difficulty.get(q.id) ?? null,
    tags: tags.get(q.id) ?? []
  }))
}
