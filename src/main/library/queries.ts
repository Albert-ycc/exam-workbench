// 试题库读取与删除。入库写入在 import*.ts。不依赖 Electron。
import type { DatabaseSync } from 'node:sqlite'
import type { LibraryQuestion, SourcePaper } from '@shared/domain'
import { hasVisibleContent } from '../../shared/numbering.ts'
import type { FacetFilter, LibraryFacets, QuestionFilter, QuestionPage } from '../../shared/library.ts'

interface QuestionRow {
  id: number
  zujuan_qid: string | null
  source_paper_id: number | null
  source_paper_title: string | null
  source_label: string
  source_order: number
  question_type: string
  number_count: number
  stem_html: string
  answer_html: string | null
  created_at: string
}

const SELECT_QUESTION = `
  SELECT q.id, q.zujuan_qid, q.source_paper_id, sp.title AS source_paper_title, q.source_label, q.source_order,
         q.question_type, q.number_count, q.stem_html, q.answer_html, q.created_at
  FROM questions q LEFT JOIN source_papers sp ON sp.id = q.source_paper_id`

function toQuestion(row: QuestionRow): LibraryQuestion {
  return {
    id: row.id,
    zujuanQid: row.zujuan_qid,
    sourcePaperId: row.source_paper_id,
    sourcePaperTitle: row.source_paper_title ?? '',
    sourceLabel: row.source_label,
    sourceOrder: row.source_order,
    questionType: row.question_type,
    numberCount: row.number_count,
    stemHtml: row.stem_html,
    answerHtml: row.answer_html,
    createdAt: row.created_at
  }
}

// 题干 HTML 转纯文本：关键词只在文字里找，不能命中标签、属性和图片文件名
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const ORDER = 'ORDER BY q.source_paper_id DESC, q.source_order ASC, q.id ASC'
// SQLite 单条语句的变量数有上限；一次入库不会超过这个量
const MAX_IDS = 5000

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => '\\' + c)

// 筛选条件来自界面（IPC），类型不可信：字段类型不对一律按「没设」处理，不抛原始的 TypeError；
// 关键词与题型截到 100 字，否则超长关键词会让 SQLite 报「LIKE pattern too complex」
export const FILTER_TEXT_MAX = 100
const cleanText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = Array.from(value.trim()).slice(0, FILTER_TEXT_MAX).join('')
  return text || undefined
}
const cleanInt = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)

export function sanitizeFilter(raw: unknown): QuestionFilter {
  const f = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const limit = typeof f.limit === 'number' && Number.isFinite(f.limit) ? Math.floor(f.limit) : undefined
  const offset = typeof f.offset === 'number' && Number.isFinite(f.offset) ? Math.floor(f.offset) : undefined
  return {
    questionType: cleanText(f.questionType),
    sourcePaperId: cleanInt(f.sourcePaperId),
    keyword: cleanText(f.keyword),
    ids: Array.isArray(f.ids) ? f.ids.filter((id): id is number => cleanInt(id) !== undefined) : undefined,
    limit,
    offset
  }
}

// 题型以外的条件：来源卷、本次入库的题号；withType 为真时再加上题型条件
function baseWhere(filter: QuestionFilter, withType: boolean): { where: string[]; params: (string | number)[] } {
  const where: string[] = []
  const params: (string | number)[] = []
  if (withType && filter.questionType) {
    // 组卷网题型标签形如「解答题-计算题」：筛选大类时连同子类一起取
    where.push("(q.question_type = ? OR q.question_type LIKE ? ESCAPE '\\')")
    params.push(filter.questionType, `${escapeLike(filter.questionType)}-%`)
  }
  if (filter.sourcePaperId != null) {
    where.push('q.source_paper_id = ?')
    params.push(filter.sourcePaperId)
  }
  if (filter.ids) {
    const ids = filter.ids.slice(0, MAX_IDS)
    where.push(`q.id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'})`)
    params.push(...ids)
  }
  return { where, params }
}

