// 用真实组卷网内容复核下载：入库线拆题 → 各挑几道有代表性的题组卷 → 学生版 PDF 与教师版卷尾 DOCX → 转图片人工看。
// 数学卷真实入库（打开组卷网试卷页 1 次，图片真实下载，用来看公式图清晰度与基线）；
// 英语、物理两份用 test/fixtures 里的真实页面样本经本机拦截入库（不产生外网访问，图片是占位图）。
// 教师版需要答案，而未登录时答案为空，所以组卷时给选中的题补一条示意答案，只用来看卷尾答案的版式。
// 会联网访问组卷网，默认不跑（设了 EWB_REAL_DATA 复用已入库数据时才不联网入库）。
// 用法：node test/e2e/export-real.e2e.ts [证据目录]
//   环境变量 EWB_REAL_DATA=<数据目录>：复用上一次已入库的数据目录（会复制到临时目录再用），不再打开组卷网，调试版式时用，避免重复访问。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { FIXTURES_DIR, skipWithoutFixtures } from '../../scripts/fixtures.ts'
import type { DraftSection, ExportOptions, LibraryQuestion, PaperDraft } from '../../src/shared/domain.ts'
import { primaryQuestionType } from '../../src/shared/library.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-export-real-'))
const FIXTURES = FIXTURES_DIR
const filesDir = join(evidence, 'files')
const convDir = join(evidence, 'docx-as-pdf')
for (const d of ['files', 'docx-as-pdf']) rmSync(join(evidence, d), { recursive: true, force: true })
for (const d of [filesDir, convDir]) mkdirSync(d, { recursive: true })
for (const f of readdirSync(evidence).filter((n) => /-(student-pdf|teacher-end-docx)-\d+\.png$/.test(n))) rmSync(join(evidence, f))

const MATH_URL = 'https://zujuan.xkw.com/2p3543573.html'
const ENGLISH_URL = 'https://zujuan.xkw.com/2p1111111.html'
const PHYSICS_URL = 'https://zujuan.xkw.com/2p4444444.html'

const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

skipWithoutFixtures('真实数据导出端到端')
buildTo('out-export3')
const reuse = process.env.EWB_REAL_DATA
let dataDir: string | undefined
if (reuse) {
  dataDir = mkdtempSync(join(tmpdir(), 'ewb-real-data-'))
  cpSync(reuse, dataDir, { recursive: true })
}
const { app, window } = await launchApp({ outDir: 'out-export3', dataDir, online: true })
const nav = (label: string) => window.getByRole('button', { name: label, exact: true })
const button = (label: string) => window.getByRole('button', { name: label, exact: true })

async function importUrls(urls: string[]): Promise<string> {
  await nav('采集').click()
  const open = button('粘贴链接入库')
  if (await open.isEnabled()) await open.click()
  await window.locator('.import-textarea').fill(urls.join('\n'))
  await button('开始入库').click()
  const summary = window.getByTestId('import-summary')
  await summary.waitFor({ timeout: 180_000 })
  const text = (await summary.innerText()).replace(/\s+/g, '')
  await button('确认入库').click()
  await window.getByTestId('import-result').waitFor({ timeout: 120_000 })
  const result = (await window.getByTestId('import-result').innerText()).replace(/\s+/g, '')
  await button('关闭').click()
  return `${text} → ${result}`
}

async function interceptOffline(app: ElectronApplication): Promise<void> {
  const pages = {
    '/2p1111111.html': readFileSync(join(FIXTURES, 'zujuan-english-7a.html'), 'utf8'),
    '/2p4444444.html': readFileSync(join(FIXTURES, 'zujuan-physics-8a.html'), 'utf8')
  }
  // 带标注文字的占位图（有效 PNG），每个地址内容不同
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  await app.evaluate(async ({ session }, { pages, png }) => {
    const ses = session.fromPartition('persist:zujuan')
    await ses.setProxy({ proxyRules: 'http://127.0.0.1:9' })
    const html = { 'content-type': 'text/html; charset=utf-8' }
    ses.protocol.handle('https', (request) => {
      const url = new URL(request.url)
      if (url.hostname === 'zujuan.xkw.com') return new Response((pages as Record<string, string>)[url.pathname] ?? '<!doctype html><html><body>组卷网</body></html>', { headers: html })
      if (/\.(xkw|zxxk)\.com$/.test(url.hostname)) {
        const head = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
        const tail = new TextEncoder().encode(request.url)
        const body = new Uint8Array(head.length + tail.length)
        body.set(head)
        body.set(tail, head.length)
        return new Response(body, { headers: { 'content-type': 'image/png' } })
      }
      return new Response('', { status: 404 })
    })
  }, { pages, png })
}

