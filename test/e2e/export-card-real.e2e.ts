// 用真实组卷网数据复核第二轮下载：数学卷（单选 + 填空 + 解答含小问与数据表）与英语卷（完形填空 + 阅读理解 + 书面表达）
// 各设好分值，各出学生版 PDF、教师版卷尾 DOCX（LibreOffice 转 PDF）、答题卡 PDF，全部转成图片供人工逐页对照。
// 用法：EWB_REAL_DATA=<真实数据目录的复制品> node test/e2e/export-card-real.e2e.ts <证据目录>
// 真实数据只读使用：会先复制到临时目录再打开，不改原件。教师版需要答案，而这批真题没有答案，所以给少数几题补示意答案，只用来看答案的版式。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { makeTempDir } from '../../scripts/temp-dir.ts'
import { checkBoxEdges, checkMarks } from '../../scripts/test-export-card-checks.ts'
import { buildCardDocument } from '../../src/main/export/card.ts'
import type { DraftSection, ExportOptions, LibraryQuestion, PaperDraft } from '../../src/shared/domain.ts'

const real = process.env.EWB_REAL_DATA
const evidence = process.argv[2]
if (!real || !evidence) throw new Error('用法：EWB_REAL_DATA=<数据目录> node test/e2e/export-card-real.e2e.ts <证据目录>')
for (const d of ['files', 'docx-as-pdf', 'images']) rmSync(join(evidence, d), { recursive: true, force: true })
const filesDir = join(evidence, 'files')
const convDir = join(evidence, 'docx-as-pdf')
const imagesDir = join(evidence, 'images')
for (const d of [filesDir, convDir, imagesDir]) mkdirSync(d, { recursive: true })
const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

buildTo('out-export3')
const dataDir = makeTempDir('ewb-real3-data-')
cpSync(real, dataDir, { recursive: true })
const { app, window } = await launchApp({ outDir: 'out-export3', dataDir, online: true })

