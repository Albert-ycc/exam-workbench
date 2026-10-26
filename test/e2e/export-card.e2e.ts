// 答题卡与第二轮下载改动的端到端测试：在真实应用里下载答题卡 PDF，量四角定位块、核对黑框不被分页拆开、
// 页脚「标题 答题卡 第 N 页（共 M 页）」，核对页数与 PDF 实际页数一致；Word 选项宽度改为隐藏窗口实测；
// 试卷与 Word 的页脚「第N页（共M页）」；自检、预览重名的真实接口。
// 检查本身要反向验证：故意把定位块偏移改大、把黑框的 break-inside 去掉，确认检查会变红。
// 用法：node test/e2e/export-card.e2e.ts [证据目录]；需要本机有 pdftotext / pdftoppm / pdfinfo，Word 复核用 LibreOffice（soffice）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { fixSeedPng, sampleDraft } from '../../scripts/test-export-fixtures.ts'
import { checkBoxEdges, checkMarks, horizontalEdges } from '../../scripts/test-export-card-checks.ts'
import { buildCardDocument } from '../../src/main/export/card.ts'
import { renderCardHtml } from '../../src/main/export/render-card-html.ts'
import type { DraftSection, ExportOptions, PaperDraft, PaperItem } from '../../src/shared/domain.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-export-card-'))
const filesDir = join(evidence, 'files')
for (const d of ['files', 'mutants', 'docx-as-pdf', 'preview']) rmSync(join(evidence, d), { recursive: true, force: true })
for (const d of [filesDir, join(evidence, 'mutants'), join(evidence, 'docx-as-pdf')]) mkdirSync(d, { recursive: true })

const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const pdfPages = (file: string): number => Number(/Pages:\s+(\d+)/.exec(sh('pdfinfo', [file]))![1])
const pageText = (file: string, page: number): string => sh('pdftotext', ['-f', String(page), '-l', String(page), '-layout', file, '-'])
const squash = (s: string): string => s.replace(/\s+/g, '')
let checks = 0
const ok = (name: string): void => {
  checks++
  console.log('  ✓ ' + name)
}

// ---------- 样例：6 道样例题的一份卷，加一份压力卷（25 选择、12 填空、30 解答含 0～5 个小问、2 道书面表达） ----------
let seed = 12345
const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
let uid = 0
const mk = (questionType: string, stemHtml: string, extra: Partial<PaperItem> = {}): PaperItem => ({
  id: `st${++uid}`,
  originQuestionId: null,
  sourceLabel: '',
  questionType,
  numberCount: 1,
  stemHtml,
  answerHtml: null,
  ...extra
})
const subs = (id: number, n: number): string => `<p>题干${id}</p>` + Array.from({ length: n }, (_, k) => `<p>(${k + 1})小问${k + 1}；</p>`).join('')
function stressDraft(): PaperDraft {
  const sec = (title: string, defaultScore: number, items: PaperItem[]): DraftSection => ({ id: `ss${++uid}`, title, defaultScore, items })
  return {
    sections: [
      sec('选择题', 3, Array.from({ length: 25 }, (_, k) => mk('单选题', `<p>选择${k + 1}</p>`))),
      sec('填空题', 4, Array.from({ length: 12 }, (_, k) => mk('填空题', `<p>填空${k + 1}______</p>`))),
      sec('解答题', 8, Array.from({ length: 30 }, (_, k) => mk('解答题-计算题', subs(k + 1, Math.floor(rnd() * 6))))),
      sec('书面表达', 15, [mk('书面表达-看图作文', '<p>写一篇短文。</p>'), mk('书面表达-材料作文', `<p>写作。</p><div data-role="writing-lines">${'_'.repeat(500)}</div>`)])
    ]
  }
}

