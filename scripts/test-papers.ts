// 试卷与版本逻辑测试：npm run test:papers
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/main/db.ts'
import {
  createPaper,
  createVersion,
  deletePaper,
  duplicatePaper,
  ensureVersionForDownload,
  getPaper,
  getVersion,
  listPapers,
  listVersions,
  recordExport,
  renamePaper,
  restoreVersion,
  saveDraft
} from '../src/main/papers/repo.ts'

const dir = mkdtempSync(join(tmpdir(), 'ewb-papers-'))
let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log('  ✓ ' + name)
}

const item = (id: string, stem: string) => ({ id, originQuestionId: 1, sourceLabel: '来源', questionType: '单选题', numberCount: 1, stemHtml: stem, answerHtml: null })
const draftWith = (...stems: string[]) => ({ sections: [{ id: 's1', title: '单选题', items: stems.map((s, i) => item(`i${i}`, s)) }] })
const options = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false } as const

try {
  const db = openDatabase(dir)
  const id = createPaper(db, '  第一单元测试 ')

  check('新试卷标题去掉首尾空格，没有版本时视为有改动', () => {
    const p = getPaper(db, id)
    assert.equal(p.title, '第一单元测试')
    assert.equal(p.latestVersionNo, null)
    assert.equal(p.draftDirty, true)
  })

  check('第一次下载自动存 v1，内容不变时再次下载沿用 v1', () => {
    saveDraft(db, id, draftWith('A'))
    const first = ensureVersionForDownload(db, id, '下载 学生版 PDF')
    assert.equal(first.created, true)
    assert.equal(first.version.versionNo, 1)
    assert.equal(first.version.origin, 'download')
    const again = ensureVersionForDownload(db, id, '下载 学生版 PDF')
    assert.equal(again.created, false)
    assert.equal(again.version.versionNo, 1)
    assert.equal(getPaper(db, id).draftDirty, false)
  })

  check('字段顺序不同但内容相同的草稿不算改动', () => {
    const reordered = { sections: [{ items: [{ answerHtml: null, stemHtml: 'A', numberCount: 1, questionType: '单选题', sourceLabel: '来源', originQuestionId: 1, id: 'i0' }], title: '单选题', id: 's1' }] }
    assert.equal(saveDraft(db, id, reordered).draftDirty, false)
  })

  check('改题后草稿变为有改动，改标题也算改动', () => {
    assert.equal(saveDraft(db, id, draftWith('A2')).draftDirty, true)
    createVersion(db, id, 'manual', '改了第一题')
    assert.equal(getPaper(db, id).draftDirty, false)
    renamePaper(db, id, '第一单元测试（修订）')
    assert.equal(getPaper(db, id).draftDirty, true)
  })

  check('恢复 v1：先自动保存当前草稿为 v3，恢复后草稿等于 v1，已有版本不变', () => {
    const v1 = listVersions(db, id).find((v) => v.versionNo === 1)!
    const v2Before = getVersion(db, listVersions(db, id).find((v) => v.versionNo === 2)!.id)
    const restored = restoreVersion(db, id, v1.id)
    const versions = listVersions(db, id)
    assert.deepEqual(versions.map((v) => v.versionNo), [3, 2, 1])
    assert.equal(versions[0].origin, 'before_restore')
    assert.equal(versions[0].note, '恢复 v1 前自动保存')
    assert.equal(restored.title, '第一单元测试')
    assert.equal(restored.draft.sections[0].items[0].stemHtml, 'A')
    assert.deepEqual(getVersion(db, v2Before.id).snapshot, v2Before.snapshot)
    // 恢复后的草稿与最新版本 v3 不同，再存版本得到 v4
    assert.equal(restored.draftDirty, true)
    assert.equal(createVersion(db, id, 'manual', '').versionNo, 4)
  })

  check('草稿没有未存改动时恢复不额外存版本', () => {
    const v2 = listVersions(db, id).find((v) => v.versionNo === 2)!
    restoreVersion(db, id, v2.id)
    assert.equal(listVersions(db, id)[0].versionNo, 4)
  })

  check('下载记录挂在版本上，随版本列表返回', () => {
    const v4 = listVersions(db, id)[0]
    recordExport(db, v4.id, 'pdf', options, '/tmp/x_v4_学生版.pdf')
    const listed = listVersions(db, id)[0]
    assert.equal(listed.exports.length, 1)
    assert.equal(listed.exports[0].options.format, 'pdf')
  })

  check('格式不正确的草稿被拒绝', () => {
    assert.throws(() => saveDraft(db, id, { sections: [{ id: 's', items: [{ stemHtml: 1 }] }] }), /草稿格式不正确/)
    assert.throws(() => saveDraft(db, id, { nope: true }), /草稿格式不正确/)
  })

  check('试卷标题超过 100 字时截断（按字符计，emoji 不被拆开）', () => {
    const longId = createPaper(db, '长'.repeat(300))
    assert.equal(getPaper(db, longId).title.length, 100)
    renamePaper(db, longId, '😀'.repeat(150))
    assert.equal(Array.from(getPaper(db, longId).title).length, 100)
    deletePaper(db, longId)
  })

  check('试卷列表统计题目数与最新版本号', () => {
    const [summary] = listPapers(db)
    assert.equal(summary.latestVersionNo, 4)
    assert.equal(summary.structure.questionCount, 1)
  })

  check('设了分值后才出现在草稿里；没设分值的旧草稿保存后仍与原版本一致', () => {
    const pid = createPaper(db, '分值')
    saveDraft(db, pid, draftWith('Q'))
    createVersion(db, pid, 'manual', '')
    const stored = (db.prepare('SELECT draft_json FROM papers WHERE id = ?').get(pid) as { draft_json: string }).draft_json
    assert.ok(!stored.includes('score'), '未设分值时不写入 score 字段')
    assert.equal(saveDraft(db, pid, { sections: [{ id: 's1', title: '单选题', defaultScore: null, items: [{ ...item('i0', 'Q'), score: null }] }] }).draftDirty, false)
    assert.equal(saveDraft(db, pid, { sections: [{ id: 's1', title: '单选题', defaultScore: 4, items: [item('i0', 'Q')] }] }).draftDirty, true)
    const draft = getPaper(db, pid).draft
    assert.equal(draft.sections[0].defaultScore, 4)
    assert.equal(saveDraft(db, pid, { sections: [{ id: 's1', title: '单选题', defaultScore: 4.26, items: [{ ...item('i0', 'Q'), score: -3 }] }] }).draftDirty, true)
    const cleaned = getPaper(db, pid).draft.sections[0]
    assert.equal(cleaned.defaultScore, 4.5, '分值按 0.5 取整')
    assert.equal(cleaned.items[0].score, undefined, '负分视为未设')
    deletePaper(db, pid)
  })

  check('试卷库摘要按题号计数并合计分值，版本带结构摘要', () => {
    const pid = createPaper(db, '结构')
    saveDraft(db, pid, {
      sections: [
        { id: 'a', title: '单选题', defaultScore: 4, items: [item('a1', 'x'), item('a2', 'y')] },
        { id: 'b', title: '完形填空', defaultScore: 1, items: [{ ...item('b1', 'z'), numberCount: 15 }] }
      ]
    })
    const summary = listPapers(db).find((p) => p.id === pid)!
    assert.deepEqual(summary.structure, { sectionCount: 2, questionCount: 17, totalScore: 23, unscoredCount: 0 })
    assert.equal(summary.draftDirty, true)
    const v = createVersion(db, pid, 'manual', '')
    assert.deepEqual(v.structure, { sectionCount: 2, questionCount: 17, totalScore: 23, unscoredCount: 0 })
    deletePaper(db, pid)
  })

  check('另存为新试卷：从草稿或历史版本复制，新试卷没有版本，原试卷不变', () => {
    const pid = createPaper(db, '期中卷')
    saveDraft(db, pid, draftWith('原题'))
    const v1 = createVersion(db, pid, 'manual', '')
    saveDraft(db, pid, draftWith('改过'))
    const fromDraft = duplicatePaper(db, pid)
    const fromV1 = duplicatePaper(db, pid, { versionId: v1.id, title: '期中卷 B 卷' })
    assert.equal(getPaper(db, fromDraft).title, '期中卷（副本）')
    assert.equal(getPaper(db, fromDraft).draft.sections[0].items[0].stemHtml, '改过')
    assert.equal(getPaper(db, fromV1).title, '期中卷 B 卷')
    assert.equal(getPaper(db, fromV1).draft.sections[0].items[0].stemHtml, '原题')
    assert.equal(getPaper(db, fromV1).latestVersionNo, null)
    assert.equal(listVersions(db, pid).length, 1)
    const other = createPaper(db, '别的卷')
    assert.throws(() => duplicatePaper(db, other, { versionId: v1.id }), /不属于/)
    for (const x of [pid, fromDraft, fromV1, other]) deletePaper(db, x)
  })

  check('目标满分存在草稿里，改它不算试卷内容改动；超大小题数被截到上限', () => {
    const pid = createPaper(db, '目标')
    saveDraft(db, pid, draftWith('Q'))
    createVersion(db, pid, 'manual', '')
    assert.equal(saveDraft(db, pid, { ...draftWith('Q'), targetScore: 100 }).draftDirty, false)
    assert.equal(getPaper(db, pid).draft.targetScore, 100)
    const v1 = listVersions(db, pid)[0]
    saveDraft(db, pid, { ...draftWith('Q2'), targetScore: 100 })
    assert.equal(restoreVersion(db, pid, v1.id).draft.targetScore, 100, '恢复版本保留目标满分')
    saveDraft(db, pid, { sections: [{ id: 's1', title: '', items: [{ ...item('i0', 'Q'), numberCount: 99999 }] }] })
    assert.equal(getPaper(db, pid).draft.sections[0].items[0].numberCount, 500)
    deletePaper(db, pid)
  })

  check('下载记录区分试卷与答题卡，默认是试卷', () => {
    const pid = createPaper(db, '记录')
    saveDraft(db, pid, draftWith('Q'))
    const v = createVersion(db, pid, 'manual', '')
    assert.equal(recordExport(db, v.id, 'pdf', options, '/tmp/a.pdf').kind, 'paper')
    assert.equal(recordExport(db, v.id, 'pdf', options, '/tmp/a_答题卡.pdf', 'answer-sheet').kind, 'answer-sheet')
    assert.throws(() => recordExport(db, v.id, 'pdf', options, '/tmp/x.pdf', 'poster' as never), /CHECK/)
    const again = recordExport(db, v.id, 'pdf', { ...options, answerArea: true }, '/tmp/a.pdf')
    const records = listVersions(db, pid)[0].exports
    assert.equal(records.filter((r) => r.filePath === '/tmp/a.pdf' && r.kind === 'paper').length, 1, '覆盖同一文件只留一条记录')
    assert.equal(again.options.answerArea, true, '记录更新为最近一次的配置')
    deletePaper(db, pid)
  })

  check('题目 id、大题 id 重复的草稿保存时被拒绝；库里已有的重复数据读出时换新 id', () => {
    const pid = createPaper(db, '重复')
    saveDraft(db, pid, draftWith('Q'))
    const before = getPaper(db, pid).draft
    const dupItem = { sections: [{ id: 's1', title: '', items: [item('x', 'A'), item('x', 'B')] }] }
    const dupAcross = { sections: [{ id: 's1', title: '', items: [item('x', 'A')] }, { id: 's2', title: '', items: [item('x', 'B')] }] }
    const dupSection = { sections: [{ id: 's1', title: '', items: [] }, { id: 's1', title: '', items: [] }] }
    for (const d of [dupItem, dupAcross, dupSection]) assert.throws(() => saveDraft(db, pid, d), /id 重复/)
    assert.deepEqual(getPaper(db, pid).draft, before, '被拒绝的草稿不落库')
    // 模拟 0.3.0 之前留下的重复数据：直接写库
    db.prepare('UPDATE papers SET draft_json = ? WHERE id = ?').run(JSON.stringify(dupItem), pid)
    const items = getPaper(db, pid).draft.sections[0].items
    assert.equal(items.length, 2, '两份都保留')
    assert.equal(items[0].id, 'x', '第一份保留原 id')
    assert.notEqual(items[1].id, 'x', '重复的那份换新 id')
    assert.deepEqual(items.map((i) => i.stemHtml), ['A', 'B'])
    saveDraft(db, pid, getPaper(db, pid).draft)
    deletePaper(db, pid)
  })

  check('删除试卷连带删除版本与下载记录', () => {
    deletePaper(db, id)
    const left = db.prepare('SELECT (SELECT COUNT(*) FROM paper_versions) AS v, (SELECT COUNT(*) FROM exports) AS e').get() as { v: number; e: number }
    assert.deepEqual({ ...left }, { v: 0, e: 0 })
  })

  db.close()
  console.log(`试卷与版本测试通过：${passed} 项`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
