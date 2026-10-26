// 开发样例数据：在指定数据目录里放入几道覆盖各题型的样例题（含图片、多小题块、书面表达横线）。
// 用法：node scripts/seed-dev.ts <数据目录>；也可在测试里 import { seedDataDir }。
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { assetUrl, saveAsset } from '../src/main/assets.ts'
import { openDatabase } from '../src/main/db.ts'

const FORMULA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="20" viewBox="0 0 64 20"><text x="2" y="15" font-family="Times New Roman" font-style="italic" font-size="15">|a|=−a</text></svg>`
// 48×24 的数轴示意图（PNG）
const NUMBER_LINE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAAWUlEQVR42mP4P8gAw6iDqOGgOxoag8VBQKcgo1EH4XUNfdw0GmVkOIiBgYFgLsNUQ6EIgkGMg2gtwgAGg8VBcIDiIIZBAEajjOxEPVrbjzpo1EGjDhrZDgIAjik6jRroiQkAAAAASUVORK5CYII=',
  'base64'
)

export function seedDataDir(dataDir: string): { questionIds: number[] } {
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  const db = openDatabase(dataDir)
  const svg = assetUrl(saveAsset(db, dataDir, Buffer.from(FORMULA_SVG), 'svg'))
  const png = assetUrl(saveAsset(db, dataDir, NUMBER_LINE_PNG, 'png'))
  const now = new Date().toISOString()
  const paper = (url: string, title: string): number =>
    Number(db.prepare('INSERT INTO source_papers (url, title, fetched_at) VALUES (?, ?, ?)').run(url, title, now).lastInsertRowid)
  const mathPaper = paper('https://zujuan.xkw.com/2p1000001.html', '样例中学2026-2027学年七年级上学期第一次月考数学试题')
  const englishPaper = paper('https://zujuan.xkw.com/3p1000002.html', '样例中学2026-2027学年七年级上学期阶段检测英语试题')

  const insert = db.prepare(
    `INSERT INTO questions (zujuan_qid, source_paper_id, source_label, source_order, question_type, number_count, stem_html, answer_html, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const rows: [string, number, string, number, string, number, string, string | null][] = [
    ['900001', mathPaper, '26-27七年级上·样例市·月考', 0, '单选题', 1,
      `<p>下列说法正确的是（　　）</p><p>若 <img src="${svg}" width="64" height="20">，则 a 一定是负数</p><table data-role="options"><tr><td>A．①②</td><td>B．②③</td><td>C．①③</td><td>D．③④</td></tr></table>`,
      '<p>【答案】C</p><p>【详解】根据绝对值的意义……</p>'],
    ['900002', mathPaper, '26-27七年级上·样例市·月考', 1, '填空题', 1,
      `<p>如图，数轴上点 A 表示的数是 <u>　　　　</u>。</p><p><img src="${png}" width="96" height="48"></p>`,
      '<p>【答案】−3</p>'],
    ['900003', mathPaper, '26-27七年级上·样例市·月考', 2, '计算题', 1,
      '<p>计算：(−2)³ + |−5| − 4 ÷ (−2)</p>',
      '<p>【答案】−1</p>'],
    ['900004', mathPaper, '26-27七年级上·样例市·月考', 3, '解答题', 1,
      '<p>某超市一周的盈亏情况如下表（盈利为正）：</p><table data-role="bordered"><tr><td>周一</td><td>周二</td><td>周三</td></tr><tr><td>+120</td><td>−45</td><td>+80</td></tr></table><p>(1) 这三天共盈利多少元？</p><p>(2) 平均每天盈利多少元？</p>',
      null],
    ['900005', englishPaper, '26-27七年级上·样例市·阶段检测', 0, '完形填空', 3,
      '<p>Tom is a new student. He <span data-ewb-qno="0"></span>____ from Canada. He likes <span data-ewb-qno="1"></span>____ very much, and he often <span data-ewb-qno="2"></span>____ basketball after school.</p><p><span data-ewb-qno="0"></span>. A. come　B. comes　C. coming</p><p><span data-ewb-qno="1"></span>. A. sport　B. sports　C. a sport</p><p><span data-ewb-qno="2"></span>. A. play　B. plays　C. playing</p>',
      '<p>【答案】1. B　2. B　3. B</p>'],
    ['900006', englishPaper, '26-27七年级上·样例市·阶段检测', 1, '书面表达', 1,
      '<p>假如你是李华，请给你的笔友写一封信，介绍你的新学校。词数 80 左右。</p><p>________________________________________________________________________________________________________________________</p>',
      null]
  ]
  const ids = rows.map(([qid, paperId, label, order, type, count, stem, answer]) =>
    Number(insert.run(qid, paperId, label, order, type, count, stem, answer, `seed-${qid}`, now).lastInsertRowid)
  )
  db.close()
  return { questionIds: ids }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('用法：node scripts/seed-dev.ts <数据目录>')
    process.exit(1)
  }
  const { questionIds } = seedDataDir(dir)
  console.log(`已写入样例题 ${questionIds.length} 道 → ${dir}`)
}