// 关键词：先用 LIKE 粗筛（关键词不含空白和 HTML 特殊字符时），再按纯文本精确匹配
function keywordMatches(db: DatabaseSync, filter: QuestionFilter, withType: boolean): { id: number; type: string }[] {
  const keyword = filter.keyword!.trim()
  const { where, params } = baseWhere(filter, withType)
  if (/^[^&<>"\s]+$/.test(keyword)) {
    where.push("q.stem_html LIKE ? ESCAPE '\\'")
    params.push(`%${escapeLike(keyword)}%`)
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const needle = plainText(keyword)
  const rows = db.prepare(`SELECT q.id, q.question_type, q.stem_html FROM questions q${whereSql} ${ORDER}`).all(...params) as { id: number; question_type: string; stem_html: string }[]
  return rows.filter((row) => plainText(row.stem_html).includes(needle)).map((row) => ({ id: row.id, type: row.question_type }))
}

export function listQuestions(db: DatabaseSync, rawFilter: QuestionFilter): QuestionPage {
  const filter = sanitizeFilter(rawFilter)
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
  const offset = Math.max(filter.offset ?? 0, 0)

  if (!filter.keyword?.trim()) {
    const { where, params } = baseWhere(filter, true)
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM questions q${whereSql}`).get(...params) as { n: number }).n
    const rows = db.prepare(`${SELECT_QUESTION}${whereSql} ${ORDER} LIMIT ? OFFSET ?`).all(...params, limit, offset) as unknown as QuestionRow[]
    return { total, items: rows.map(toQuestion) }
  }

  const ids = keywordMatches(db, filter, true).map((row) => row.id)
  const pageIds = ids.slice(offset, offset + limit)
  if (pageIds.length === 0) return { total: ids.length, items: [] }
  const rows = db.prepare(`${SELECT_QUESTION} WHERE q.id IN (${pageIds.map(() => '?').join(',')})`).all(...pageIds) as unknown as QuestionRow[]
  const byId = new Map(rows.map((row) => [row.id, toQuestion(row)]))
  return { total: ids.length, items: pageIds.map((id) => byId.get(id)!).filter(Boolean) }
}

// 试题库页的筛选栏：全库题数、有答案的题数，以及在当前来源卷 / 关键词 / 本次入库条件下各题型的题数
export function libraryFacets(db: DatabaseSync, rawFilter: FacetFilter): LibraryFacets {
  const filter = sanitizeFilter(rawFilter)
  const total = (db.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n
  // 「有答案」与导出同一口径：答案要有文字或图片，只有空段落不算
  const answers = db.prepare('SELECT answer_html FROM questions WHERE answer_html IS NOT NULL').all() as { answer_html: string }[]
  const withAnswer = answers.filter((row) => hasVisibleContent(row.answer_html)).length

  const counts = new Map<string, number>()
  if (filter.keyword?.trim()) {
    for (const row of keywordMatches(db, filter, false)) counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
  } else {
    const { where, params } = baseWhere(filter, false)
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const rows = db.prepare(`SELECT q.question_type AS type, COUNT(*) AS n FROM questions q${whereSql} GROUP BY q.question_type`).all(...params) as { type: string; n: number }[]
    for (const row of rows) counts.set(row.type, row.n)
  }
  return { total, withAnswer, types: [...counts.entries()].map(([type, count]) => ({ type, count })) }
}

// 每道题被多少份试卷的草稿用到。草稿是 JSON.stringify 写出的，originQuestionId 一定以 "originQuestionId":数字 出现，
// 题干里的引号都被转义，不会误中；直接在原文上匹配，不必把每份草稿完整解析一遍。同一份试卷里用了多次只算一份。
export function questionUsage(db: DatabaseSync, ids?: number[]): Record<number, number> {
  const wanted = ids ? new Set(ids.map(Number)) : null
  const usage: Record<number, number> = {}
  const rows = db.prepare('SELECT draft_json FROM papers').all() as { draft_json: string }[]
  for (const row of rows) {
    const used = new Set<number>()
    for (const match of row.draft_json.matchAll(/"originQuestionId":(\d+)/g)) used.add(Number(match[1]))
    for (const id of used) if (!wanted || wanted.has(id)) usage[id] = (usage[id] ?? 0) + 1
  }
  return usage
}

export function getQuestion(db: DatabaseSync, id: number): LibraryQuestion | null {
  const row = db.prepare(`${SELECT_QUESTION} WHERE q.id = ?`).get(id) as QuestionRow | undefined
  return row ? toQuestion(row) : null
}

export function listSourcePapers(db: DatabaseSync): SourcePaper[] {
  const rows = db
    .prepare(
      `SELECT sp.id, sp.url, sp.title, sp.fetched_at, COUNT(q.id) AS question_count
       FROM source_papers sp LEFT JOIN questions q ON q.source_paper_id = sp.id
       GROUP BY sp.id ORDER BY sp.fetched_at DESC`
    )
    .all() as { id: number; url: string; title: string; fetched_at: string; question_count: number }[]
  return rows.map((r) => ({ id: r.id, url: r.url, title: r.title, fetchedAt: r.fetched_at, questionCount: r.question_count }))
}

export function listQuestionTypes(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT DISTINCT question_type FROM questions WHERE question_type <> '' ORDER BY question_type").all() as { question_type: string }[]
  return rows.map((r) => r.question_type)
}

export function deleteQuestion(db: DatabaseSync, id: number): void {
  const row = db.prepare('SELECT source_paper_id FROM questions WHERE id = ?').get(id) as { source_paper_id: number | null } | undefined
  db.prepare('DELETE FROM questions WHERE id = ?').run(id)
  // 来源卷下已没有题目时，来源卷记录一并清掉，避免筛选列表里出现空卷
  if (row?.source_paper_id != null) {
    db.prepare('DELETE FROM source_papers WHERE id = ? AND NOT EXISTS (SELECT 1 FROM questions WHERE source_paper_id = ?)').run(row.source_paper_id, row.source_paper_id)
  }
}
