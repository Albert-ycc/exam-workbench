// 数据库约束测试：node scripts/test-db.ts
// 验证「原题只读」「版本只增不改、连续编号、不能单独删除」「删除试卷连带删除版本与下载记录」，
// 并在拆掉触发器后确认同样的操作会成功，证明这些断言确实依赖触发器。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, SCHEMA_VERSION } from '../src/main/db.ts'

const dir = mkdtempSync(join(tmpdir(), 'ewb-db-'))
const now = new Date().toISOString()
let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log('  ✓ ' + name)
}

try {
  const db = openDatabase(dir)
  check('新库迁移到最新结构版本', () => {
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    assert.equal(user_version, SCHEMA_VERSION)
  })

  db.prepare('INSERT INTO source_papers (url, title, fetched_at) VALUES (?, ?, ?)').run('https://zujuan.xkw.com/1p1.html', '来源卷', now)
  db.prepare('INSERT INTO questions (zujuan_qid, source_paper_id, question_type, stem_html, fingerprint, created_at) VALUES (?, 1, ?, ?, ?, ?)').run('q1', '选择题', '<p>1+1=?</p>', 'fp1', now)

  check('原题不能修改', () => {
    assert.throws(() => db.prepare("UPDATE questions SET stem_html = '改过' WHERE id = 1").run(), /只读/)
  })
  check('原题可以删除', () => {
    db.prepare("INSERT INTO questions (stem_html, fingerprint, created_at) VALUES ('临时', 'fp2', ?)").run(now)
    db.prepare("DELETE FROM questions WHERE fingerprint = 'fp2'").run()
  })
  check('题目编号重复入库被拒绝', () => {
    assert.throws(() => db.prepare("INSERT INTO questions (zujuan_qid, stem_html, fingerprint, created_at) VALUES ('q1', 'x', 'fp3', ?)").run(now), /UNIQUE/)
  })

  db.prepare("INSERT INTO papers (title, draft_json, created_at, updated_at) VALUES ('试卷', '{}', ?, ?)").run(now, now)
  const addVersion = db.prepare("INSERT INTO paper_versions (paper_id, version_no, origin, snapshot_json, created_at) VALUES (1, ?, 'manual', '{}', ?)")

  check('版本号从 1 开始连续递增', () => {
    addVersion.run(1, now)
    addVersion.run(2, now)
    assert.throws(() => addVersion.run(4, now), /连续递增/)
    assert.throws(() => addVersion.run(2, now), /连续递增|UNIQUE/)
  })
  check('版本不能修改', () => {
    assert.throws(() => db.prepare("UPDATE paper_versions SET note = '改' WHERE version_no = 1").run(), /只增不改/)
  })
  check('试卷存在时版本不能单独删除', () => {
    assert.throws(() => db.prepare('DELETE FROM paper_versions WHERE version_no = 1').run(), /不能单独删除/)
  })
  check('删除试卷连带删除版本与下载记录', () => {
    db.prepare("INSERT INTO exports (version_id, format, options_json, file_path, created_at) VALUES (1, 'pdf', '{}', 'x.pdf', ?)").run(now)
    db.prepare('DELETE FROM papers WHERE id = 1').run()
    const left = db.prepare('SELECT (SELECT COUNT(*) FROM paper_versions) AS v, (SELECT COUNT(*) FROM exports) AS e').get() as { v: number; e: number }
    assert.deepEqual({ ...left }, { v: 0, e: 0 })
  })
  check('重复打开不会重复迁移', () => {
    db.close()
    const again = openDatabase(dir)
    const { user_version } = again.prepare('PRAGMA user_version').get() as { user_version: number }
    assert.equal(user_version, SCHEMA_VERSION)
    again.close()
  })

  check('反向验证：拆掉触发器后同样的操作会成功', () => {
    const raw = openDatabase(dir)
    raw.exec('DROP TRIGGER questions_readonly; DROP TRIGGER paper_versions_no_update; DROP TRIGGER paper_versions_sequential;')
    raw.prepare("UPDATE questions SET stem_html = '改过' WHERE id = 1").run()
    const paperId = raw.prepare("INSERT INTO papers (title, draft_json, created_at, updated_at) VALUES ('试卷2', '{}', ?, ?)").run(now, now).lastInsertRowid
    raw.prepare("INSERT INTO paper_versions (paper_id, version_no, origin, snapshot_json, created_at) VALUES (?, 7, 'manual', '{}', ?)").run(paperId, now)
    raw.prepare("UPDATE paper_versions SET note = '改' WHERE paper_id = ?").run(paperId)
    raw.close()
  })

  console.log(`数据库约束测试通过：${passed} 项`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
