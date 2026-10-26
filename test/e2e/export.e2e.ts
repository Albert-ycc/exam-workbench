// 下载端到端测试：在真实应用里用样例数据生成全部有效配置的 PDF 与 DOCX，核对文件名、版本号、内容，
// 并校验按下载记录重新下载、覆盖保护、记忆配置、出错提示。不依赖编辑器界面，直接调用 window.workbench。
// 用法：node test/e2e/export.e2e.ts [证据目录]；需要本机有 pdftotext / pdftoppm / unzip，Word 文件用 LibreOffice（soffice）转 PDF 复核。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { allValidOptions, fixSeedPng, optionsLabel, sampleDraft } from '../../scripts/test-export-fixtures.ts'
import { normalizeExportOptions, type ExportOptions, type PaperDraft } from '../../src/shared/domain.ts'
import { configWords, withWords } from '../../src/main/export/file-name.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-export-'))
const filesDir = join(evidence, 'files')
const imagesDir = join(evidence, 'images')
// 证据目录里本测试自己的子目录每次重新生成
for (const d of ['files', 'images', 'docx-as-pdf', 'reexport-before', 'files-nasty']) rmSync(join(evidence, d), { recursive: true, force: true })
for (const d of [filesDir, imagesDir]) mkdirSync(d, { recursive: true })

const TITLE = '七年级数学第一单元测试'
const MATH = '26-27七年级上·样例市·月考'
const ENGLISH = '26-27七年级上·样例市·阶段检测'
const NUMBER_LINE_B64 = readFileSync(join(import.meta.dirname, '../../scripts/test-export-fixtures.ts'), 'utf8').match(/Buffer\.from\(\n  '([^']+)'/)![1]
const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const squash = (s: string): string => s.replace(/\s+/g, '')
const count = (s: string, sub: string): number => s.split(sub).length - 1
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

function pdfText(file: string): string {
  return squash(sh('pdftotext', [file, '-']))
}
function pdfPages(file: string): number {
  return Number(/Pages:\s+(\d+)/.exec(sh('pdfinfo', [file]))![1])
}
function docxXml(file: string): string {
  return sh('unzip', ['-p', file, 'word/document.xml'])
}
function docxText(file: string): string {
  return squash(
    docxXml(file)
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  )
}
// 文字位置（pt）：[页, y, 文字]
function words(file: string): { page: number; x: number; y: number; text: string }[] {
  const html = sh('pdftotext', ['-bbox', file, '-'])
  const out: { page: number; x: number; y: number; text: string }[] = []
  let page = 0
  for (const line of html.split('\n')) {
    if (line.includes('<page ')) page++
    const m = /<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/.exec(line)
    if (m) out.push({ page, x: Number(m[1]), y: Number(m[2]), text: m[3] })
  }
  return out
}

interface Done {
  options: ExportOptions
  versionNo: number
  filePath: string
  createdVersion: boolean
}

let checks = 0
const ok = (name: string): void => {
  checks++
  console.log('  ✓ ' + name)
}

buildTo('out-export3')
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-export-data-'))
seedDataDir(dataDir)
fixSeedPng(dataDir)
const launched = await launchApp({ outDir: 'out-export3', dataDir })
const { app, window } = launched

const call = {
  create: (title: string) => window.evaluate((t) => window.workbench.papers.create(t), title),
  saveDraft: (id: number, draft: PaperDraft) => window.evaluate(([i, d]) => window.workbench.papers.saveDraft(i as number, d as PaperDraft), [id, draft] as const),
  exportPaper: (paperId: number, options: ExportOptions, directory: string) =>
    window.evaluate(([p, o, d]) => window.workbench.exporter.exportPaper({ paperId: p as number, kind: 'paper', options: o as ExportOptions, directory: d as string }), [paperId, options, directory] as const),
  preview: (paperId: number, options: ExportOptions) => window.evaluate(([p, o]) => window.workbench.exporter.previewFileName(p as number, o as ExportOptions, 'paper'), [paperId, options] as const),
  reexport: (id: number) => window.evaluate((i) => window.workbench.exporter.reexport(i), id),
  versions: (id: number) => window.evaluate((i) => window.workbench.papers.listVersions(i), id)
}

