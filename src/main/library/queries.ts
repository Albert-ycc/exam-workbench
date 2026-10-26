// 试题库读取与删除，筛选与各项题数。入库写入在 commit.ts，归类的增删改在 classify.ts。不依赖 Electron。
import type { DatabaseSync } from 'node:sqlite'
import type { DifficultyKey } from '@shared/classify'
import type { LibraryQuestion, SourcePaper } from '@shared/domain'
import { DIFFICULTY_TIERS, difficultyTier, isDifficultyKey, NO_CHAPTER } from '../../shared/classify.ts'
import { hasVisibleContent } from '../../shared/numbering.ts'
import type { FacetFilter, KnowledgeCount, LibraryFacets, QuestionFilter, QuestionPage } from '../../shared/library.ts'
import { withClassification } from './classify.ts'

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

function toQuestion(row: QuestionRow): Omit<LibraryQuestion, 'chapterId' | 'knowledge' | 'difficulty' | 'tags'> {
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
// 「只取这些题」的题号上限：题号经 json_each 作为一个参数传入，不受 SQLite 变量数限制，这里只防异常的超大数组
const MAX_IDS = 100000

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
// 归类条件的编号列表：只留整数、去重，最多 MAX_CHOICES 个；空列表按「没设」处理
const MAX_CHOICES = 500
const cleanIds = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const ids = [...new Set(value.filter((id): id is number => cleanInt(id) !== undefined))].slice(0, MAX_CHOICES)
  return ids.length ? ids : undefined
}

export function sanitizeFilter(raw: unknown): QuestionFilter {
  const f = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  // 分页参数夹到安全整数范围内：1e21 这类值直接交给 SQLite 会报英文的 datatype mismatch
  const page = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), Number.MAX_SAFE_INTEGER) : undefined
  const limit = page(f.limit)
  const offset = page(f.offset)
  const difficulties = Array.isArray(f.difficulties) ? [...new Set(f.difficulties.filter(isDifficultyKey))] : []
  return {
    questionType: cleanText(f.questionType),
    sourcePaperId: cleanInt(f.sourcePaperId),
    keyword: cleanText(f.keyword),
    ids: Array.isArray(f.ids) ? f.ids.filter((id): id is number => cleanInt(id) !== undefined) : undefined,
    chapterIds: cleanIds(f.chapterIds),
    knowledgeIds: cleanIds(f.knowledgeIds),
    difficulties: difficulties.length ? difficulties : undefined,
    tagIds: cleanIds(f.tagIds),
    limit,
    offset
  }
}

// 题数统计时可以单独拿掉的一项条件
type Facet = 'type' | 'chapter' | 'knowledge' | 'difficulty' | 'tag'

