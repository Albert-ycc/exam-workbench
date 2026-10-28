// 归类测试：npm run test:classify
// 试题库的章节、知识点、难度、标签（筛选、各项题数、批量操作、入库补齐），试卷库的分类与标签（不进版本、不动修改时间、另存时复制）。
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { checkClassName, classNameLength, cleanClassName, difficultyTier, DIFFICULTY_TIERS, NO_CHAPTER, normalizeClassName, TAG_NAME_MAX } from '../src/shared/classify.ts'
import { openDatabase } from '../src/main/db.ts'
import { assignChapter, createChapter, deleteChapter, listChapters, moveChapter, renameChapter, sanitizeMeta, saveQuestionMeta } from '../src/main/library/classify.ts'
import { duplicateId } from '../src/main/library/dedupe.ts'
import { deleteQuestion, getQuestion, libraryFacets, listQuestionIds, listQuestions, resolveTarget, sanitizeFilter } from '../src/main/library/queries.ts'
import { createCategory, deleteCategory, listCategories, moveCategory, renameCategory, setCategory } from '../src/main/papers/classify.ts'
import { createPaper, createVersion, deletePaper, duplicatePaper, getPaper, listPapers, saveDraft } from '../src/main/papers/repo.ts'
import { changeTags, createTag, deleteTag, listTags, renameTag } from '../src/main/tags.ts'
import { makeTempDir } from './temp-dir.ts'

const dir = makeTempDir('ewb-classify-')
let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log('  ✓ ' + name)
}