buildTo('out-export3')
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-card-data-'))
seedDataDir(dataDir)
fixSeedPng(dataDir)
const launched = await launchApp({ outDir: 'out-export3', dataDir })
const { app, window } = launched
const student: ExportOptions = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }
const call = {
  create: (title: string) => window.evaluate((t) => window.workbench.papers.create(t), title),
  saveDraft: (id: number, draft: PaperDraft) => window.evaluate(([i, d]) => window.workbench.papers.saveDraft(i as number, d as PaperDraft), [id, draft] as const),
  versions: (id: number) => window.evaluate((i) => window.workbench.papers.listVersions(i), id),
  sheet: (paperId: number, directory: string) => window.evaluate(([p, d]) => window.workbench.exporter.exportPaper({ paperId: p as number, kind: 'answer-sheet', options: { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }, directory: d as string }), [paperId, directory] as const),
  paper: (paperId: number, options: ExportOptions, directory: string) => window.evaluate(([p, o, d]) => window.workbench.exporter.exportPaper({ paperId: p as number, kind: 'paper', options: o as ExportOptions, directory: d as string }), [paperId, options, directory] as const),
  preview: (paperId: number, kind: 'paper' | 'answer-sheet', directory?: string) => window.evaluate(([p, k, d]) => window.workbench.exporter.previewFileName(p as number, { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }, k as 'paper' | 'answer-sheet', d as string | undefined), [paperId, kind, directory] as const),
  check: (paperId: number, options: ExportOptions, kind: 'paper' | 'answer-sheet') => window.evaluate(([p, o, k]) => window.workbench.exporter.checkExport(p as number, o as ExportOptions, k as 'paper' | 'answer-sheet'), [paperId, options, kind] as const)
}
// 把一份 HTML 在应用的隐藏窗口里按答题卡的方式打印成 PDF（反向验证用：打印的是被故意改坏的页面）
async function printMutant(html: string, name: string): Promise<string> {
  const htmlFile = join(evidence, 'mutants', `${name}.html`)
  writeFileSync(htmlFile, html)
  const b64 = await app.evaluate(async ({ BrowserWindow }, file) => {
    const win = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await win.loadFile(file)
      return (await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })).toString('base64')
    } finally {
      win.destroy()
    }
  }, htmlFile)
  const pdf = join(evidence, 'mutants', `${name}.pdf`)
  writeFileSync(pdf, Buffer.from(b64, 'base64'))
  return pdf
}