try {
  const page = await window.evaluate(() => window.workbench.library.listQuestions({}))
  const questions = page.items.sort((a, b) => a.id - b.id)
  assert.equal(questions.length, 6)
  const draft = sampleDraft(questions)
  const paperId = await call.create(TITLE)
  await call.saveDraft(paperId, draft)

  // ---------- 一、全部有效配置各生成一次 ----------
  console.log('全部有效配置各生成一次')
  const combos = allValidOptions(normalizeExportOptions)
  assert.equal(combos.length, 26)
  const done: Done[] = []
  const t0 = Date.now()
  for (const options of combos) {
    const r = await call.exportPaper(paperId, options, filesDir)
    done.push({ options, ...r })
  }
  console.log(`  26 份生成用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)

  const names = done.map((d) => basename(d.filePath))
  assert.equal(new Set(names).size, 26, '26 个文件名互不相同')
  assert.deepEqual(done.map((d) => d.versionNo), Array(26).fill(1), '内容不变，全部挂在 v1')
  assert.deepEqual(done.map((d) => d.createdVersion), [true, ...Array(25).fill(false)], '只有第一次下载新存版本')
  assert.equal(readdirSync(filesDir).length, 26)
  ok('26 个文件都生成，版本号都是 v1，只有首次下载新存了版本')

  // 文件名：试卷标题_v1_版别.格式。同一版本里每个（版别, 格式）的第一份用基础名，后面配置不同的用与它的区别的配置词（不是序号）
  const groupOf = (d: Done): string => `${d.options.answerPosition === 'none' ? '学生版' : '教师版'}.${d.options.format}`
  const firstOf = new Map<string, Done>()
  for (const d of done) {
    const key = groupOf(d)
    const first = firstOf.get(key)
    if (!first) firstOf.set(key, d)
    const base = `${TITLE}_v1_${key}`
    const expected = first ? withWords(base, configWords(d.options, first.options)) : base
    assert.equal(basename(d.filePath), expected, optionsLabel(d.options))
  }
  assert.deepEqual([...firstOf.keys()].sort(), ['学生版.docx', '学生版.pdf', '教师版.docx', '教师版.pdf'])
  assert.ok(done.every((d) => !basename(d.filePath).includes('(2)')), '26 份都靠配置词区分，没有用到序号')
  assert.equal(new Set(done.map((d) => sha(d.filePath))).size, 26, '没有被覆盖或重复')
  ok('文件名符合「标题_v1_学生版/教师版」，同名但配置不同的用配置词区分（如「_留作答区域」「_来源在题文前」），没有静默覆盖')

  // ---------- 二、逐份核对内容 ----------
  console.log('逐份核对内容')
  const sectionTitles = ['一、选择题（每题3分）', '二、填空题', '三、计算题', '四、解答题', '五、完形填空', '六、书面表达']
  const textOf = (d: Done): string => (d.options.format === 'pdf' ? pdfText(d.filePath) : docxText(d.filePath))
  function checkContent(d: Done, text: string): void {
    const o = d.options
    const label = optionsLabel(o) + '/' + o.format
    assert.ok(text.includes(TITLE), `${label} 标题`)
    for (const t of sectionTitles) assert.ok(text.includes(t), `${label} 大题标题 ${t}`)
    const m = o.sourcePosition === 'before-stem' ? `（${MATH}）` : ''
    const en = o.sourcePosition === 'before-stem' ? `（${ENGLISH}）` : ''
    for (const [no, lead, rest] of [[1, m, '下列说法正确的是'], [2, m, '如图'], [3, m, '计算：'], [4, m, '某超市']] as const) {
      assert.ok(text.includes(`${no}.${lead}${rest}`), `${label} 第 ${no} 题开头应为「${no}.${lead}${rest}」`)
    }
    assert.ok(text.includes(`${en}Tomisanewstudent`), `${label} 完形填空没有块首题号，来源在最前`)
    assert.ok(text.includes('He5____fromCanada'), `${label} 完形填空第 5 空`)
    assert.ok(text.includes('likes6____'), `${label} 完形填空第 6 空`)
    assert.ok(text.includes('often7____'), `${label} 完形填空第 7 空`)
    for (const part of ['5.A.come', '6.A.sport', '7.A.play']) assert.ok(text.includes(part), `${label} 完形填空选项题号 ${part}`)
    assert.ok(text.includes(`8.${en}假如你是李华`), `${label} 书面表达为第 8 题`)
    assert.equal(count(text, '参考答案'), o.answerPosition === 'end' ? 1 : 0, `${label} 卷尾答案`)
    assert.equal(text.includes('【答案】C'), o.answerPosition !== 'none', `${label} 答案是否出现`)
    if (o.answerPosition === 'end') {
      const key = text.slice(text.indexOf('参考答案'))
      assert.ok(key.includes('5、6、7'), `${label} 材料题题号合并`)
      assert.ok(key.indexOf('1') < key.indexOf('5、6、7'), `${label} 题号升序`)
      assert.ok(text.indexOf('参考答案') > text.indexOf('六、书面表达'), `${label} 答案在正文之后`)
    }
    if (o.answerPosition === 'after') assert.ok(text.indexOf('【答案】C') < text.indexOf('二、填空题'), `${label} 答案紧跟题目`)
    const [mathCount, englishCount] = o.sourcePosition === 'before-stem' ? [4, 2] : o.sourcePosition === 'answer' ? [3, 1] : [0, 0]
    assert.equal(count(text, MATH), mathCount, `${label} 来源（数学）出现次数`)
    assert.equal(count(text, ENGLISH), englishCount, `${label} 来源（英语）出现次数`)
    if (o.sourcePosition === 'answer') {
      const key = text.slice(text.indexOf('【答案】C') - 40)
      assert.ok(key.includes(`（${MATH}）【答案】C`), `${label} 来源紧贴在答案前`)
    }
  }
  for (const d of done) checkContent(d, textOf(d))
  ok('26 份文件的标题、大题序号、全卷题号（含完形填空 5～7）、答案位置、来源位置、来源次数都符合配置')

  // PDF：页脚页码、作答区域留白
  const mm = 72 / 25.4
  let gapChecks = 0
  for (const d of done.filter((x) => x.options.format === 'pdf')) {
    const pages = pdfPages(d.filePath)
    const text = pdfText(d.filePath)
    for (let n = 1; n <= pages; n++) assert.ok(text.includes(`第${n}页（共${pages}页）`), `${optionsLabel(d.options)} 页脚「第${n}页（共${pages}页）」`)
    const w = words(d.filePath)
    const at = (part: string) => w.find((x) => x.text.includes(part))
    for (const [from, to, mmNeeded] of [['计算：', '四、解答题', 36], ['平均每天', '五、完形填空', 32]] as const) {
      const a = at(from)
      const b = at(to)
      assert.ok(a && b, `${optionsLabel(d.options)} 找到 ${from}`)
      if (a.page !== b.page) continue
      const gap = b.y - a.y
      if (d.options.answerArea) assert.ok(gap >= mmNeeded * mm, `${optionsLabel(d.options)} ${from} 后应留白 ${mmNeeded}mm，实际间距 ${(gap / mm).toFixed(1)}mm`)
      else assert.ok(gap < mmNeeded * mm, `${optionsLabel(d.options)} ${from} 后不应留白，实际间距 ${(gap / mm).toFixed(1)}mm`)
      gapChecks++
    }
  }
  ok(`PDF 每页页脚「第N页（共M页）」齐全；作答区域留白按 36mm / 32mm 核对 ${gapChecks} 处`)

  // DOCX：结构与格式
  for (const d of done.filter((x) => x.options.format === 'docx')) {
    const xml = docxXml(d.filePath)
    const label = optionsLabel(d.options)
    assert.equal(count(xml, '<w:tbl>'), 1 + (d.options.answerPosition === 'end' ? 4 : 0), `${label} 数据表格 1 个（选项没有表格），卷尾答案每题一行（4 个无边框两列表格）`)
    assert.equal(count(xml, '<w:pageBreakBefore/>'), d.options.answerPosition === 'end' ? 1 : 0, `${label} 卷尾答案另起一页`)
    assert.equal(count(xml, '<w:drawing>'), 2, `${label} 公式图与数轴图`)
    assert.equal(count(xml, 'w:line="2041" w:lineRule="exact"'), d.options.answerArea ? 1 : 0, `${label} 计算题留白 36mm`)
    assert.equal(count(xml, 'w:line="1814" w:lineRule="exact"'), d.options.answerArea ? 1 : 0, `${label} 解答题留白 32mm`)
    assert.equal(count(xml, '<w:between '), d.options.answerArea ? 2 : 0, `${label} 书面表达横线行`)
    assert.equal(count(xml, '<w:tab/>'), 3 + 7, `${label} 选项用制表位排成一行（3 个），抬头填写行 4 条横线 + 3 个间隔（7 个）`)
  }
  ok('13 份 DOCX：选项无表格框线（制表位）、卷尾答案分页、作答留白与横线行数、图片数量')

  // DOCX 用 LibreOffice 转 PDF，确认能打开、文字齐全
  const docxDone = done.filter((x) => x.options.format === 'docx')
  const convDir = join(evidence, 'docx-as-pdf')
  mkdirSync(convDir, { recursive: true })
  sh('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', convDir, ...docxDone.map((d) => d.filePath)])
  for (const d of docxDone) {
    const pdf = join(convDir, basename(d.filePath).replace(/\.docx$/, '.pdf'))
    assert.ok(existsSync(pdf), `${basename(pdf)} 转换成功`)
    const text = pdfText(pdf)
    assert.ok(text.includes(TITLE) && text.includes('六、书面表达'), `${optionsLabel(d.options)} LibreOffice 打开后文字齐全`)
    assert.equal(count(text, '参考答案'), d.options.answerPosition === 'end' ? 1 : 0)
  }
  ok('13 份 DOCX 都能被 LibreOffice 打开并转成 PDF，文字齐全')

  // ---------- 三、渲染成图片，逐项人工核对用 ----------
  const pick = (answerPosition: string, sourcePosition: string, format: string, answerArea: boolean): Done =>
    done.find((x) => x.options.answerPosition === answerPosition && x.options.sourcePosition === sourcePosition && x.options.format === format && x.options.answerArea === answerArea)!
  const renders: [string, string, string][] = [
    ['A-学生版PDF-来源题文前-作答区域', pick('none', 'before-stem', 'pdf', true).filePath, 'a-student-pdf'],
    ['B-教师版卷尾PDF-来源答案处-作答区域', pick('end', 'answer', 'pdf', true).filePath, 'b-teacher-end-pdf'],
    ['C-教师版题后DOCX-来源答案处', join(convDir, basename(pick('after', 'answer', 'docx', false).filePath).replace('.docx', '.pdf')), 'c-teacher-after-docx'],
    ['D-学生版DOCX-作答区域', join(convDir, basename(pick('none', 'none', 'docx', true).filePath).replace('.docx', '.pdf')), 'd-student-docx-area'],
    ['E-教师版卷尾DOCX-来源题文前-作答区域', join(convDir, basename(pick('end', 'before-stem', 'docx', true).filePath).replace('.docx', '.pdf')), 'e-teacher-end-docx'],
    ['F-教师版题后PDF-来源题文前', pick('after', 'before-stem', 'pdf', false).filePath, 'f-teacher-after-pdf']
  ]
  for (const [, pdf, prefix] of renders) sh('pdftoppm', ['-r', '80', '-png', pdf, join(imagesDir, prefix)])
  console.log('  渲染图：' + readdirSync(imagesDir).sort().join('、'))
  ok('代表性的 6 份已渲染成图片')

  // ---------- 四、版本、重新下载、覆盖保护 ----------
  console.log('版本与重新下载')
  const student: ExportOptions = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }
  assert.equal(await call.preview(paperId, student), `${TITLE}_v1_学生版.pdf`)
  const sameAgain = await call.exportPaper(paperId, student, filesDir)
  assert.deepEqual({ v: sameAgain.versionNo, c: sameAgain.createdVersion, p: basename(sameAgain.filePath) }, { v: 1, c: false, p: `${TITLE}_v1_学生版.pdf` })
  assert.equal(readdirSync(filesDir).length, 26, '同一版本同一配置再次下载是原位覆盖，不增加文件')
  ok('内容不变再次下载：仍是 v1，不新存版本，同配置的文件原位覆盖')

  const before = join(evidence, 'reexport-before')
  mkdirSync(before, { recursive: true })
  const v1Exports = (await call.versions(paperId)).find((v) => v.versionNo === 1)!.exports
  const originals = [pick('end', 'answer', 'pdf', true), pick('after', 'before-stem', 'docx', false)].map((d) => v1Exports.find((e) => e.filePath === d.filePath)!)
  for (const rec of originals) copyFileSync(rec.filePath, join(before, basename(rec.filePath)))

  const changed = structuredClone(draft)
  changed.sections[2].items[0].stemHtml = '<p>计算：(−3)² + |−7| − 6 ÷ (−3)</p>'
  await call.saveDraft(paperId, changed)
  assert.equal(await call.preview(paperId, student), `${TITLE}_v2_学生版.pdf`, '草稿有改动时预览版本号加 1')
  const v2 = await call.exportPaper(paperId, student, filesDir)
  assert.deepEqual({ v: v2.versionNo, c: v2.createdVersion, p: basename(v2.filePath) }, { v: 2, c: true, p: `${TITLE}_v2_学生版.pdf` })
  assert.ok(pdfText(v2.filePath).includes('3.计算：(−3)²'))
  const v2Again = await call.exportPaper(paperId, student, filesDir)
  assert.deepEqual({ v: v2Again.versionNo, c: v2Again.createdVersion }, { v: 2, c: false })
  const versions = await call.versions(paperId)
  assert.deepEqual(versions.map((v) => [v.versionNo, v.origin, v.note]), [[2, 'download', '下载时自动保存'], [1, 'download', '下载时自动保存']])
  ok('改草稿后：预览与下载都是 v2，v1 的 26 个文件不动；版本说明统一为「下载时自动保存」，不写格式')

  for (const rec of originals) {
    const r = await call.reexport(rec.id)
    assert.equal(r.versionNo, 1)
    assert.equal(r.createdVersion, false)
    assert.equal(r.filePath, rec.filePath, '重新下载回到原文件位置')
    const again = join(filesDir, basename(rec.filePath))
    const original = join(before, basename(rec.filePath))
    if (rec.format === 'pdf') {
      assert.equal(pdfText(again), pdfText(original), 'PDF 文字一致')
      assert.equal(pdfPages(again), pdfPages(original), 'PDF 页数一致')
      assert.ok(pdfText(again).includes('计算：(−2)³'), '回到 v1 的题目内容，不是 v2 的')
    } else {
      assert.equal(docxXml(again), docxXml(original), 'DOCX 正文一致')
      assert.ok(docxText(again).includes('计算：(−2)³'), '回到 v1 的题目内容，不是 v2 的')
    }
  }
  const after = await call.versions(paperId)
  assert.equal(after.length, 2, '重新下载不新存版本')
  assert.equal(after.find((v) => v.versionNo === 1)!.exports.length, v1Exports.length, '重新下载的是同一个文件：只更新原记录，不多出记录')
  ok('按下载记录重新下载：版本与配置还原（v1 内容、原路径），PDF 文字与页数、DOCX 正文与首次一致，未新存版本')

  // ---------- 五、文件名清理与覆盖保护 ----------
  console.log('文件名与覆盖保护')
  const nasty = await call.create('七年级/数学:第一单元*测试?"<>|' + '长'.repeat(80))
  await call.saveDraft(nasty, draft)
  const nastyOutDir = join(evidence, 'files-nasty')
  mkdirSync(nastyOutDir, { recursive: true })
  const expectedName = `七年级数学第一单元测试${'长'.repeat(60 - 11)}_v1_学生版.pdf` // 标题最多 60 个字符
  assert.equal(await call.preview(nasty, student), expectedName)
  writeFileSync(join(nastyOutDir, expectedName), '用户自己的文件')
  const nr = await call.exportPaper(nasty, student, nastyOutDir)
  assert.equal(basename(nr.filePath), expectedName.replace('.pdf', ' (2).pdf'))
  assert.equal(readFileSync(join(nastyOutDir, expectedName), 'utf8'), '用户自己的文件', '已有的同名文件不被覆盖')
  ok('标题里的 Windows 非法字符被去掉并限制长度；同名的非本软件文件不被覆盖，自动加序号')

  // ---------- 六、记忆配置、出错提示、只许打开下载记录里的文件 ----------
  console.log('设置、出错、文件夹')
  const last: ExportOptions = { answerPosition: 'after', sourcePosition: 'answer', format: 'docx', answerArea: true }
  await call.exportPaper(paperId, last, filesDir)
  const defaults = await window.evaluate(() => window.workbench.exporter.getDefaults())
  assert.deepEqual(defaults, { options: normalizeExportOptions(last), directory: filesDir })
  assert.ok(existsSync(join(launched.userDataDir, 'export-settings.json')), '设置存在用户目录下的独立文件')
  ok('记住上一次的配置（已规整：题后不带作答区域）与保存位置，存在用户目录的 export-settings.json')

  const solo = await call.create('只有解答题')
  await call.saveDraft(solo, { sections: [{ ...draft.sections[3], items: [draft.sections[3].items[0]] }] })
  await assert.rejects(call.exportPaper(solo, { ...student, answerPosition: 'end' }, filesDir), /没有任何带答案的题目/)
  await assert.rejects(call.exportPaper(solo, student, join(filesDir, '不存在的文件夹')), /保存位置不存在/)
  const empty = await call.create('空试卷')
  await assert.rejects(call.exportPaper(empty, student, filesDir), /还没有题目/)
  assert.equal((await call.versions(solo)).length, 0, '出错的下载不留版本')
  assert.equal((await call.versions(empty)).length, 0)
  ok('没有答案的教师版、保存位置不存在、空试卷都给出原因，且不留下多余版本')

  const lastRecord = (await call.versions(paperId))[0].exports[0]
  await app.evaluate(({ shell }) => {
    ;(globalThis as unknown as { __shown: string[] }).__shown = []
    shell.showItemInFolder = (p: string) => (globalThis as unknown as { __shown: string[] }).__shown.push(p) as unknown as void
  })
  await window.evaluate((p) => window.workbench.exporter.showInFolder(p), lastRecord.filePath)
  await assert.rejects(window.evaluate(() => window.workbench.exporter.showInFolder('/etc/hosts')), /只能打开下载记录里的文件/)
  await assert.rejects(window.evaluate((p) => window.workbench.exporter.showInFolder(p), join(filesDir, '没下载过.pdf')), /只能打开下载记录里的文件/)
  const shown = await app.evaluate(() => (globalThis as unknown as { __shown: string[] }).__shown)
  assert.deepEqual(shown, [lastRecord.filePath])
  ok('在文件夹中显示：下载记录里的文件放行，其他路径拒绝')

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['/tmp'] })) as never
  })
  assert.equal(await window.evaluate(() => window.workbench.exporter.chooseDirectory('/')), '/tmp')
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as never
  })
  assert.equal(await window.evaluate(() => window.workbench.exporter.chooseDirectory('/')), null)
  ok('选择保存位置：返回所选文件夹，取消返回 null')

  // ---------- 七、特殊图片：无尺寸的 SVG、WebP、内嵌 data 图片 ----------
  console.log('图片格式')
  const svgNoSize = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><rect width="80" height="40" fill="#cfe0ff"/><text x="6" y="26" font-size="16" font-family="Arial">viewBox</text></svg>')
  const webpBase64 = await window.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 80
    const g = c.getContext('2d')!
    g.fillStyle = '#ffe3b3'
    g.fillRect(0, 0, 240, 80)
    g.fillStyle = '#222'
    g.font = '40px Arial'
    g.fillText('WebP 3:1', 14, 56)
    return c.toDataURL('image/webp').split(',')[1]
  })
  assert.ok(webpBase64.length > 100)
  const webp = Buffer.from(webpBase64, 'base64')
  const pngBase64 = NUMBER_LINE_B64
  const assetName = (bytes: Buffer, ext: string): string => `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
  const svgFile = assetName(svgNoSize, 'svg')
  const webpFile = assetName(webp, 'webp')
  writeFileSync(join(dataDir, 'assets', svgFile), svgNoSize)
  writeFileSync(join(dataDir, 'assets', webpFile), webp)
  // 公式小图：组卷网的公式多是 1 倍分辨率的小 PNG，没有 width/height，应放大 3 倍再用、显示尺寸不变
  const glyphBase64 = await window.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 20
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, 64, 20)
    g.fillStyle = '#000'
    g.font = 'italic 15px Times New Roman'
    g.fillText('x²+1=2', 3, 15)
    return c.toDataURL('image/png').split(',')[1]
  })
  const glyph = Buffer.from(glyphBase64, 'base64')
  const glyphFile = assetName(glyph, 'png')
  writeFileSync(join(dataDir, 'assets', glyphFile), glyph)
  const imagesPaper = await call.create('图片格式试卷')
  await call.saveDraft(imagesPaper, {
    sections: [
      {
        id: 's1',
        title: '解答题',
        items: [
          {
            id: 'i1',
            originQuestionId: null,
            sourceLabel: '',
            questionType: '解答题',
            numberCount: 1,
            stemHtml: `<p>无宽高的 SVG：<img src="ewb-asset://${svgFile}"> 与 WebP：<img src="ewb-asset://${webpFile}" width="90" height="30"> 与内嵌图：<img src="data:image/png;base64,${pngBase64}" width="48" height="24"> 与公式小图 <img src="ewb-asset://${glyphFile}"> 排在一行。</p>`,
            answerHtml: null
          }
        ]
      }
    ]
  })
  const imgDir = join(evidence, 'files-images')
  rmSync(imgDir, { recursive: true, force: true })
  mkdirSync(imgDir, { recursive: true })
  const imgPdf = await call.exportPaper(imagesPaper, { ...student, format: 'pdf' }, imgDir)
  const imgDocx = await call.exportPaper(imagesPaper, { ...student, format: 'docx' }, imgDir)
  assert.equal(count(docxXml(imgDocx.filePath), '<w:drawing>'), 4)
  const extents = [...docxXml(imgDocx.filePath).matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => [Number(m[1]) / 9525, Number(m[2]) / 9525])
  assert.deepEqual(extents.map(([w, h]) => [Math.round(w), Math.round(h)]), [[300, 150], [90, 30], [48, 24], [64, 20]], 'Word 里的显示尺寸：没有固有尺寸的 SVG 与 PDF 一样按浏览器默认的 300×150，WebP 与内嵌图用 width/height')
  // 小图放大：Word 里嵌入的位图是 192×60（3 倍），显示仍是 64×20；PDF 里同样
  const mediaDir = join(imgDir, 'media')
  mkdirSync(mediaDir, { recursive: true })
  sh('unzip', ['-o', '-q', imgDocx.filePath, 'word/media/*', '-d', mediaDir])
  const pixelSizes = readdirSync(join(mediaDir, 'word/media')).map((f) => {
    const b = readFileSync(join(mediaDir, 'word/media', f))
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
  })
  assert.ok(pixelSizes.includes('192x60'), `Word 里应嵌入放大 3 倍的公式小图，实际 ${pixelSizes.join('、')}`)
  const pdfImageSizes = sh('pdfimages', ['-list', imgPdf.filePath]).split('\n').slice(2).map((l) => l.trim().split(/\s+/).slice(3, 5).join('x')).filter(Boolean)
  assert.ok(pdfImageSizes.includes('192x60'), `PDF 里应嵌入放大 3 倍的公式小图，实际 ${pdfImageSizes.join('、')}`)
  const imgConv = join(imgDir, 'docx-as-pdf') // 转换结果放子目录，避免覆盖同名的 PDF
  sh('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', imgConv, imgDocx.filePath])
  sh('pdftoppm', ['-r', '110', '-png', imgPdf.filePath, join(imagesDir, 'g-images-pdf')])
  sh('pdftoppm', ['-r', '110', '-png', join(imgConv, basename(imgDocx.filePath).replace('.docx', '.pdf')), join(imagesDir, 'h-images-docx')])
  ok('无宽高的 SVG、WebP、内嵌 data 图片：PDF 与 Word 都能生成，Word 里的尺寸与 PDF 一致')

  // ---------- 八、整张答案图与作答类型 ----------
  // 登录账号入库的答案是一整张图（【答案】+【详解】），可能很高；题型标签「解答题-计算题」在名为「解答题」的大题里也要留 36mm
  console.log('整张答案图')
  const answerPng = async (width: number, height: number, mark: string): Promise<string> =>
    window.evaluate(
      ([w, h, m]) => {
        const c = document.createElement('canvas')
        c.width = w as number
        c.height = h as number
        const g = c.getContext('2d')!
        const grad = g.createLinearGradient(0, 0, 0, c.height)
        grad.addColorStop(0, '#fff3d6')
        grad.addColorStop(1, '#d6e8ff')
        g.fillStyle = grad
        g.fillRect(0, 0, c.width, c.height)
        g.strokeStyle = '#c33'
        g.lineWidth = 6
        g.strokeRect(3, 3, c.width - 6, c.height - 6)
        g.fillStyle = '#111'
        g.font = 'bold 56px sans-serif'
        g.fillText(`${m} ${w}x${h} 顶部`, 30, 80)
        g.fillText(`${m} 底部`, 30, c.height - 40)
        g.font = '36px sans-serif'
        for (let y = 160; y < c.height - 120; y += 160) g.fillText(`【详解】第 ${Math.round(y / 160)} 行 ${m}`, 30, y)
        return c.toDataURL('image/png').split(',')[1]
      },
      [width, height, mark] as const
    )
  const asset = (b64: string): string => {
    const bytes = Buffer.from(b64, 'base64')
    const name = assetName(bytes, 'png')
    writeFileSync(join(dataDir, 'assets', name), bytes)
    return `ewb-asset://${name}`
  }
  const tall1 = asset(await answerPng(700, 1500, 'K1'))
  const tall2 = asset(await answerPng(900, 3200, 'K2'))
  const short3 = asset(await answerPng(500, 160, 'K3'))
  const mkItem = (id: string, type: string, stem: string, answerImg: string, mark: string) => ({
    id,
    originQuestionId: null,
    sourceLabel: '来源丙',
    questionType: type,
    numberCount: 1,
    stemHtml: `<p>${stem}</p>`,
    answerHtml: `<p>【答案】${mark}</p><p><img src="${answerImg}"></p>`
  })
  const tallPaper = await call.create('整张答案图试卷')
  await call.saveDraft(tallPaper, {
    sections: [
      {
        id: 's1',
        title: '解答题',
        items: [
          mkItem('t1', '解答题-计算题', '计算：(−2)³ + |−5|', tall1, '标记1'),
          mkItem('t2', '解答题-问答题', '说明理由。', tall2, '标记2'),
          mkItem('t3', '解答题-计算题', '计算：4 ÷ (−2)', short3, '标记3')
        ]
      }
    ]
  })
  const tallDir = join(evidence, 'files-tall')
  rmSync(tallDir, { recursive: true, force: true })
  mkdirSync(tallDir, { recursive: true })
  const studentArea = await call.exportPaper(tallPaper, { ...student, format: 'docx', answerArea: true }, tallDir)
  const studentAreaXml = docxXml(studentArea.filePath)
  assert.equal(count(studentAreaXml, 'w:line="2041" w:lineRule="exact"'), 2, '两道「解答题-计算题」在名为「解答题」的大题里也留 36mm')
  assert.equal(count(studentAreaXml, 'w:line="1814" w:lineRule="exact"'), 1, '问答题留 32mm')
  const tallEndDocx = await call.exportPaper(tallPaper, { answerPosition: 'end', sourcePosition: 'answer', format: 'docx', answerArea: false }, tallDir)
  const tallAfterDocx = await call.exportPaper(tallPaper, { answerPosition: 'after', sourcePosition: 'none', format: 'docx', answerArea: false }, tallDir)
  const tallEndPdf = await call.exportPaper(tallPaper, { answerPosition: 'end', sourcePosition: 'answer', format: 'pdf', answerArea: false }, tallDir)
  const tallAfterPdf = await call.exportPaper(tallPaper, { answerPosition: 'after', sourcePosition: 'none', format: 'pdf', answerArea: false }, tallDir)
  const maxCy = Math.floor((215 / 25.4) * 96) * 9525 // 图片高度上限 215mm
  for (const f of [tallEndDocx, tallAfterDocx]) {
    const cys = [...docxXml(f.filePath).matchAll(/<wp:extent cx="\d+" cy="(\d+)"\/>/g)].map((m) => Number(m[1]))
    assert.equal(cys.length, 3)
    assert.ok(cys.every((cy) => cy <= maxCy), `${basename(f.filePath)} 里每张答案图都不高于 215mm：${cys.map((cy) => Math.round(cy / 9525))}px`)
  }
  for (const f of [tallEndPdf, tallAfterPdf]) {
    const rows = sh('pdfimages', ['-list', f.filePath]).split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c[2] === 'image')
    assert.equal(rows.length, 3)
    for (const c of rows) assert.ok((Number(c[4]) / Number(c[13])) * 72 <= 215 * mm + 1, `${basename(f.filePath)} PDF 里答案图显示高度不超过 215mm：第 ${c[0]} 页 ${c[3]}x${c[4]}px ${c[13]}ppi`)
    assert.ok(pdfText(f.filePath).includes('标记1') && pdfText(f.filePath).includes('标记3'))
  }
  // 卷尾答案：题号与它的答案图在同一页（题号不孤零零留在上一页）
  {
    const pages = pdfPages(tallEndPdf.filePath)
    const imgPages = sh('pdfimages', ['-list', tallEndPdf.filePath]).split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c[2] === 'image').map((c) => Number(c[0]))
    const keyPageText = (p: number): string => squash(sh('pdftotext', ['-f', String(p), '-l', String(p), tallEndPdf.filePath, '-']))
    ;['标记1', '标记2', '标记3'].forEach((mark, k) => {
      const text = keyPageText(imgPages[k])
      assert.ok(text.includes(`【答案】${mark}`), `答案「${mark}」的文字与它的图在同一页（第 ${imgPages[k]} 页）`)
    })
    const w = words(tallEndPdf.filePath).filter((x) => x.page > 1)
    for (const [label, mark] of [['1', '标记1'], ['2', '标记2'], ['3', '标记3']] as const) {
      const markPage = w.find((x) => x.text.includes(mark))?.page
      assert.ok(markPage, `找到 ${mark}`)
      assert.ok(w.some((x) => x.page === markPage && x.text === label && x.x < 90), `题号 ${label} 与「${mark}」在同一页（第 ${markPage} 页），没有留在上一页`)
    }
    console.log(`  整张答案图卷尾 PDF 共 ${pages} 页，三张答案图在第 ${imgPages.join('、')} 页`)
  }
  for (const [file, name] of [[tallEndPdf.filePath, 'i-tallans-end-pdf'], [tallAfterPdf.filePath, 'j-tallans-after-pdf']] as const) sh('pdftoppm', ['-r', '45', '-png', file, join(imagesDir, name)])
  const tallConv = join(tallDir, 'docx-as-pdf')
  sh('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tallConv, tallEndDocx.filePath, tallAfterDocx.filePath])
  for (const [file, name] of [[tallEndDocx.filePath, 'k-tallans-end-docx'], [tallAfterDocx.filePath, 'l-tallans-after-docx']] as const) sh('pdftoppm', ['-r', '45', '-png', join(tallConv, basename(file).replace('.docx', '.pdf')), join(imagesDir, name)])
  ok('整张答案图：Word 与 PDF 里显示高度都不超过 215mm；卷尾 PDF 里题号与答案图同页；「解答题-计算题」在「解答题」大题里留 36mm')

  console.log(`下载端到端测试通过：${checks} 组检查；证据在 ${evidence}`)
} finally {
  await app.close()
}