// 关键词以外的全部条件；skip 指定的那一项不参与（统计该项各选项的题数时用）
function baseWhere(filter: QuestionFilter, skip: Facet | null): { where: string[]; params: (string | number)[] } {
  const where: string[] = []
  const params: (string | number)[] = []
  if (skip !== 'type' && filter.questionType) {
    // 组卷网题型标签形如「解答题-计算题」：筛选大类时连同子类一起取
    where.push("(q.question_type = ? OR q.question_type LIKE ? ESCAPE '\\')")
    params.push(filter.questionType, `${escapeLike(filter.questionType)}-%`)
  }
  if (filter.sourcePaperId != null) {
    where.push('q.source_paper_id = ?')
    params.push(filter.sourcePaperId)
  }
  if (filter.ids) {
    where.push('q.id IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(filter.ids.slice(0, MAX_IDS)))
  }
  if (skip !== 'chapter' && filter.chapterIds) {
    // 选章包含其下各节；「未归章节」与具体章节可以同时选，取并集
    const real = filter.chapterIds.filter((id) => id !== NO_CHAPTER)
    const parts: string[] = []
    if (real.length) {
      parts.push(
        `q.id IN (SELECT question_id FROM question_chapter WHERE chapter_id IN (SELECT value FROM json_each(?))
         OR chapter_id IN (SELECT id FROM chapters WHERE parent_id IN (SELECT value FROM json_each(?))))`
      )
      params.push(JSON.stringify(real), JSON.stringify(real))
    }
    if (filter.chapterIds.includes(NO_CHAPTER)) parts.push('q.id NOT IN (SELECT question_id FROM question_chapter)')
    where.push(`(${parts.join(' OR ')})`)
  }
  if (skip !== 'knowledge' && filter.knowledgeIds) {
    where.push('q.id IN (SELECT question_id FROM question_knowledge WHERE knowledge_id IN (SELECT value FROM json_each(?)))')
    params.push(JSON.stringify(filter.knowledgeIds))
  }
  if (skip !== 'difficulty' && filter.difficulties) {
    // 档位的系数范围只取自 DIFFICULTY_TIERS
    const tiers = DIFFICULTY_TIERS.filter((t) => filter.difficulties!.includes(t.key))
    where.push(`q.id IN (SELECT question_id FROM question_difficulty WHERE ${tiers.map(() => '(coefficient >= ? AND coefficient < ?)').join(' OR ')})`)
    for (const t of tiers) params.push(t.min, t.max)
  }
  if (skip !== 'tag' && filter.tagIds) {
    where.push('q.id IN (SELECT question_id FROM question_tags WHERE tag_id IN (SELECT value FROM json_each(?)))')
    params.push(JSON.stringify(filter.tagIds))
  }
  return { where, params }
}

// 关键词：按题干纯文本匹配。不在原始 HTML 上用 LIKE 粗筛——「OA．」存成 <i>OA</i>．，粗筛会把能匹配的题漏掉
function keywordMatches(db: DatabaseSync, filter: QuestionFilter, skip: Facet | null): { id: number; type: string }[] {
  const keyword = filter.keyword!.trim()
  const { where, params } = baseWhere(filter, skip)
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  // 关键词是用户打的文字，不当 HTML 处理：「<i>」要找的是这三个字符本身
  const needle = keyword.replace(/\s+/g, ' ').toLowerCase()
  const rows = db.prepare(`SELECT q.id, q.question_type, q.stem_html FROM questions q${whereSql} ${ORDER}`).all(...params) as { id: number; question_type: string; stem_html: string }[]
  return rows.filter((row) => plainText(row.stem_html).includes(needle)).map((row) => ({ id: row.id, type: row.question_type }))
}

export function listQuestions(db: DatabaseSync, rawFilter: QuestionFilter): QuestionPage {
  const filter = sanitizeFilter(rawFilter)
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
  const offset = Math.max(filter.offset ?? 0, 0)

  if (!filter.keyword?.trim()) {
    const { where, params } = baseWhere(filter, null)
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM questions q${whereSql}`).get(...params) as { n: number }).n
    const rows = db.prepare(`${SELECT_QUESTION}${whereSql} ${ORDER} LIMIT ? OFFSET ?`).all(...params, limit, offset) as unknown as QuestionRow[]
    return { total, items: withClassification(db, rows.map(toQuestion)) }
  }

  const ids = keywordMatches(db, filter, null).map((row) => row.id)
  const pageIds = ids.slice(offset, offset + limit)
  if (pageIds.length === 0) return { total: ids.length, items: [] }
  const rows = db.prepare(`${SELECT_QUESTION} WHERE q.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(pageIds)) as unknown as QuestionRow[]
  const byId = new Map(rows.map((row) => [row.id, toQuestion(row)]))
  return { total: ids.length, items: withClassification(db, pageIds.map((id) => byId.get(id)!).filter(Boolean)) }
}

// 符合条件的全部题号，按列表顺序；skip 指定的那一项条件不参与
function matchIds(db: DatabaseSync, filter: QuestionFilter, skip: Facet | null): number[] {
  if (filter.keyword?.trim()) return keywordMatches(db, filter, skip).map((row) => row.id)
  const { where, params } = baseWhere(filter, skip)
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  return (db.prepare(`SELECT q.id FROM questions q${whereSql} ${ORDER}`).all(...params) as { id: number }[]).map((row) => row.id)
}

// 「全选筛出的 N 道」：按条件取全部题号，不受分页影响
export function listQuestionIds(db: DatabaseSync, rawFilter: FacetFilter): number[] {
  return matchIds(db, sanitizeFilter(rawFilter), null)
}

const FILTER_KEYS = ['questionType', 'sourcePaperId', 'keyword', 'ids', 'chapterIds', 'knowledgeIds', 'difficulties', 'tagIds', 'limit', 'offset'] as const

// 批量写操作用的条件必须完整可用：有不认识的字段，或某项设了值却在清洗后整项丢失（范围会因此变大，甚至变成全库），直接拒绝
function strictFilter(raw: unknown): QuestionFilter {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('筛选条件不正确')
  const given = raw as Record<string, unknown>
  const clean = sanitizeFilter(given)
  for (const [key, value] of Object.entries(given)) {
    if (!(FILTER_KEYS as readonly string[]).includes(key)) throw new Error('筛选条件不正确')
    const set = value != null && value !== '' && !(Array.isArray(value) && value.length === 0)
    if (set && clean[key as keyof QuestionFilter] === undefined) throw new Error('筛选条件不正确')
  }
  return clean
}

// 批量操作的对象落到题号：勾选的题原样用（只留整数），按条件的取全部符合的题（不受分页影响）
export function resolveTarget(db: DatabaseSync, raw: unknown): number[] {
  const target = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<{ ids: unknown; filter: unknown }>
  if (Array.isArray(target.ids)) return [...new Set(target.ids.filter((id): id is number => cleanInt(id) !== undefined))]
  if ('filter' in target) return matchIds(db, strictFilter(target.filter), null)
  throw new Error('没有指定要操作的题目')
}

// 试题库页的筛选栏：全库题数、有答案的题数，以及各项条件下各选项的题数。
// 每一项的题数按「其他条件」计算、本项不参与；题数为 0 的不列，当前选中的除外
export function libraryFacets(db: DatabaseSync, rawFilter: FacetFilter): LibraryFacets {
  const filter = sanitizeFilter(rawFilter)
  const total = (db.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n
  // 「有答案」与导出同一口径：答案要有文字或图片，只有空段落不算
  const answers = db.prepare('SELECT answer_html FROM questions WHERE answer_html IS NOT NULL').all() as { answer_html: string }[]
  const withAnswer = answers.filter((row) => hasVisibleContent(row.answer_html)).length
  const json = (ids: number[]): string => JSON.stringify(ids)

  // 题型
  const typeCounts = new Map<string, number>()
  const typeIds = matchIds(db, filter, 'type')
  for (const r of db.prepare('SELECT question_type AS type, COUNT(*) AS n FROM questions WHERE id IN (SELECT value FROM json_each(?)) GROUP BY question_type').all(json(typeIds)) as { type: string; n: number }[]) {
    typeCounts.set(r.type, r.n)
  }

  // 章节：章包含其下各节；未归章节单列
  const chapterIds = matchIds(db, filter, 'chapter')
  const direct = new Map<number, number>()
  for (const r of db.prepare('SELECT chapter_id AS id, COUNT(*) AS n FROM question_chapter WHERE question_id IN (SELECT value FROM json_each(?)) GROUP BY chapter_id').all(json(chapterIds)) as { id: number; n: number }[]) {
    direct.set(r.id, r.n)
  }
  const chapterRows = db.prepare('SELECT id, parent_id FROM chapters').all() as { id: number; parent_id: number | null }[]
  const chapterCounts = new Map<number, number>()
  for (const c of chapterRows) {
    const n = direct.get(c.id) ?? 0
    chapterCounts.set(c.id, (chapterCounts.get(c.id) ?? 0) + n)
    if (c.parent_id !== null) chapterCounts.set(c.parent_id, (chapterCounts.get(c.parent_id) ?? 0) + n)
  }
  const chaptered = [...direct.values()].reduce((a, b) => a + b, 0)
  chapterCounts.set(NO_CHAPTER, chapterIds.length - chaptered)
  const selectedChapters = new Set(filter.chapterIds ?? [])
  const chapters = [...chapterCounts.entries()].filter(([id, n]) => n > 0 || selectedChapters.has(id)).map(([id, count]) => ({ id, count }))
  for (const id of selectedChapters) if (!chapterCounts.has(id)) chapters.push({ id, count: 0 })

  // 知识点：题多的在前
  const knowledgeIds = matchIds(db, filter, 'knowledge')
  const knowledge = db
    .prepare(
      `SELECT kp.id, kp.name, kp.subject, COUNT(*) AS count FROM question_knowledge qk JOIN knowledge_points kp ON kp.id = qk.knowledge_id
       WHERE qk.question_id IN (SELECT value FROM json_each(?)) GROUP BY kp.id`
    )
    .all(json(knowledgeIds)) as unknown as KnowledgeCount[]
  const listed = new Set(knowledge.map((k) => k.id))
  const missing = (filter.knowledgeIds ?? []).filter((id) => !listed.has(id))
  if (missing.length) {
    const rows = db.prepare('SELECT id, name, subject FROM knowledge_points WHERE id IN (SELECT value FROM json_each(?))').all(json(missing)) as { id: number; name: string; subject: string }[]
    for (const r of rows) knowledge.push({ id: r.id, name: r.name, subject: r.subject, count: 0 })
  }
  knowledge.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))

  // 难度：档位只用 difficultyTier 换算
  const difficultyIds = matchIds(db, filter, 'difficulty')
  const tierCounts = new Map<DifficultyKey, number>()
  for (const r of db.prepare('SELECT coefficient AS d FROM question_difficulty WHERE question_id IN (SELECT value FROM json_each(?))').all(json(difficultyIds)) as { d: number }[]) {
    const tier = difficultyTier(r.d)
    if (tier) tierCounts.set(tier.key, (tierCounts.get(tier.key) ?? 0) + 1)
  }
  const difficulties = DIFFICULTY_TIERS.filter((t) => (tierCounts.get(t.key) ?? 0) > 0 || filter.difficulties?.includes(t.key)).map((t) => ({ key: t.key, count: tierCounts.get(t.key) ?? 0 }))

  // 标签
  const tagIds = matchIds(db, filter, 'tag')
  const tagCounts = new Map<number, number>()
  for (const r of db.prepare('SELECT tag_id AS id, COUNT(*) AS n FROM question_tags WHERE question_id IN (SELECT value FROM json_each(?)) GROUP BY tag_id').all(json(tagIds)) as { id: number; n: number }[]) {
    tagCounts.set(r.id, r.n)
  }
  for (const id of filter.tagIds ?? []) if (!tagCounts.has(id)) tagCounts.set(id, 0)
  const tags = [...tagCounts.entries()].map(([id, count]) => ({ id, count }))

  return { total, withAnswer, types: [...typeCounts.entries()].map(([type, count]) => ({ type, count })), chapters, knowledge, difficulties, tags }
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
  return row ? withClassification(db, [toQuestion(row)])[0] : null
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