try {
  const page = await window.evaluate(() => window.workbench.library.listQuestions({}))
  const questions = page.items.sort((a, b) => a.id - b.id)
  const sample = sampleDraft(questions)
  sample.sections.forEach((s, k) => (s.defaultScore = [3, 4, 8, 10, 1, 15][k]))
  const sampleId = await call.create('七年级数学答题卡样例')
  await call.saveDraft(sampleId, sample)
  const stressId = await call.create('压力样卷')
  const stress = stressDraft()
  stress.targetScore = 600
  await call.saveDraft(stressId, stress)

  // ---------- 一、答题卡 PDF：下载、定位块、黑框、页脚、页数 ----------
  console.log('答题卡 PDF')
  const sheetSample = await call.sheet(sampleId, filesDir)
  assert.equal(basename(sheetSample.filePath), '七年级数学答题卡样例_v1_答题卡.pdf')
  assert.deepEqual([sheetSample.kind, sheetSample.versionNo, sheetSample.createdVersion, sheetSample.missingAnswers], ['answer-sheet', 1, true, []])
  assert.equal(readFileSync(sheetSample.filePath).subarray(0, 4).toString(), '%PDF')
  assert.equal(sheetSample.pageCount, pdfPages(sheetSample.filePath), '返回的页数与 pdfinfo 一致')
  const sampleBoxes = buildCardDocument({ title: '七年级数学答题卡样例', sections: sample.sections }).blocks.length + 1 // 加信息框
  assert.deepEqual(checkMarks(sheetSample.filePath), [])
  assert.deepEqual(checkBoxEdges(sheetSample.filePath, sampleBoxes), [])
  ok(`样例卷答题卡 ${sheetSample.pageCount} 页：四角定位块误差 ≤0.5mm，每页黑框横边成对；页数与 pdfinfo 一致`)

  const sheetStress = await call.sheet(stressId, filesDir)
  const stressPages = pdfPages(sheetStress.filePath)
  assert.equal(sheetStress.pageCount, stressPages)
  assert.ok(stressPages >= 10, `压力卷应有很多页，实际 ${stressPages}`)
  const doc = buildCardDocument({ title: '压力样卷', sections: stress.sections })
  const stressBoxes = doc.blocks.length + 1
  assert.deepEqual(checkMarks(sheetStress.filePath), [])
  assert.deepEqual(checkBoxEdges(sheetStress.filePath, stressBoxes), [])
  const edgeCount = horizontalEdges(sheetStress.filePath).reduce((n, e) => n + e.length, 0)
  assert.equal(edgeCount / 2, stressBoxes)
  ok(`压力卷答题卡 ${stressPages} 页：${doc.blocks.length} 个答题框 + 信息框共 ${edgeCount / 2} 个黑框，每页横边成对、总数与版面块数一致（没有被分页拆开）；定位块每页四角都在`)

  // 页脚与每页顶部提示
  for (const [file, title, pages] of [[sheetSample.filePath, '七年级数学答题卡样例', sheetSample.pageCount!], [sheetStress.filePath, '压力样卷', stressPages]] as const) {
    for (let n = 1; n <= pages; n++) {
      const text = squash(pageText(file, n))
      assert.ok(text.includes(squash(`${title} 答题卡　第 ${n} 页（共 ${pages} 页）`)), `${basename(file)} 第 ${n} 页页脚`)
      const tip = squash('请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效')
      assert.equal(text.split(tip).length - 1, n === 1 ? 2 : 1, `第 ${n} 页提示行：第一页是信息框下的一行加注意事项里的一句，其余页是页顶一行`)
    }
  }
  assert.ok(squash(pageText(sheetSample.filePath, 1)).includes(squash('七年级数学答题卡样例　答题卡')), '标题「试卷名 答题卡」')
  assert.ok(squash(pageText(sheetSample.filePath, 1)).includes('班级') && squash(pageText(sheetSample.filePath, 1)).includes('注意事项'))
  ok('页脚「试卷名 答题卡　第 N 页（共 M 页）」逐页核对；提示行第一页在信息框下、其余页在页顶；标题与信息框齐全')

  // ---------- 二、反向验证：检查要能抓到故意改坏的版面 ----------
  console.log('反向验证')
  const goodHtml = renderCardHtml(buildCardDocument({ title: '压力样卷', sections: stress.sections }))
  const sane = await printMutant(goodHtml, 'sane')
  assert.deepEqual([checkMarks(sane), checkBoxEdges(sane, stressBoxes)], [[], []], '未改动的页面通过检查（应用外同一份 HTML 重新打印的结果）')
  assert.equal(pdfPages(sane), stressPages, '应用里生成的与这里重新打印的页数一致')
  const shifted = goodHtml.replaceAll('6.8mm', '9.8mm')
  assert.notEqual(shifted, goodHtml)
  const shiftedProblems = checkMarks(await printMutant(shifted, 'marks-shifted'))
  assert.ok(shiftedProblems.length > 0 && shiftedProblems.every((p) => p.includes('偏离')), `定位块偏移改大 3mm 后 checkMarks 报错：${shiftedProblems[0]}`)
  // 只去掉 break-inside：框被拆成两片，每片靠 box-decoration-break: clone 补上边，横边仍成对，要靠总数发现
  const unbroken = goodHtml.replace('break-inside: avoid;', '')
  assert.notEqual(unbroken, goodHtml)
  const cloneSplit = checkBoxEdges(await printMutant(unbroken, 'box-split-clone'), stressBoxes)
  assert.ok(cloneSplit.some((p) => p.includes('被拆成了几片')), `只去掉 break-inside 后黑框总数对不上：${cloneSplit.join('；')}`)
  // 两样都去掉：框被拆开且缺边，横边不成对
  const splitProblems = checkBoxEdges(await printMutant(unbroken.replace('box-decoration-break: clone;', ''), 'box-split'), stressBoxes)
  assert.ok(splitProblems.some((p) => p.includes('不成对')), `再去掉 box-decoration-break 后有页的横边不成对：${splitProblems.join('；')}`)
  const noMarks = checkMarks(await printMutant(goodHtml.replace(/@(top|bottom)-(left|right)-corner \{[^}]*\}/g, ''), 'marks-missing'))
  assert.ok(noMarks.some((p) => p.includes('没有定位块')))
  ok(`反向验证：定位块偏移 +3mm → ${shiftedProblems.length} 条「偏离」；去掉 break-inside → ${cloneSplit[cloneSplit.length - 1]}；再去掉 clone → ${splitProblems[0]}；去掉定位块 → 报「没有定位块」；原样打印通过`)

  // ---------- 三、试卷 PDF 页脚、Word 页脚与选项实测宽度 ----------
  console.log('试卷与 Word')
  // 试卷样例：设了分值，抬头有全卷满分、大题说明、题号后的分值
  const paperPdf = await call.paper(sampleId, student, filesDir)
  assert.equal(paperPdf.pageCount, pdfPages(paperPdf.filePath))
  const paperText = squash(sh('pdftotext', [paperPdf.filePath, '-']))
  assert.ok(paperText.includes('（全卷满分：43分）'), '抬头有全卷满分')
  for (let n = 1; n <= paperPdf.pageCount!; n++) assert.ok(paperText.includes(`第${n}页（共${paperPdf.pageCount}页）`), `试卷 PDF 第 ${n} 页页脚`)
  assert.ok(paperText.includes('班级') && paperText.includes('座号') && paperText.includes('小组') && paperText.includes('姓名'))
  assert.ok(paperText.includes('一、选择题（每题3分）（共1小题，每小题3分，共3分）'), '大题标题后接分值说明')
  assert.ok(paperText.includes('1．(本题3分)'), '题号后接本题分值')
  ok(`试卷 PDF ${paperPdf.pageCount} 页：页脚「第N页（共${paperPdf.pageCount}页）」逐页；抬头有全卷满分与班级座号小组姓名；大题说明与题号后分值都在`)

  const teacherDocx = await call.paper(sampleId, { ...student, answerPosition: 'end', format: 'docx' }, filesDir)
  assert.equal(teacherDocx.pageCount, null, 'Word 的页数要打开后才知道')
  sh('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', join(evidence, 'docx-as-pdf'), teacherDocx.filePath])
  const converted = join(evidence, 'docx-as-pdf', basename(teacherDocx.filePath).replace(/\.docx$/, '.pdf'))
  const convPages = pdfPages(converted)
  const convText = squash(sh('pdftotext', [converted, '-']))
  for (let n = 1; n <= convPages; n++) assert.ok(convText.includes(`第${n}页（共${convPages}页）`), `Word 转 PDF 第 ${n} 页页脚`)
  assert.ok(convText.includes('（全卷满分：') && convText.includes('班级') && convText.includes('姓名'))
  ok(`Word（LibreOffice 转 PDF ${convPages} 页）：页脚「第N页（共${convPages}页）」与 PDF 一致，抬头有全卷满分与填写行`)

  // 选项实测宽度：「WWWWWWWWWWWW」这类宽字母，估算（每个西文半个汉字宽）会让 4 个选项排成一行，按 Times New Roman 实测放不下
  const wide = await call.create('选项测宽')
  const optionRow = ['A', 'B', 'C', 'D'].map((l) => `<td>${l}．${'W'.repeat(15)}</td>`).join('')
  await call.saveDraft(wide, { sections: [{ id: 'w', title: '选择题', items: [mk('单选题', `<p>题干</p><table data-role="options"><tbody><tr>${optionRow}</tr></tbody></table>`)] }] })
  const wideDocx = await call.paper(wide, { ...student, format: 'docx' }, filesDir)
  const wideXml = sh('unzip', ['-p', wideDocx.filePath, 'word/document.xml'])
  const optionPara = wideXml.split('</w:p>').find((p) => p.includes('A．'))!
  const tabs = (optionPara.match(/<w:tab\/>/g) ?? []).length
  assert.ok(tabs < 3, `实测 Times New Roman：15 个大写 W 的 4 个选项一行放不下，应少于 3 个制表符，实际 ${tabs}`)
  ok(`Word 选项宽度按隐藏窗口里的实际字体测量：4 个「W×15」选项一行放不下，制表符 ${tabs} 个（按旧估算会排成 3 个）`)

  // ---------- 四、自检、预览重名、记录的真实接口 ----------
  console.log('自检与预览')
  const emptyId = await call.create('空卷')
  const emptyCheck = await call.check(emptyId, student, 'paper')
  assert.deepEqual([emptyCheck.blocked, emptyCheck.issues.map((i) => i.type)], [true, ['empty-paper']])
  const stressCheck = await call.check(stressId, { ...student, answerPosition: 'end' }, 'paper')
  assert.deepEqual(stressCheck.issues.map((i) => i.type), ['no-answers', 'score-mismatch'], '压力卷：全部没有答案（阻止）、分值合计与目标不符')
  assert.equal(stressCheck.blocked, true)
  assert.equal(stressCheck.answerMissingCount, stressCheck.questionCount)
  assert.equal(stressCheck.issues[0].questionLabel, '1～69')
  assert.match(stressCheck.issues[1].message, /合计 393 分，目标满分 600 分，还差 207 分/)
  ok('自检接口：空卷阻止下载；全部没有答案选卷尾阻止，列出题号 1～69；目标满分不符给出差额')

  const dir = join(evidence, 'preview')
  mkdirSync(dir, { recursive: true })
  const sampleSheetName = await call.preview(sampleId, 'answer-sheet', dir)
  assert.equal(sampleSheetName, '七年级数学答题卡样例_v1_答题卡.pdf')
  writeFileSync(join(dir, sampleSheetName), '别处的同名文件')
  assert.equal(await call.preview(sampleId, 'answer-sheet', dir), '七年级数学答题卡样例_v1_答题卡 (2).pdf')
  const placed = await call.sheet(sampleId, dir)
  assert.equal(basename(placed.filePath), '七年级数学答题卡样例_v1_答题卡 (2).pdf')
  assert.equal(readFileSync(join(dir, sampleSheetName), 'utf8'), '别处的同名文件')
  ok('预览文件名带保存位置：同名文件已存在时预先给出「(2)」，与实际落盘一致，已有文件不被覆盖')

  // 重新下载答题卡：按记录的类型生成，仍是答题卡
  const record = (await call.versions(sampleId))[0].exports.find((e) => e.kind === 'answer-sheet' && e.filePath === sheetSample.filePath)!
  const again = await window.evaluate((id) => window.workbench.exporter.reexport(id), record.id)
  assert.deepEqual([again.kind, again.filePath, again.versionNo, again.createdVersion], ['answer-sheet', sheetSample.filePath, 1, false])
  assert.deepEqual(checkMarks(again.filePath), [])
  const versions = await call.versions(sampleId)
  assert.ok(versions.every((v) => v.note === '下载时自动保存'), '版本说明不含格式')
  assert.ok(existsSync(join(launched.userDataDir, 'export-settings.json')))
  const defaults = await window.evaluate(() => window.workbench.exporter.getDefaults())
  assert.equal(defaults.options.format, 'docx', '设置里记的是最近一次试卷下载的配置（Word），下载答题卡不改它')
  ok('按下载记录重新下载答题卡：仍是答题卡、定位块在位；版本说明「下载时自动保存」；设置里只记试卷配置')

  console.log(`答题卡端到端测试通过：${checks} 组检查；证据在 ${evidence}`)
} finally {
  await launched.app.close().catch(() => undefined)
}