try {
  const db = openDatabase(dir)
  const now = new Date().toISOString()
  db.prepare("INSERT INTO source_papers (url, title, fetched_at) VALUES ('https://zujuan.xkw.com/2p1.html', '来源卷', ?)").run(now)
  const insert = db.prepare(
    "INSERT INTO questions (zujuan_qid, source_paper_id, source_order, question_type, stem_html, fingerprint, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)"
  )
  // 10 道题：1–6 单选，7–10 解答；题干里带编号便于关键词筛选
  const q: number[] = []
  for (let i = 1; i <= 10; i++) {
    q.push(Number(insert.run(`q${i}`, i, i <= 6 ? '单选题' : '解答题-计算题', `<p>第${i}题 有理数</p>`, `fp${i}`, now).lastInsertRowid))
  }
  const ids = (filter: object): number[] => listQuestionIds(db, filter).sort((a, b) => a - b)

  check('名称规整：去首尾空白、全角空格当半角、连续空白合一、按字数截断', () => {
    assert.equal(normalizeClassName('  易错　　题  ', 20), '易错 题')
    assert.equal(normalizeClassName('　 \t', 20), '')
    assert.equal(normalizeClassName(42, 20), '')
    assert.equal(normalizeClassName('长'.repeat(30) + '😀', TAG_NAME_MAX), '长'.repeat(20))
    assert.equal(normalizeClassName('😀'.repeat(25), TAG_NAME_MAX), '😀'.repeat(20))
  })

  check('名称里的零宽与不可见字符去掉：只剩它们的名称为空，外观相同的名称规整后相同', () => {
    for (const ch of ['\u200B', '\u200C', '\u200D', '\u200E', '\u2060', '\u180E', '\u3164', '\u2800', '\uFEFF', '\u00A0', '\u0000', '\u0007']) {
      assert.equal(cleanClassName(ch), '', `U+${ch.codePointAt(0)!.toString(16)}`)
      assert.equal(cleanClassName(`易${ch}错`).replace(' ', ''), '易错', `U+${ch.codePointAt(0)!.toString(16)}`)
    }
    assert.equal(cleanClassName('易错\u200B'), '易错')
    assert.equal(cleanClassName('第一章\u200B 有理数\u2060'), '第一章 有理数')
    assert.throws(() => checkClassName('\u200B\u2060', TAG_NAME_MAX, '标签名'), /标签名不能为空/)
    // 表情里的连接符保留，整个表情算 1 个字
    assert.equal(cleanClassName('家👨‍👩‍👧‍👦'), '家👨‍👩‍👧‍👦')
    assert.equal(classNameLength('a'.repeat(19) + '👨‍👩‍👧‍👦'), 20)
    assert.equal(classNameLength('👨‍👩‍👧‍👦'.repeat(5)), 5)
    assert.equal(normalizeClassName('a'.repeat(19) + '👨‍👩‍👧‍👦' + 'b', TAG_NAME_MAX), 'a'.repeat(19) + '👨‍👩‍👧‍👦')
  })

  check('难度档位：样本里的档位与系数对应一致，边界含下限', () => {
    for (const [d, label] of [[0.95, '容易'], [0.81, '容易'], [0.8, '容易'], [0.79, '适中'], [0.65, '适中'], [0.57, '适中'], [0.4, '困难'], [0, '困难'], [1, '容易']] as const) {
      assert.equal(difficultyTier(d)?.label, label, `${d}`)
    }
    assert.equal(difficultyTier(null), null)
    assert.equal(difficultyTier(Number.NaN), null)
    // 档位首尾相接，覆盖 0–1 全段
    const sorted = [...DIFFICULTY_TIERS].sort((a, b) => a.min - b.min)
    assert.equal(sorted[0].min, 0)
    for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
    assert.ok(sorted[sorted.length - 1].max > 1)
  })

  check('入库元数据：页面读来的脏值被过滤，同一编号只留一个，最多 20 个', () => {
    const meta = sanitizeMeta({
      knowledge: [
        { id: 4740, name: ' 倒数 ', subject: 'czsx' },
        { id: 4740, name: '重复', subject: 'czsx' },
        { id: -1, name: '负编号', subject: 'czsx' },
        { id: 1.5, name: '小数', subject: 'czsx' },
        { id: 5, name: '　', subject: 'czsx' },
        { id: 6, name: '<b>x</b>', subject: 'CZ SX!' },
        'garbage',
        null,
        ...Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, name: `点${i}`, subject: 'czsx' }))
      ],
      difficulty: 1.5
    })
    assert.equal(meta.knowledge[0].name, '倒数')
    assert.equal(meta.knowledge.filter((k) => k.id === 4740).length, 1)
    assert.ok(meta.knowledge.every((k) => Number.isSafeInteger(k.id) && k.id > 0))
    assert.equal(meta.knowledge.find((k) => k.id === 6)?.subject, '')
    assert.equal(meta.knowledge.length, 20)
    assert.equal(meta.difficulty, null)
    assert.deepEqual(sanitizeMeta('x'), { knowledge: [], difficulty: null })
    assert.equal(sanitizeMeta({ difficulty: 0.65 }).difficulty, 0.65)
  })

  // 知识点：1–4「倒数」，3–6「绝对值」，7–8「有理数乘法」；难度：1–3 容易，4–6 适中，7 困难，8–10 没有
  const K = { reciprocal: { id: 4740, name: '倒数', subject: 'czsx' }, abs: { id: 4717, name: '绝对值的几何意义', subject: 'czsx' }, mul: { id: 4748, name: '两个有理数的乘法运算', subject: 'czsx' } }
  check('入库写知识点与难度：只补缺，已有的不动', () => {
    const plan: [number, object[], number | null][] = [
      [0, [K.reciprocal], 0.9], [1, [K.reciprocal], 0.85], [2, [K.reciprocal, K.abs], 0.81],
      [3, [K.reciprocal, K.abs], 0.65], [4, [K.abs], 0.6], [5, [K.abs], 0.57], [6, [K.mul], 0.4], [7, [K.mul], null]
    ]
    for (const [i, knowledge, difficulty] of plan) {
      const wrote = saveQuestionMeta(db, q[i], { knowledge, difficulty })
      assert.equal(wrote.knowledge, true)
      assert.equal(wrote.difficulty, difficulty !== null)
    }
    // 再写一次：已有的不覆盖、不追加
    assert.deepEqual(saveQuestionMeta(db, q[0], { knowledge: [K.mul], difficulty: 0.1 }), { knowledge: false, difficulty: false })
    assert.deepEqual(getQuestion(db, q[0])!.knowledge.map((k) => k.id), [K.reciprocal.id])
    assert.equal(getQuestion(db, q[0])!.difficulty, 0.9)
    // 缺难度的题补上难度，知识点不动
    assert.deepEqual(saveQuestionMeta(db, q[7], { knowledge: [K.abs], difficulty: 0.75 }), { knowledge: false, difficulty: true })
    db.prepare('DELETE FROM question_difficulty WHERE question_id = ?').run(q[7]) // 恢复「8 没有难度」的设定
  })

  check('知识点与难度只读：改不了', () => {
    assert.throws(() => db.prepare('UPDATE question_knowledge SET position = 9 WHERE question_id = ?').run(q[0]), /只读/)
    assert.throws(() => db.prepare('UPDATE question_difficulty SET coefficient = 0.1 WHERE question_id = ?').run(q[0]), /只读/)
  })

  check('题目列表带上归类，知识点按页面顺序', () => {
    const item = getQuestion(db, q[3])!
    assert.deepEqual(item.knowledge.map((k) => k.name), ['倒数', '绝对值的几何意义'])
    assert.equal(item.difficulty, 0.65)
    assert.equal(item.chapterId, null)
    assert.deepEqual(item.tags, [])
    const page = listQuestions(db, { limit: 3 })
    assert.equal(page.items.length, 3)
    assert.ok(page.items.every((x) => Array.isArray(x.knowledge) && Array.isArray(x.tags)))
  })

  // 章节：第一章（1.1、1.2），第二章；1、2 归 1.1，3 归 1.2，4 归第一章本身，5 归第二章
  let ch1 = 0, s11 = 0, s12 = 0, ch2 = 0
  check('章节：两级目录，同级重名报错，节下不能再建', () => {
    ch1 = createChapter(db, ' 第一章　有理数 ').id
    ch2 = createChapter(db, '第二章 整式').id
    s11 = createChapter(db, '1.1 正数和负数', ch1).id
    s12 = createChapter(db, '1.2 数轴', ch1).id
    assert.throws(() => createChapter(db, '第一章 有理数'), /同一级已有/)
    assert.throws(() => createChapter(db, '1.1 正数和负数', ch1), /同一级已有/)
    assert.doesNotThrow(() => deleteChapter(db, createChapter(db, '1.1 正数和负数', ch2).id)) // 不同章下可以同名
    assert.throws(() => createChapter(db, '1.1.1', s11), /两级/)
    assert.throws(() => createChapter(db, '  '), /不能为空/)
    assert.throws(() => createChapter(db, 'x', 99999), /不存在/)
    assert.throws(() => db.prepare('UPDATE chapters SET parent_id = ? WHERE id = ?').run(s11, s12), /两级/)
    assert.throws(() => db.prepare('UPDATE chapters SET parent_id = ? WHERE id = ?').run(ch2, ch1), /两级/) // 带节的章不能变成节
    assert.equal(listChapters(db).find((c) => c.id === ch1)?.name, '第一章 有理数')
  })

  check('归到章节：再归一次即移动，null 移出；章的题数含其下各节', () => {
    assert.equal(assignChapter(db, [q[0], q[1]], s11), 2)
    assignChapter(db, [q[2]], s12)
    assignChapter(db, [q[3], q[4]], ch1)
    assignChapter(db, [q[4]], ch2) // 移动
    assert.equal(assignChapter(db, [q[9], 999999], ch2), 1) // 不存在的题跳过
    assignChapter(db, [q[9]], null)
    assert.throws(() => assignChapter(db, [q[0]], 999999), /不存在/)
    const counts = Object.fromEntries(listChapters(db).map((c) => [c.id, c.count]))
    assert.deepEqual(counts, { [ch1]: 4, [s11]: 2, [s12]: 1, [ch2]: 1 })
    assert.equal(getQuestion(db, q[4])!.chapterId, ch2)
  })

  check('章节顺序：同级内调序，章在前、节紧跟其章', () => {
    moveChapter(db, ch2, 0)
    moveChapter(db, s12, -5)
    const order = listChapters(db).map((c) => c.id)
    assert.deepEqual(order, [ch2, ch1, s12, s11])
    moveChapter(db, ch2, 99)
    moveChapter(db, s12, 1)
    assert.deepEqual(listChapters(db).map((c) => c.id), [ch1, s11, s12, ch2])
    renameChapter(db, s12, '1.2 数轴（新）')
    assert.throws(() => renameChapter(db, s12, '1.1 正数和负数'), /同一级已有/)
    renameChapter(db, s12, '1.2 数轴') // 改回
  })

  // 标签：易错 1、2、7；压轴 7、8
  let wrong = 0, hard = 0
  check('题目标签：同名不分英文大小写与全角空格视为同一个，空名报错', () => {
    wrong = createTag(db, 'question', '易错').id
    assert.equal(createTag(db, 'question', ' 易错 ').id, wrong)
    const unit = createTag(db, 'question', 'Unit　1')
    assert.equal(createTag(db, 'question', 'unit 1').id, unit.id)
    hard = createTag(db, 'question', '压轴').id
    assert.throws(() => createTag(db, 'question', '　'), /不能为空/)
    assert.equal(changeTags(db, 'question', [q[0], q[1], q[6], 999999], { add: [wrong] }), 3)
    changeTags(db, 'question', [q[6], q[7]], { add: [hard] })
    changeTags(db, 'question', [q[6]], { add: [wrong] }) // 重复打不报错
    assert.deepEqual(getQuestion(db, q[6])!.tags.map((t) => t.name), ['压轴', '易错'].sort((a, b) => a.localeCompare(b, 'zh')))
    deleteTag(db, 'question', unit.id)
    assert.deepEqual(listTags(db, 'question').map((t) => [t.name, t.count]).sort(), [['压轴', 2], ['易错', 3]].sort())
  })

  check('写入时名称超长直接报错，不截断：截断后恰好同名会被悄悄并进已有标签', () => {
    const name20 = '长'.repeat(20)
    const existing = createTag(db, 'question', name20)
    assert.throws(() => createTag(db, 'question', name20 + '多'), /标签名最多 20 字/)
    assert.throws(() => renameTag(db, 'question', wrong, name20 + '多'), /最多 20 字/)
    assert.throws(() => createChapter(db, '章'.repeat(31)), /章节名最多 30 字/)
    assert.throws(() => createCategory(db, '类'.repeat(31)), /分类名最多 30 字/)
    assert.equal(createTag(db, 'question', '易错\u200B').id, wrong) // 零宽字符不造出第二个「易错」
    assert.throws(() => createChapter(db, '第一章　有理数\u200B'), /同一级已有/)
    deleteTag(db, 'question', existing.id)
  })

  check('题目标签与试卷标签各自一套：互不出现，不能混用', () => {
    const paperTag = createTag(db, 'paper', '易错')
    assert.notEqual(paperTag.id, wrong)
    assert.equal(listTags(db, 'paper').length, 1)
    assert.throws(() => changeTags(db, 'question', [q[0]], { add: [paperTag.id] }), /不存在/)
    assert.throws(() => db.prepare('INSERT INTO question_tags (question_id, tag_id) VALUES (?, ?)').run(q[0], paperTag.id), /题目标签/)
    assert.throws(() => renameTag(db, 'question', paperTag.id, 'x'), /不存在/)
    deleteTag(db, 'paper', paperTag.id)
  })

  check('筛选：章含其下各节，未归章节可与章节同选取并集', () => {
    assert.deepEqual(ids({ chapterIds: [ch1] }), [q[0], q[1], q[2], q[3]])
    assert.deepEqual(ids({ chapterIds: [s11] }), [q[0], q[1]])
    assert.deepEqual(ids({ chapterIds: [NO_CHAPTER] }), [q[5], q[6], q[7], q[8], q[9]])
    assert.deepEqual(ids({ chapterIds: [s12, NO_CHAPTER] }), [q[2], q[5], q[6], q[7], q[8], q[9]])
  })

  check('筛选：知识点、难度、标签各自多选取并集，不同项取交集，可叠加题型与关键词', () => {
    assert.deepEqual(ids({ knowledgeIds: [K.reciprocal.id] }), [q[0], q[1], q[2], q[3]])
    assert.deepEqual(ids({ knowledgeIds: [K.reciprocal.id, K.mul.id] }), [q[0], q[1], q[2], q[3], q[6], q[7]])
    assert.deepEqual(ids({ difficulties: ['easy'] }), [q[0], q[1], q[2]])
    assert.deepEqual(ids({ difficulties: ['medium', 'hard'] }), [q[3], q[4], q[5], q[6]])
    assert.deepEqual(ids({ tagIds: [wrong, hard] }), [q[0], q[1], q[6], q[7]])
    assert.deepEqual(ids({ knowledgeIds: [K.abs.id], difficulties: ['medium'] }), [q[3], q[4], q[5]])
    assert.deepEqual(ids({ knowledgeIds: [K.abs.id], difficulties: ['medium'], chapterIds: [ch1] }), [q[3]])
    assert.deepEqual(ids({ tagIds: [wrong], questionType: '解答题' }), [q[6]])
    assert.deepEqual(ids({ tagIds: [wrong], keyword: '第2题' }), [q[1]])
    assert.deepEqual(ids({ tagIds: [wrong], keyword: '第2题', difficulties: ['hard'] }), [])
    const page = listQuestions(db, { knowledgeIds: [K.reciprocal.id, K.mul.id], limit: 2, offset: 2 })
    assert.equal(page.total, 6)
    assert.equal(page.items.length, 2)
  })

  check('各项题数：本项不参与、其他条件参与；为 0 的不列，选中的以 0 列出', () => {
    const f = libraryFacets(db, { difficulties: ['easy'], knowledgeIds: [K.mul.id] })
    // 难度题数按「知识点＝乘法」算：7 困难，8 没有难度
    assert.deepEqual(f.difficulties, [{ key: 'easy', count: 0 }, { key: 'hard', count: 1 }])
    // 知识点题数按「难度＝容易」算：1–3 倒数，3 绝对值；选中的乘法以 0 列出；题多的在前
    assert.deepEqual(f.knowledge.map((k) => [k.name, k.count]), [['倒数', 3], ['绝对值的几何意义', 1], ['两个有理数的乘法运算', 0]])
    // 章节、标签、题型的题数按两项条件同时算：交集为空
    assert.deepEqual(f.types, [])
    assert.deepEqual(f.tags, [])
    assert.deepEqual(f.chapters, [])

    const all = libraryFacets(db, {})
    assert.equal(all.total, 10)
    const chapters = Object.fromEntries(all.chapters.map((c) => [c.id, c.count]))
    assert.deepEqual(chapters, { [ch1]: 4, [s11]: 2, [s12]: 1, [ch2]: 1, [NO_CHAPTER]: 5 })
    assert.deepEqual(all.difficulties, [{ key: 'easy', count: 3 }, { key: 'medium', count: 3 }, { key: 'hard', count: 1 }])
    assert.deepEqual(Object.fromEntries(all.tags.map((t) => [t.id, t.count])), { [wrong]: 3, [hard]: 2 })
    assert.deepEqual(all.types.map((t) => [t.type, t.count]).sort(), [['单选题', 6], ['解答题-计算题', 4]])

    const selectedEmpty = libraryFacets(db, { chapterIds: [s11], tagIds: [hard] })
    assert.deepEqual(selectedEmpty.chapters.find((c) => c.id === s11), { id: s11, count: 0 })
    assert.deepEqual(selectedEmpty.tags.find((t) => t.id === hard), { id: hard, count: 0 })
  })

  check('关键词路径下的各项题数与不带关键词时同一口径', () => {
    const f = libraryFacets(db, { keyword: '有理数', tagIds: [wrong] })
    assert.deepEqual(Object.fromEntries(f.tags.map((t) => [t.id, t.count])), { [wrong]: 3, [hard]: 2 })
    assert.deepEqual(f.types.map((t) => [t.type, t.count]).sort(), [['单选题', 2], ['解答题-计算题', 1]])
  })

  check('随机条件组合：筛选、分页、各项题数与朴素的逐题过滤实现完全一致（含关键词）', () => {
    const dir2 = makeTempDir('ewb-classify-rand-')
    const rdb = openDatabase(dir2)
    try {
      let seed = 20261026
      const rand = (): number => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]
      const sample = <T>(list: T[], max: number): T[] => list.filter(() => rand() < 0.4).slice(0, max)
      const stamp = new Date().toISOString()
      for (let p = 1; p <= 4; p++) rdb.prepare('INSERT INTO source_papers (url, title, fetched_at) VALUES (?, ?, ?)').run(`https://zujuan.xkw.com/2p${p}.html`, `卷${p}`, stamp)
      const types = ['单选题', '填空题', '解答题-计算题', '解答题-证明题', '']
      const words = ['有理数', '方程', '<i>OA</i>．', '函数 f(x)', '三角形', '&amp; 与 &lt;b&gt;', 'ABC']
      const insertQ = rdb.prepare('INSERT INTO questions (zujuan_qid, source_paper_id, source_order, question_type, stem_html, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const qids: number[] = []
      for (let i = 1; i <= 400; i++) {
        const stem = `<p>第${i}题 ${pick(words)} <img src="ewb-asset://${'a'.repeat(64)}.svg"> ${pick(words)}</p>`
        qids.push(Number(insertQ.run(`r${i}`, 1 + Math.floor(rand() * 4), Math.floor(rand() * 30), pick(types), stem, `rfp${i}`, stamp).lastInsertRowid))
      }
      const chapters: { id: number; parent: number | null }[] = []
      for (let c = 1; c <= 3; c++) {
        const top = createChapter(rdb, `章${c}`)
        chapters.push({ id: top.id, parent: null })
        for (let k = 1; k <= 2; k++) chapters.push({ id: createChapter(rdb, `节${c}.${k}`, top.id).id, parent: top.id })
      }
      for (const id of qids) if (rand() < 0.7) assignChapter(rdb, [id], pick(chapters).id)
      const kps = Array.from({ length: 8 }, (_, i) => ({ id: 5000 + i, name: `知识点${i}`, subject: 'czsx' }))
      for (const id of qids) saveQuestionMeta(rdb, id, { knowledge: sample(kps, 3), difficulty: rand() < 0.8 ? Math.round(rand() * 100) / 100 : null })
      const tagIds = ['甲', '乙', '丙', '丁', '戊'].map((name) => createTag(rdb, 'question', name).id)
      for (const id of qids) {
        const chosen = sample(tagIds, 3)
        if (chosen.length) changeTags(rdb, 'question', [id], { add: chosen })
      }

      // 朴素实现：把附表整张读进 JS，逐题判断
      const rows = rdb.prepare('SELECT id, source_paper_id AS sp, source_order AS so, question_type AS type, stem_html AS stem FROM questions').all() as { id: number; sp: number; so: number; type: string; stem: string }[]
      const group = (sql: string): Map<number, number[]> => {
        const m = new Map<number, number[]>()
        for (const r of rdb.prepare(sql).all() as { q: number; v: number }[]) m.set(r.q, [...(m.get(r.q) ?? []), r.v])
        return m
      }
      const chapterOf = group('SELECT question_id AS q, chapter_id AS v FROM question_chapter')
      const knowledgeOf = group('SELECT question_id AS q, knowledge_id AS v FROM question_knowledge')
      const tagOf = group('SELECT question_id AS q, tag_id AS v FROM question_tags')
      const coefOf = new Map((rdb.prepare('SELECT question_id AS q, coefficient AS c FROM question_difficulty').all() as { q: number; c: number }[]).map((r) => [r.q, r.c]))
      const parentOf = new Map(chapters.map((c) => [c.id, c.parent]))
      const textOf = (html: string): string =>
        html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').toLowerCase()
      type F = { questionType?: string; sourcePaperId?: number; keyword?: string; ids?: number[]; chapterIds?: number[]; knowledgeIds?: number[]; difficulties?: ('easy' | 'medium' | 'hard')[]; tagIds?: number[] }
      type Row = (typeof rows)[number]
      const passes = (r: Row, f: F, skip: string | null): boolean => {
        if (skip !== 'type' && f.questionType && !(r.type === f.questionType || r.type.startsWith(f.questionType + '-'))) return false
        if (f.sourcePaperId !== undefined && r.sp !== f.sourcePaperId) return false
        if (f.ids && !f.ids.includes(r.id)) return false
        if (f.keyword && !textOf(r.stem).includes(f.keyword.replace(/\s+/g, ' ').toLowerCase())) return false
        if (skip !== 'chapter' && f.chapterIds) {
          const own = chapterOf.get(r.id) ?? []
          const hit = f.chapterIds.some((c) => (c === NO_CHAPTER ? own.length === 0 : own.some((o) => o === c || parentOf.get(o) === c)))
          if (!hit) return false
        }
        if (skip !== 'knowledge' && f.knowledgeIds && !(knowledgeOf.get(r.id) ?? []).some((k) => f.knowledgeIds!.includes(k))) return false
        if (skip !== 'difficulty' && f.difficulties) {
          const tier = difficultyTier(coefOf.get(r.id))
          if (!tier || !f.difficulties.includes(tier.key)) return false
        }
        if (skip !== 'tag' && f.tagIds && !(tagOf.get(r.id) ?? []).some((t) => f.tagIds!.includes(t))) return false
        return true
      }
      const ordered = [...rows].sort((a, b) => b.sp - a.sp || a.so - b.so || a.id - b.id)
      const naiveIds = (f: F, skip: string | null = null): number[] => ordered.filter((r) => passes(r, f, skip)).map((r) => r.id)
      const kpName = new Map(kps.map((k) => [k.id, k.name]))

      const randomFilter = (): F => {
        const f: F = {}
        if (rand() < 0.3) f.questionType = pick(['单选题', '解答题', '解答题-证明题', '填空题'])
        if (rand() < 0.15) f.sourcePaperId = 1 + Math.floor(rand() * 4)
        if (rand() < 0.5) f.keyword = pick(['有理数', '方程', '<i>', 'oa．', '函数  F(x)', '&', '<b>', '第1', 'abc', '没有这个词'])
        if (rand() < 0.15) f.ids = qids.filter(() => rand() < 0.5)
        if (rand() < 0.35) f.chapterIds = sample([...chapters.map((c) => c.id), NO_CHAPTER], 3).concat(rand() < 0.3 ? [NO_CHAPTER] : [])
        if (f.chapterIds && f.chapterIds.length === 0) delete f.chapterIds
        if (rand() < 0.35) f.knowledgeIds = sample(kps.map((k) => k.id), 3)
        if (rand() < 0.35) f.difficulties = sample(['easy', 'medium', 'hard'] as const, 2)
        if (rand() < 0.35) f.tagIds = sample(tagIds, 3)
        for (const key of ['knowledgeIds', 'difficulties', 'tagIds'] as const) if (f[key]?.length === 0) delete f[key]
        return f
      }

      const sortById = <T extends { id: number }>(list: T[]): T[] => [...list].sort((a, b) => a.id - b.id)
      let nonEmpty = 0
      for (let round = 0; round < 300; round++) {
        const f = randomFilter()
        const expected = naiveIds(f)
        if (expected.length > 0 && expected.length < rows.length) nonEmpty++
        assert.deepEqual(listQuestionIds(rdb, f), expected, `ids ${JSON.stringify(f)}`)
        const offset = Math.floor(rand() * 40)
        const limit = 1 + Math.floor(rand() * 60)
        const page = listQuestions(rdb, { ...f, offset, limit })
        assert.equal(page.total, expected.length, `total ${JSON.stringify(f)}`)
        assert.deepEqual(page.items.map((i) => i.id), expected.slice(offset, offset + limit), `page ${JSON.stringify(f)}`)

        const facets = libraryFacets(rdb, f)
        const typeCount = new Map<string, number>()
        for (const id of naiveIds(f, 'type')) typeCount.set(rows.find((r) => r.id === id)!.type, (typeCount.get(rows.find((r) => r.id === id)!.type) ?? 0) + 1)
        assert.deepEqual(
          facets.types.map((t) => [t.type, t.count]).sort(),
          [...typeCount.entries()].sort(),
          `types ${JSON.stringify(f)}`
        )

        const chapterCount = new Map<number, number>()
        for (const id of naiveIds(f, 'chapter')) {
          const own = chapterOf.get(id) ?? []
          if (own.length === 0) chapterCount.set(NO_CHAPTER, (chapterCount.get(NO_CHAPTER) ?? 0) + 1)
          for (const c of own) {
            chapterCount.set(c, (chapterCount.get(c) ?? 0) + 1)
            const parent = parentOf.get(c)
            if (parent != null) chapterCount.set(parent, (chapterCount.get(parent) ?? 0) + 1)
          }
        }
        for (const c of f.chapterIds ?? []) if (!chapterCount.has(c)) chapterCount.set(c, 0)
        assert.deepEqual(
          sortById(facets.chapters),
          sortById([...chapterCount.entries()].map(([id, count]) => ({ id, count }))),
          `chapters ${JSON.stringify(f)}`
        )

        const knowledgeCount = new Map<number, number>()
        for (const id of naiveIds(f, 'knowledge')) for (const k of knowledgeOf.get(id) ?? []) knowledgeCount.set(k, (knowledgeCount.get(k) ?? 0) + 1)
        for (const k of f.knowledgeIds ?? []) if (!knowledgeCount.has(k)) knowledgeCount.set(k, 0)
        const expectedKnowledge = [...knowledgeCount.entries()]
          .map(([id, count]) => ({ id, name: kpName.get(id)!, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
        assert.deepEqual(facets.knowledge.map((k) => ({ id: k.id, name: k.name, count: k.count })), expectedKnowledge, `knowledge ${JSON.stringify(f)}`)

        const expectedDifficulties = DIFFICULTY_TIERS.map((t) => ({
          key: t.key,
          count: naiveIds(f, 'difficulty').filter((id) => difficultyTier(coefOf.get(id))?.key === t.key).length
        })).filter((t) => t.count > 0 || f.difficulties?.includes(t.key))
        assert.deepEqual(facets.difficulties, expectedDifficulties, `difficulties ${JSON.stringify(f)}`)

        const tagCount = new Map<number, number>()
        for (const id of naiveIds(f, 'tag')) for (const t of tagOf.get(id) ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
        for (const t of f.tagIds ?? []) if (!tagCount.has(t)) tagCount.set(t, 0)
        assert.deepEqual(sortById(facets.tags), sortById([...tagCount.entries()].map(([id, count]) => ({ id, count }))), `tags ${JSON.stringify(f)}`)
      }
      assert.ok(nonEmpty > 100, `随机条件要有足够多既非空也非全库的组合，实际 ${nonEmpty}`)
    } finally {
      rdb.close()
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  check('界面传来的筛选参数不可信：类型不对按没设，不抛原始错误', () => {
    const f = sanitizeFilter({ chapterIds: 'x', knowledgeIds: [1, '2', null, 1.5, 4740, 4740], difficulties: ['easy', 'evil', 3], tagIds: [], ids: {} })
    assert.equal(f.chapterIds, undefined)
    assert.deepEqual(f.knowledgeIds, [1, 4740])
    assert.deepEqual(f.difficulties, ['easy'])
    assert.equal(f.tagIds, undefined)
    assert.doesNotThrow(() => libraryFacets(db, { chapterIds: [{}], difficulties: [null], knowledgeIds: Array.from({ length: 5000 }, (_, i) => i) } as never))
    assert.doesNotThrow(() => listQuestions(db, { tagIds: "1) OR 1=1 --" } as never))
    assert.equal(listQuestions(db, { tagIds: [999999] }).total, 0)
  })

  check('批量操作的条件不完整就拒绝，不会退化成全库', () => {
    for (const bad of [{ tagIds: ['x'] }, { chapterIds: 'x' }, { difficulties: ['evil'] }, { keyword: '   ' }, { a: { b: {} } }, [], 'x', null]) {
      assert.throws(() => resolveTarget(db, { filter: bad }), /筛选条件不正确/, JSON.stringify(bad))
    }
    assert.equal(resolveTarget(db, { filter: {} }).length, 10) // 空条件就是全库，界面「全选筛出的全部」在不设条件时传的就是它
    assert.deepEqual(resolveTarget(db, { filter: { knowledgeIds: [K.mul.id, 'x'] } }).sort((a, b) => a - b), [q[6], q[7]]) // 部分无效只会缩小范围
  })

  check('分页参数超出安全整数不报英文错误', () => {
    assert.doesNotThrow(() => listQuestions(db, { offset: 1e21, limit: 1e21 }))
    assert.equal(listQuestions(db, { offset: 1e21 }).items.length, 0)
    assert.equal(listQuestions(db, { offset: -5, limit: 2 }).items.length, 2)
  })

  check('关键词按纯文本匹配，字被内联标签隔开也能找到', () => {
    const id = Number(insert.run('q-inline', 99, '单选题', '<p>如图，<i>O</i><i>A</i>．<b>x</b>&lt;1</p>', 'fp-inline', now).lastInsertRowid)
    assert.deepEqual(ids({ keyword: 'OA．' }), [id])
    assert.deepEqual(ids({ keyword: 'x<1' }), [id])
    assert.deepEqual(ids({ keyword: '<i>' }), [])
    deleteQuestion(db, id)
  })

  check('批量操作对象：勾选的题原样用，按条件的不受分页影响', () => {
    assert.deepEqual(resolveTarget(db, { ids: [q[0], q[0], 'x', 2.5] }), [q[0]])
    assert.deepEqual(resolveTarget(db, { filter: { knowledgeIds: [K.abs.id], limit: 1 } }).sort((a, b) => a - b), [q[2], q[3], q[4], q[5]])
    assert.throws(() => resolveTarget(db, null), /没有指定/)
    // 「全选筛出的 N 道」打标签：按条件一次打上
    const exam = createTag(db, 'question', '期中复习').id
    assert.equal(changeTags(db, 'question', resolveTarget(db, { filter: { chapterIds: [ch1] } }), { add: [exam] }), 4)
    assert.deepEqual(ids({ tagIds: [exam] }), [q[0], q[1], q[2], q[3]])
    changeTags(db, 'question', resolveTarget(db, { filter: { tagIds: [exam] } }), { remove: [exam] })
    assert.deepEqual(ids({ tagIds: [exam] }), [])
    deleteTag(db, 'question', exam)
  })

  check('标签改名：改成已有名称即合并，题不重复；只改英文大小写不算合并', () => {
    const a = createTag(db, 'question', '好题').id
    changeTags(db, 'question', [q[0], q[8]], { add: [a] })
    const result = renameTag(db, 'question', a, ' 易错 ')
    assert.deepEqual(result, { id: wrong, mergedInto: wrong })
    assert.deepEqual(ids({ tagIds: [wrong] }), [q[0], q[1], q[6], q[8]])
    assert.equal(listTags(db, 'question').some((t) => t.id === a), false)
    const en = createTag(db, 'question', 'hard').id
    assert.deepEqual(renameTag(db, 'question', en, 'HARD'), { id: en, mergedInto: null })
    assert.equal(listTags(db, 'question').find((t) => t.id === en)?.name, 'HARD')
    deleteTag(db, 'question', en)
    changeTags(db, 'question', [q[8]], { remove: [wrong] })
  })

  check('删除章节：连同其下各节，题回到「未归章节」；删除原题时归类一并删除', () => {
    const tmp = createChapter(db, '临时章').id
    const tmpSec = createChapter(db, '临时节', tmp).id
    assignChapter(db, [q[8]], tmp)
    assignChapter(db, [q[9]], tmpSec)
    assert.deepEqual(deleteChapter(db, tmp), { questions: 2 })
    assert.equal(listChapters(db).some((c) => c.id === tmp || c.id === tmpSec), false)
    assert.equal(getQuestion(db, q[8])!.chapterId, null)
    assert.deepEqual(listChapters(db).filter((c) => c.parentId === null).map((c) => c.position), [0, 1]) // 顺序号重排连续

    deleteQuestion(db, q[0])
    for (const table of ['question_knowledge', 'question_difficulty', 'question_chapter', 'question_tags']) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE question_id = ?`).get(q[0]) as { n: number }).n, 0, table)
    }
    assert.equal(listChapters(db).find((c) => c.id === s11)?.count, 1)
  })

  check('已在库的题按编号或内容指纹找到，用于补齐', () => {
    assert.equal(duplicateId(db, 'q2', 'whatever'), q[1])
    assert.equal(duplicateId(db, null, 'fp3'), q[2]) // 无编号的题按内容指纹算重复
    db.prepare("INSERT INTO questions (stem_html, fingerprint, created_at) VALUES ('无编号', 'fp-x', ?)").run(now)
    const noQid = (db.prepare("SELECT id FROM questions WHERE fingerprint = 'fp-x'").get() as { id: number }).id
    assert.equal(duplicateId(db, null, 'fp-x'), noQid)
    assert.equal(duplicateId(db, 'new-qid', 'fp-x'), noQid)
    assert.equal(duplicateId(db, 'new-qid', 'fp-none'), null)
  })

  // ---------- 试卷库 ----------

  check('试卷分类：重名报错、调序、删除后试卷回到未分类', () => {
    const weekly = createCategory(db, '周测')
    const daily = createCategory(db, ' 每日练习 ')
    assert.equal(daily.name, '每日练习')
    assert.throws(() => createCategory(db, '周测'), /已有分类/)
    assert.throws(() => renameCategory(db, daily.id, '周测'), /已有分类/)
    assert.throws(() => createCategory(db, ''), /不能为空/)
    moveCategory(db, daily.id, 0)
    assert.deepEqual(listCategories(db).map((c) => c.name), ['每日练习', '周测'])
    const p1 = createPaper(db, '第1练', { categoryId: daily.id })
    const p2 = createPaper(db, '第2练', { categoryId: daily.id })
    assert.throws(() => createPaper(db, '无效分类', { categoryId: 99999 }), /不存在/)
    assert.equal(listCategories(db).find((c) => c.id === daily.id)?.count, 2)
    assert.deepEqual(deleteCategory(db, daily.id), { papers: 2 })
    assert.ok(listPapers(db).filter((p) => p.id === p1 || p.id === p2).every((p) => p.categoryId === null))
    assert.deepEqual(listCategories(db).map((c) => [c.name, c.position]), [['周测', 0]])
    deleteCategory(db, weekly.id)
    deletePaper(db, p1)
    deletePaper(db, p2)
  })

  check('分类与标签只用于整理：不改修改时间、不产生「有改动未存为版本」、不进版本快照', () => {
    const cat = createCategory(db, '单元测试')
    const pid = createPaper(db, '第一单元测试')
    saveDraft(db, pid, { sections: [] })
    createVersion(db, pid, 'manual', '')
    // 毫秒时钟在同一毫秒内分不出先后：把修改时间固定到很早，操作后任何写 updated_at 的实现都会让它变化
    const FIXED = '2000-01-01T00:00:00.000Z'
    db.prepare('UPDATE papers SET updated_at = ? WHERE id = ?').run(FIXED, pid)
    const before = getPaper(db, pid)
    assert.equal(before.updatedAt, FIXED)
    assert.equal(before.draftDirty, false)
    const tag = createTag(db, 'paper', '7(3)班')
    setCategory(db, [pid], cat.id)
    changeTags(db, 'paper', [pid], { add: [tag.id] })
    const after = getPaper(db, pid)
    assert.equal(after.updatedAt, FIXED)
    assert.equal(after.draftDirty, false)
    const summary = listPapers(db).find((p) => p.id === pid)!
    assert.equal(summary.categoryId, cat.id)
    assert.deepEqual(summary.tags, [{ id: tag.id, name: '7(3)班' }])
    const snapshot = (db.prepare('SELECT snapshot_json FROM paper_versions WHERE paper_id = ?').get(pid) as { snapshot_json: string }).snapshot_json
    assert.ok(!/category|tags|7\(3\)班/.test(snapshot), snapshot)
    assert.throws(() => setCategory(db, [pid], 99999), /不存在/)
    setCategory(db, [pid, 99999], null) // 不存在的试卷跳过
    assert.equal(listPapers(db).find((p) => p.id === pid)!.categoryId, null)
  })

  check('另存为新试卷：分类与标签一起复制；删除试卷时标签关联一并删除', () => {
    const cat = createCategory(db, '期中')
    const pid = createPaper(db, '期中卷', { categoryId: cat.id })
    const t1 = createTag(db, 'paper', 'A卷')
    const t2 = createTag(db, 'paper', '7(1)班')
    changeTags(db, 'paper', [pid], { add: [t1.id, t2.id] })
    const copy = duplicatePaper(db, pid)
    const s = listPapers(db).find((p) => p.id === copy)!
    assert.equal(s.categoryId, cat.id)
    assert.deepEqual(s.tags.map((t) => t.id).sort(), [t1.id, t2.id].sort())
    deletePaper(db, copy)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM paper_tags WHERE paper_id = ?').get(copy) as { n: number }).n, 0)
    assert.equal(listTags(db, 'paper').find((t) => t.id === t1.id)?.count, 1)
  })

  db.close()
  console.log(`归类测试通过：${passed} 项`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
