// 编辑器自动保存用到的数据操作：标题与草稿同事务写入，任何一项不合法都不留下半截改动（只需 node，不启动界面）
// 用法：node test/e2e/editor-repo.e2e.ts
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { build } from 'esbuild'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../scripts/temp-dir.ts'
import { openDatabase } from '../../src/main/db.ts'
import { createPaper, createVersion, duplicatePaper, getPaper, listPapers, renamePaper, saveEdits } from '../../src/main/papers/repo.ts'

const dir = makeTempDir('ewb-editor-repo-')
let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const item = (id: string, stem: string) => ({ id, originQuestionId: 7, sourceLabel: '来源', questionType: '单选题', numberCount: 1, stemHtml: stem, answerHtml: null })
const draftWith = (...stems: string[]) => ({ sections: [{ id: 's1', title: '单选题', items: stems.map((s, i) => item(`i${i}`, s)) }] })

try {
  const db = openDatabase(dir)
  const id = createPaper(db, '原标题')

  check('只改草稿：标题不变，返回相对最新版本的改动状态', () => {
    const result = saveEdits(db, id, { draft: draftWith('A') })
    assert.equal(result.draftDirty, true)
    assert.equal(getPaper(db, id).title, '原标题')
    assert.equal(getPaper(db, id).draft.sections[0].items[0].stemHtml, 'A')
  })

  check('只改标题：草稿不变；存版本后改标题算有改动', () => {
    createVersion(db, id, 'manual', '')
    assert.equal(getPaper(db, id).draftDirty, false)
    const result = saveEdits(db, id, { title: '  新标题 ' })
    assert.equal(result.draftDirty, true)
    assert.equal(getPaper(db, id).title, '新标题')
    assert.equal(getPaper(db, id).draft.sections[0].items[0].stemHtml, 'A')
  })

  check('标题与草稿一起写入', () => {
    saveEdits(db, id, { title: '标题 2', draft: draftWith('A', 'B') })
    const paper = getPaper(db, id)
    assert.equal(paper.title, '标题 2')
    assert.equal(paper.draft.sections[0].items.length, 2)
  })

  check('标题为空时整次保存被拒绝，草稿也不写入', () => {
    assert.throws(() => saveEdits(db, id, { title: '   ', draft: draftWith('C') }), /试卷标题不能为空/)
    const paper = getPaper(db, id)
    assert.equal(paper.title, '标题 2')
    assert.equal(paper.draft.sections[0].items.length, 2)
  })

  check('草稿格式不对时整次保存被拒绝，标题也不写入', () => {
    assert.throws(() => saveEdits(db, id, { title: '不该生效', draft: { sections: [{ id: 's', items: [{ stemHtml: 1 }] }] } }), /草稿格式不正确/)
    assert.equal(getPaper(db, id).title, '标题 2')
  })

  check('改回与最新版本相同的内容后不再算有改动', () => {
    const v = getPaper(db, id)
    assert.equal(v.draftDirty, true)
    renamePaper(db, id, '原标题')
    saveEdits(db, id, { draft: draftWith('A') })
    assert.equal(getPaper(db, id).draftDirty, false)
  })

  check('试卷不存在时报错', () => {
    assert.throws(() => saveEdits(db, 99999, { title: 'x' }), /试卷不存在/)
  })

  check('分值与目标满分随草稿保存读回；只改目标满分不算试卷改动，也不进版本快照', () => {
    const scored = {
      sections: [{ id: 's1', title: '单选题', defaultScore: 4, items: [{ ...item('i0', 'A'), score: 6 }, item('i1', 'B')] }],
      targetScore: 100
    }
    saveEdits(db, id, { draft: scored })
    const paper = getPaper(db, id)
    assert.equal(paper.draft.sections[0].defaultScore, 4)
    assert.equal(paper.draft.sections[0].items[0].score, 6)
    assert.equal(paper.draft.targetScore, 100)
    createVersion(db, id, 'manual', '带分值')
    assert.equal(getPaper(db, id).draftDirty, false)
    saveEdits(db, id, { draft: { ...scored, targetScore: 80 } })
    assert.equal(getPaper(db, id).draftDirty, false, '改目标满分不算改动')
    saveEdits(db, id, { draft: { ...scored, sections: [{ ...scored.sections[0], defaultScore: 5 }], targetScore: 80 } })
    assert.equal(getPaper(db, id).draftDirty, true, '改每小题分值算改动')
  })

  check('另存为新试卷带走分值与目标满分，没有版本；摘要按题号数与分值合计', () => {
    const copyId = duplicatePaper(db, id)
    const copy = getPaper(db, copyId)
    assert.equal(copy.latestVersionNo, null)
    assert.equal(copy.draft.sections[0].defaultScore, 5)
    const summary = listPapers(db).find((p) => p.id === copyId)!
    assert.deepEqual({ ...summary.structure }, { sectionCount: 1, questionCount: 2, totalScore: 11, unscoredCount: 0 }, 'i0 单独 6 分 + i1 跟随 5 分')
  })

  // 草稿的纯函数操作在界面目录里，用 esbuild 打成一个文件在 node 里直接跑
  const ops = await (async () => {
    const outfile = join(dir, 'draftOps.mjs')
    await build({
      entryPoints: [resolve('src/renderer/src/components/editor/draftOps.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile,
      alias: { '@shared': resolve('src/shared') },
      logLevel: 'silent'
    })
    return (await import(outfile)) as typeof import('../../src/renderer/src/components/editor/draftOps.ts')
  })()
  const ids = (d: { sections: { items: { id: string }[] }[] }): string[] => d.sections.flatMap((x) => x.items.map((i) => i.id))
  const base = draftWith('A', 'B', 'C')

  check('撤销删除：题目已经在卷里时原样返回，不会同一个 id 插进去两份', () => {
    const { draft: removedDraft, removed } = ops.removeItem(base as never, 'i1')
    assert.deepEqual(ids(removedDraft), ['i0', 'i2'])
    const back = ops.restoreItem(removedDraft, removed!)
    assert.deepEqual(ids(back), ['i0', 'i1', 'i2'])
    const again = ops.restoreItem(back, removed!)
    assert.equal(again, back, '第二次撤销什么也不改，返回同一个对象')
    assert.deepEqual(ids(again), ['i0', 'i1', 'i2'])
  })

  check('草稿操作保留目标满分；清除单题分值后跟随大题', () => {
    const scored = { ...base, targetScore: 90, sections: [{ ...base.sections[0], defaultScore: 4 }] }
    const moved = ops.moveItemBy(scored as never, 'i0', 1)
    assert.equal(moved.targetScore, 90)
    assert.deepEqual(ids(moved), ['i1', 'i0', 'i2'])
    const own = ops.setItemScore(scored as never, 'i1', 7)
    assert.equal(own.sections[0].items[1].score, 7)
    const cleared = ops.clearItemScores(own, 's1')
    assert.equal(cleared.sections[0].items[1].score, undefined)
    assert.equal(ops.removeSection(scored as never, 's1').draft.targetScore, 90)
  })

  db.close()
  console.log(`编辑器数据操作测试通过：${passed} 项`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