interface Pool {
  name: string
  paperId: number
  questions: LibraryQuestion[]
}

const has = (q: LibraryQuestion, part: string): boolean => q.stemHtml.includes(part) || (q.answerHtml ?? '').includes(part)
const features = (qs: LibraryQuestion[]): Record<string, number> => ({
  题目: qs.length,
  公式或配图: qs.filter((q) => has(q, '<img')).length,
  带框线的数据表: qs.filter((q) => has(q, 'data-role="bordered"')).length,
  着重号: qs.filter((q) => has(q, 'data-role="dot"')).length,
  选项表号码格: qs.filter((q) => has(q, 'data-role="option-label"')).length,
  书面表达横线: qs.filter((q) => has(q, 'data-role="writing-lines"')).length,
  右对齐段落: qs.filter((q) => has(q, 'data-role="right-aligned"')).length,
  多小题块: qs.filter((q) => q.numberCount > 1).length
})

try {
  await nav('采集').waitFor()
  if (!reuse) {
    console.log('入库')
    console.log('  数学（真实在线）：' + (await importUrls([MATH_URL])))
    await interceptOffline(app)
    console.log('  英语、物理（真实页面样本）：' + (await importUrls([ENGLISH_URL, PHYSICS_URL])))
  } else {
    console.log(`复用已入库的数据目录：${reuse}`)
  }

  const all = (await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1000 }))).items.sort((a, b) => a.id - b.id)
  const papers = await window.evaluate(() => window.workbench.library.listSourcePapers())
  const pools: Pool[] = papers.map((p) => ({ name: /数学/.test(p.title) ? 'math' : /英语/.test(p.title) ? 'english' : 'physics', paperId: p.id, questions: all.filter((q) => q.sourcePaperId === p.id) }))
  for (const pool of pools) console.log(`  ${pool.name}：${JSON.stringify(features(pool.questions))}`)
  mkdirSync(join(evidence, 'dump'), { recursive: true })
  writeFileSync(join(evidence, 'dump/all-questions.json'), JSON.stringify(all, null, 1))

  // 每个样本按「题型 + 版式特征」挑题，已挑过的不重复
  const choose = (qs: LibraryQuestion[], rules: [(q: LibraryQuestion) => boolean, number][]): LibraryQuestion[] => {
    const chosen: LibraryQuestion[] = []
    for (const [pred, n] of rules) {
      for (const q of qs.filter((x) => pred(x) && !chosen.includes(x)).slice(0, n)) chosen.push(q)
    }
    return chosen.sort((a, b) => a.id - b.id)
  }
  const bucket = (name: string): LibraryQuestion[] => pools.find((p) => p.name === name)!.questions
  const type = (re: RegExp) => (q: LibraryQuestion): boolean => re.test(q.questionType)
  const feature = (part: string) => (q: LibraryQuestion): boolean => has(q, part)
  const withImg = (re: RegExp) => (q: LibraryQuestion): boolean => re.test(q.questionType) && has(q, '<img')
  const selections: Record<string, LibraryQuestion[]> = {
    math: choose(bucket('math'), [
      [withImg(/选择|单选/), 3], [withImg(/填空/), 2], [feature('data-role="bordered"'), 2], [feature('data-role="dot"'), 1],
      [type(/计算/), 2], [type(/作图/), 1], [withImg(/解答/), 1]
    ]),
    english: choose(bucket('english'), [
      [type(/单项选择|单选/), 2], [(q) => /完形/.test(q.questionType) && q.numberCount > 1, 1], [feature('data-role="option-label"'), 2],
      [(q) => /阅读/.test(q.questionType) && q.numberCount > 1, 1], [feature('data-role="writing-lines"'), 2], [feature('data-role="bordered"'), 1]
    ]),
    physics: choose(bucket('physics'), [
      [withImg(/选择|单选/), 2], [type(/填空/), 1], [type(/实验/), 2], [feature('data-role="dot"'), 1], [feature('data-role="bordered"'), 1], [type(/简答|计算/), 2]
    ])
  }
  for (const [name, qs] of Object.entries(selections)) {
    console.log(`  ${name} 选题：` + qs.map((q) => `#${q.id}[${q.questionType}${q.numberCount > 1 ? `×${q.numberCount}` : ''}${Object.entries(features([q])).filter(([k, v]) => k !== '题目' && k !== '多小题块' && v > 0).map(([k]) => '+' + k).join('')}]`).join(' '))
    assert.ok(qs.length >= 4, `${name} 至少要挑到 4 道`)
  }

  // ---------- 组卷并下载 ----------
  const titles: Record<string, string> = { math: '真实数学样卷', english: '真实英语样卷', physics: '真实物理样卷' }
  const outputs: { name: string; file: string; kind: 'pdf' | 'docx' }[] = []
  for (const [name, qs] of Object.entries(selections)) {
    const sections: DraftSection[] = []
    for (const q of qs) {
      const title = primaryQuestionType(q.questionType)
      let section = sections.find((s) => s.title === title)
      if (!section) sections.push((section = { id: `s${sections.length}`, title, items: [] }))
      section.items.push({
        id: `i${q.id}`,
        originQuestionId: q.id,
        sourceLabel: q.sourceLabel,
        questionType: q.questionType,
        numberCount: q.numberCount,
        stemHtml: q.stemHtml,
        answerHtml: q.answerHtml ?? '<p>【答案】示意答案（未登录时答案为空，这里只用来看卷尾版式）</p><p>【详解】略</p>'
      })
    }
    const draft: PaperDraft = { sections }
    const paperId = await window.evaluate((t) => window.workbench.papers.create(t), titles[name])
    await window.evaluate(([id, d]) => window.workbench.papers.saveDraft(id as number, d as PaperDraft), [paperId, draft] as const)
    const student: ExportOptions = { answerPosition: 'none', sourcePosition: 'before-stem', format: 'pdf', answerArea: true }
    const teacher: ExportOptions = { answerPosition: 'end', sourcePosition: 'answer', format: 'docx', answerArea: true }
    for (const options of [student, teacher]) {
      const r = await window.evaluate(([p, o, d]) => window.workbench.exporter.exportPaper({ paperId: p as number, kind: 'paper', options: o as ExportOptions, directory: d as string }), [paperId, options, filesDir] as const)
      outputs.push({ name, file: r.filePath, kind: options.format })
      console.log(`  ${basename(r.filePath)}（v${r.versionNo}）`)
    }
  }

  // ---------- 转图片 ----------
  const images: string[] = []
  for (const o of outputs) {
    let pdf = o.file
    if (o.kind === 'docx') {
      sh('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', convDir, o.file])
      pdf = join(convDir, basename(o.file).replace('.docx', '.pdf'))
    }
    const prefix = `${o.name}-${o.kind === 'pdf' ? 'student-pdf' : 'teacher-end-docx'}`
    sh('pdftoppm', ['-r', '90', '-png', pdf, join(evidence, prefix)])
    images.push(prefix)
    const pages = Number(/Pages:\s+(\d+)/.exec(sh('pdfinfo', [pdf]))![1])
    console.log(`  ${prefix}：${pages} 页`)
    // 内容没有残留的占位符或内部标记
    const text = sh('pdftotext', [pdf, '-'])
    assert.doesNotMatch(text, /data-ewb|data-role|ewb-asset|undefined|\[object/, `${prefix} 文字里不应有内部标记`)
  }
  console.log('完成，图片：' + images.join('、') + `；证据在 ${evidence}`)
} finally {
  await app.close()
}