try {
  const all = (await window.evaluate(() => window.workbench.library.listQuestions({ limit: 200 }))).items
  const byId = new Map<number, LibraryQuestion>(all.map((q) => [q.id, q]))
  const item = (id: number, score?: number, answer?: string): DraftSection['items'][number] => {
    const q = byId.get(id)
    if (!q) throw new Error(`真实数据里没有题目 ${id}`)
    return {
      id: `real-${id}`,
      originQuestionId: q.id,
      sourceLabel: q.sourceLabel,
      questionType: q.questionType,
      numberCount: q.numberCount,
      stemHtml: q.stemHtml,
      answerHtml: answer ? `<p>${answer}</p>` : q.answerHtml,
      ...(score === undefined ? {} : { score })
    }
  }
  const sec = (title: string, defaultScore: number, items: DraftSection['items']): DraftSection => ({ id: `sec-${title}`, title, defaultScore, items })

  const math: PaperDraft = {
    sections: [
      sec('选择题', 4, [item(2, undefined, '答案：B'), item(3, undefined, '答案：D'), item(4, undefined, '答案：A'), ...[5, 6, 7, 9, 10].map((id) => item(id))]),
      sec('预留的空大题', 4, []), // 没有题目的大题：试卷与答题卡都跳过，后面的大题序号顺延
      sec('填空题', 4, [11, 12, 13, 14, 15].map((id) => item(id, undefined, id === 11 ? '答案：<i>x</i>＝2' : undefined))),
      sec('解答题', 8, [16, 17, 18, 19].map((id) => item(id, undefined, id === 16 ? '解：原式＝－1＋2－3＝－2．' : undefined)).concat([item(20, 10, '解：（1）由题意得 <i>a</i>＋<i>b</i>＝0；（2）略．'), item(21), item(22), item(23, 12)]))
    ]
  }
  const english: PaperDraft = {
    sections: [
      sec('语音题', 2, [item(24)]),
      sec('单项选择', 2, [25, 26, 27, 28, 29, 30, 31, 32, 33, 34].map((id, k) => item(id, undefined, k === 0 ? 'A' : k === 1 ? 'C' : undefined))),
      sec('完形填空', 1, [item(35)]),
      sec('阅读理解', 2, [item(36), item(37), item(38), item(39)]),
      sec('任务型阅读', 2, [item(40)]),
      sec('短文填空', 1, [item(41)]),
      sec('书面表达', 10, [item(42), item(43, 15)])
    ]
  }

  const student: ExportOptions = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }
  const teacherEnd: ExportOptions = { answerPosition: 'end', sourcePosition: 'none', format: 'docx', answerArea: false }
  const expectBoxes = (title: string, draft: PaperDraft): number => buildCardDocument({ title, sections: draft.sections }).blocks.length + 1

  for (const [name, title, draft] of [
    ['math', '七年级数学第一单元阶段测试', math],
    ['english', '七年级英语 Starter Unit 1-3 阶段学情自测', english]
  ] as const) {
    const id = await window.evaluate((t) => window.workbench.papers.create(t), title)
    await window.evaluate(([i, d]) => window.workbench.papers.saveDraft(i as number, d as PaperDraft), [id, draft] as const)
    const run = (kind: 'paper' | 'answer-sheet', options: ExportOptions) =>
      window.evaluate(([p, k, o, d]) => window.workbench.exporter.exportPaper({ paperId: p as number, kind: k as 'paper' | 'answer-sheet', options: o as ExportOptions, directory: d as string }), [id, kind, options, filesDir] as const)
    const check = await window.evaluate(([p, o]) => window.workbench.exporter.checkExport(p as number, o as ExportOptions, 'paper'), [id, teacherEnd] as const)
    console.log(`${name} 自检：`, check.issues.map((i) => `${i.type}${i.blocking ? '（阻止）' : ''}:${i.questionLabel || i.sectionIndex}`).join(' | '))

    const studentPdf = await run('paper', student)
    const teacherDocx = await run('paper', teacherEnd)
    const sheet = await run('answer-sheet', student)
    // 空大题：试卷与答题卡都不出现，大题序号一致（数学卷中间插了一个空大题）
    const text = (pdf: string): string => sh('pdftotext', [pdf, '-']).replace(/\s+/g, '')
    const headingsOf = (pdf: string): string[] => [...text(pdf).matchAll(/[一二三四五六七]、[^（()\s一二三四五六七]{2,6}/g)].map((m) => m[0])
    for (const pdf of [studentPdf.filePath, sheet.filePath]) {
      assert.ok(!text(pdf).includes('预留的空大题'), `${basename(pdf)} 没有空大题`)
      const heads = headingsOf(pdf)
      if (name === 'math') assert.deepEqual(heads.slice(0, 3), ['一、选择题', '二、填空题', '三、解答题'], `${basename(pdf)} 大题序号顺延：${heads.join(' ')}`)
    }
    assert.deepEqual(checkMarks(sheet.filePath), [])
    assert.deepEqual(checkBoxEdges(sheet.filePath, expectBoxes(title, draft)), [])
    sh('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', convDir, teacherDocx.filePath])
    const teacherPdf = join(convDir, basename(teacherDocx.filePath).replace(/\.docx$/, '.pdf'))
    assert.ok(existsSync(teacherPdf))
    for (const [label, pdf] of [['学生版', studentPdf.filePath], ['教师版卷尾Word', teacherPdf], ['答题卡', sheet.filePath]] as const) {
      const prefix = join(imagesDir, `${name}-${label}`)
      sh('pdftoppm', ['-r', '100', '-png', pdf, prefix])
      console.log(`${name} ${label}：${sh('pdfinfo', [pdf]).match(/Pages:\s+\d+/)![0]} → ${prefix}-*.png`)
    }
  }
  console.log('真实数据复核完成；证据在', evidence)
} finally {
  await app.close().catch(() => undefined)
}
