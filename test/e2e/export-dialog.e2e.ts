// 下载弹窗端到端测试：把 DownloadDialog 单独打成一个测试页，放进应用主窗口（带真实的预加载接口），
// 覆盖：试卷 / 答题卡切换、学生版与教师版（卷尾、题后）、来源与作答区域说明、下载前自检（阻止项与可点题号）、
// 文件名预览的重名序号、一次下载两份、生成中锁定、完成态可再下载、整卷没有答案与空试卷的禁用态、出错。
// 关键界面在 1440×900 与 1000×640（最小窗口）各截一张。编辑器界面不参与。
// 用法：node test/e2e/export-dialog.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { build } from 'vite'
import { buildTo, launchApp, ROOT } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { fixSeedPng, sampleDraft } from '../../scripts/test-export-fixtures.ts'
import type { ExportResult } from '../../src/shared/export.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-export-dialog-'))
mkdirSync(evidence, { recursive: true })
for (const f of readdirSync(evidence).filter((n) => /-\d+x\d+\.png$/.test(n))) rmSync(join(evidence, f))

// ---------- 测试页：只含 DownloadDialog，样式与应用一致 ----------
const harness = join(ROOT, 'node_modules/.cache/ewb-export-harness')
rmSync(harness, { recursive: true, force: true })
mkdirSync(join(harness, 'src'), { recursive: true })
writeFileSync(
  join(harness, 'src/index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>下载弹窗</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ewb-asset:" />
</head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`
)
writeFileSync(
  join(harness, 'src/main.tsx'),
  `import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DownloadDialog from '../../../../src/renderer/src/components/DownloadDialog'
import '../../../../src/renderer/src/styles.css'

function Harness() {
  const paperId = Number(new URLSearchParams(location.search).get('paperId'))
  const [open, setOpen] = useState(true)
  const [kind, setKind] = useState<'paper' | 'answer-sheet'>('paper')
  const [exported, setExported] = useState<unknown[]>([])
  const [located, setLocated] = useState<number[]>([])
  const show = (k: 'paper' | 'answer-sheet') => { setKind(k); setExported([]); setOpen(true) }
  return (
    <div style={{ padding: 24 }}>
      <button type="button" id="open-dialog" onClick={() => show('paper')}>下载</button>
      <button type="button" id="open-sheet" onClick={() => show('answer-sheet')}>下载答题卡</button>
      <pre id="exported">{JSON.stringify(exported)}</pre>
      <pre id="located">{JSON.stringify(located)}</pre>
      <DownloadDialog paperId={paperId} open={open} initialKind={kind} onClose={() => setOpen(false)} onExported={(r) => setExported((list) => [...list, r])} onLocate={(no) => setLocated((list) => [...list, no])} />
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
`
)
await build({
  root: join(harness, 'src'),
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@shared': join(ROOT, 'src/shared') } },
  build: { outDir: join(harness, 'dist'), emptyOutDir: true }
})

buildTo('out-export3')
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-dialog-data-'))
seedDataDir(dataDir)
fixSeedPng(dataDir)
const userDataDir = mkdtempSync(join(tmpdir(), 'ewb-dialog-user-'))
const saveDir = mkdtempSync(join(tmpdir(), 'ewb-dialog-save-')) // 首次默认保存位置
const otherDir = mkdtempSync(join(tmpdir(), 'ewb-dialog-other-'))
// 默认保存位置是系统「下载」文件夹；测试里用设置文件指向临时文件夹，不往真实下载文件夹写东西
const STUDENT = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }
const settingsFile = join(userDataDir, 'export-settings.json')
writeFileSync(settingsFile, JSON.stringify({ options: STUDENT, directory: saveDir }))

const { app, window } = await launchApp({ outDir: 'out-export3', dataDir, userDataDir })
let steps = 0
const ok = (name: string): void => {
  steps++
  console.log('  ✓ ' + name)
}
const SIZES = [
  [1440, 900],
  [1000, 640]
] as const
// 关键界面各尺寸截一张
// reveal：改窗口大小后要重新滚到可见的元素（弹窗正文窄时会滚动）
async function shot(name: string, reveal?: string): Promise<void> {
  for (const [w, h] of SIZES) {
    await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h])
    await window.waitForTimeout(250)
    if (reveal) await window.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'nearest' }), reveal)
    await window.screenshot({ path: join(evidence, `${name}-${w}x${h}.png`) })
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
}
const pdfPagesOf = (file: string): number => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))![1])

try {
  const questions = (await window.evaluate(() => window.workbench.library.listQuestions({}))).items.sort((a, b) => a.id - b.id)
  const mkPaper = async (title: string, mutate?: (d: ReturnType<typeof sampleDraft>) => void): Promise<number> => {
    const id = await window.evaluate((t) => window.workbench.papers.create(t), title)
    const draft = sampleDraft(questions)
    mutate?.(draft)
    await window.evaluate(([i, d]) => window.workbench.papers.saveDraft(i as number, d as never), [id, draft] as const)
    return id
  }
  // 题号：选择 1、填空 2、计算 3、解答 4、完形 5～7、书面表达 8。样例里第 4、8 题没有答案；书面表达没设分值
  const paperA = await mkPaper('七年级数学第一单元测试', (d) => d.sections.forEach((s, k) => k < 5 && (s.defaultScore = [3, 4, 8, 10, 1][k])))
  const paperB = await mkPaper('没有答案的试卷', (d) =>
    d.sections.forEach((s) => {
      s.defaultScore = 2
      s.items.forEach((i) => (i.answerHtml = null))
    })
  )
  const paperC = await window.evaluate(() => window.workbench.papers.create('空试卷'))
  const paperD = await mkPaper('重名预览卷', (d) => d.sections.forEach((s) => (s.defaultScore = 2)))
  const open = async (paperId: number): Promise<void> => {
    await app.evaluate(({ BrowserWindow }, args) => BrowserWindow.getAllWindows()[0].loadFile(args.file, { query: { paperId: String(args.paperId) } }), {
      file: join(harness, 'dist/index.html'),
      paperId
    })
    await window.getByRole('dialog').waitFor()
  }
  await open(paperA)

  // 文件夹相关的系统调用换成记录用的替身，避免真的弹出系统窗口
  await app.evaluate(({ dialog, shell }, other) => {
    const g = globalThis as unknown as { __shown: string[]; __pick: string }
    g.__shown = []
    g.__pick = other
    shell.showItemInFolder = ((p: string) => g.__shown.push(p)) as never
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [g.__pick] })) as never
  }, otherDir)

  const dialog = window.getByRole('dialog', { name: /^下载(试卷|答题卡)$/ })
  const group = (name: string) => dialog.getByRole('radiogroup', { name, exact: true })
  const radio = (name: string, label: string) => group(name).getByRole('radio', { name: label, exact: true })
  const optionLabels = (name: string) => group(name).getByRole('radio').evaluateAll((els) => els.map((e) => e.closest('label')!.innerText))
  const pathText = () => dialog.locator('.dl-path-text').innerText()
  const primary = () => dialog.getByRole('button', { name: /^(下载|重新生成|正在生成…)/ }).last()
  const settle = () => window.waitForTimeout(200)
  const located = async (): Promise<number[]> => JSON.parse(await window.locator('#located').innerText()) as number[]
  const exported = async (): Promise<ExportResult[]> => JSON.parse(await window.locator('#exported').innerText()) as ExportResult[]
  const issue = (text: string) => dialog.locator('.dl-check li').filter({ hasText: text })
  const waitNames = (expected: string[]) => window.waitForFunction((want) => JSON.stringify([...document.querySelectorAll('.dl-name-text')].map((e) => e.textContent)) === JSON.stringify(want), expected)

  // ---------- 一、试卷页默认：学生版 ----------
  assert.equal(await dialog.getByRole('heading', { name: '下载试卷' }).count(), 1, '标题跟随页签')
  assert.deepEqual(await optionLabels('下载内容'), ['试卷', '答题卡'])
  assert.ok(await radio('下载内容', '试卷').isChecked(), '默认打开试卷页')
  assert.deepEqual((await dialog.locator('.dl-label').allInnerTexts()).filter(Boolean), ['版别', '试题来源', '作答区域', '文件格式', '保存位置', '文件名'], '学生版没有「答案位置」一行')
  assert.deepEqual(await optionLabels('版别'), ['学生版', '教师版'])
  assert.deepEqual(await optionLabels('试题来源'), ['不显示', '题文前', '答案处'])
  assert.deepEqual(await optionLabels('作答区域'), ['不留', '留作答区域'])
  assert.deepEqual(await optionLabels('文件格式'), ['PDF', 'Word（DOCX）'])
  assert.ok(await radio('版别', '学生版').isChecked() && (await radio('文件格式', 'PDF').isChecked()))
  assert.ok(await radio('试题来源', '答案处').isDisabled(), '学生版没有答案，来源不能放在答案处')
  await dialog.getByText('试卷里不写题目来源。答案处仅教师版可选。').waitFor()
  assert.equal(await pathText(), saveDir, '首次的保存位置来自设置文件')
  await waitNames(['七年级数学第一单元测试_v1_学生版.pdf'])
  // 自检：第 8 题（书面表达）没设分值，题号可点
  await issue('没有设置分值').waitFor()
  assert.equal(await issue('没有设置分值').locator('.dl-no').allInnerTexts().then((t) => t.join()), '8')
  assert.equal(await issue('没有设置分值').getByText('未设分值').count(), 1)
  await issue('没有设置分值').locator('.dl-no').click()
  assert.deepEqual(await located(), [8], '点题号调用 onLocate(8)')
  assert.equal(await dialog.locator('.dl-check li.is-block').count(), 0, '学生版没有阻止项')
  assert.ok(await primary().isEnabled())
  await shot('paper-student')
  ok('试卷页默认学生版：老师的说法与四组选项、保存位置、文件名预览；自检提示未设分值的第 8 题，题号可点定位')

  // ---------- 二、教师版：答案位置、缺答案提示、说明文字 ----------
  await radio('版别', '教师版').check()
  await settle()
  assert.deepEqual((await dialog.locator('.dl-label').allInnerTexts()).filter(Boolean), ['版别', '答案位置', '试题来源', '作答区域', '文件格式', '保存位置', '文件名'])
  assert.deepEqual(await optionLabels('答案位置'), ['卷尾', '题后'])
  assert.ok(await radio('答案位置', '卷尾').isChecked(), '教师版默认答案在卷尾')
  await waitNames(['七年级数学第一单元测试_v1_教师版.pdf'])
  assert.ok(await radio('试题来源', '答案处').isEnabled())
  await issue('没有答案').waitFor()
  assert.equal(await issue('没有答案').locator('.dl-no').allInnerTexts().then((t) => t.join()), '4,8')
  await issue('没有答案').locator('.dl-no').first().click()
  assert.deepEqual(await located(), [8, 4])
  // 最小窗口 1000×640：下载前检查在滚动区顶部，不用滚动就能看到
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 640))
  await settle()
  const fit = await window.evaluate(() => {
    const body = document.querySelector('.ui-modal-body')!
    body.scrollTop = 0
    return { check: document.querySelector('.dl-check')!.getBoundingClientRect().bottom, body: body.getBoundingClientRect().bottom, scrolls: body.scrollHeight > body.clientHeight }
  })
  assert.ok(fit.scrolls && fit.check <= fit.body, `1000×640 下检查条完整出现在可视区内：检查条底边 ${fit.check}，正文可视底边 ${fit.body}`)
  await shot('paper-teacher-end-missing')
  await radio('答案位置', '题后').check()
  await settle()
  assert.ok(await radio('作答区域', '留作答区域').isDisabled(), '答案在题后时不留作答区域')
  await dialog.getByText('答案在题后时不留作答区域').waitFor()
  await radio('答案位置', '卷尾').check()
  await radio('作答区域', '留作答区域').check()
  await dialog.getByText('计算题留白 36mm，解答题 32mm，书面表达画横线。').waitFor()
  await radio('试题来源', '题文前').check()
  await dialog.getByText('题文前：写在每道题的题干前，如「1.（2025·福建泉州·期中）下列…」。').waitFor()
  await radio('试题来源', '答案处').check()
  await dialog.getByText('答案处：写在答案前，如「（2025·福建泉州·期中）【答案】C」').waitFor()
  await radio('版别', '学生版').check()
  await settle()
  assert.ok(await radio('试题来源', '不显示').isChecked(), '切回学生版：来源「答案处」显示为不显示')
  await dialog.getByText('试卷里不写题目来源。').waitFor()
  await radio('版别', '教师版').check()
  assert.ok(await radio('试题来源', '答案处').isChecked(), '再切回教师版：之前选的「答案处」还在')
  await radio('文件格式', 'Word（DOCX）').check()
  await waitNames(['七年级数学第一单元测试_v1_教师版.docx'])
  await radio('文件格式', 'PDF').check()
  ok('教师版：答案位置卷尾 / 题后，缺答案提示列出题号且可点；题后时作答区域「留」不可选；来源三种位置各有例子，作答区域注明 36mm / 32mm；切换版别不丢选择')

  // ---------- 三、学生版和教师版各一份：生成中锁定，完成态 ----------
  await radio('试题来源', '题文前').check()
  await dialog.getByRole('checkbox', { name: '学生版和教师版各下载一份' }).check()
  await settle()
  assert.ok(await radio('版别', '学生版').isDisabled() && (await radio('版别', '教师版').isDisabled()), '勾选各一份后版别选项不再单独选')
  await waitNames(['七年级数学第一单元测试_v1_学生版.pdf', '七年级数学第一单元测试_v1_教师版.pdf'])
  assert.deepEqual(await dialog.locator('.dl-name-tag').allInnerTexts(), ['学生版', '教师版'])
  assert.equal(await primary().innerText(), '下载 2 份')
  // 让打印慢 1.5 秒，保证能在「生成中」状态下操作和截图
  await app.evaluate(({ app: electronApp }) => {
    electronApp.on('web-contents-created', (_event, contents) => {
      const original = contents.printToPDF.bind(contents)
      contents.printToPDF = (async (options: never) => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return original(options)
      }) as never
    })
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await primary().click()
  await dialog.getByRole('status').filter({ hasText: '正在生成（第 1 / 2 份）' }).waitFor({ timeout: 5000 })
  assert.ok(await primary().isDisabled() && (await primary().innerText()) === '正在生成…')
  assert.ok(await radio('答案位置', '卷尾').isDisabled(), '生成中配置不可改')
  assert.ok(await radio('下载内容', '答题卡').isDisabled(), '生成中不能切换试卷 / 答题卡')
  assert.ok(await dialog.getByRole('button', { name: '更改…' }).isDisabled(), '生成中不能改保存位置')
  assert.ok(await dialog.getByRole('button', { name: '取消' }).isDisabled(), '生成中不能取消')
  await window.keyboard.press('Escape')
  assert.equal(await dialog.count(), 1, '生成中 Esc 不关闭弹窗')
  await dialog.getByText('已保存 2 份').waitFor({ timeout: 60000 })
  const done = await exported()
  assert.equal(done.length, 2)
  assert.deepEqual(done.map((r) => [r.kind, r.versionNo, r.createdVersion]), [['paper', 1, true], ['paper', 1, false]])
  assert.deepEqual(done.map((r) => r.filePath.slice(saveDir.length + 1)), ['七年级数学第一单元测试_v1_学生版.pdf', '七年级数学第一单元测试_v1_教师版.pdf'])
  for (const r of done) {
    assert.ok(existsSync(r.filePath) && readFileSync(r.filePath).subarray(0, 4).toString() === '%PDF')
    assert.equal(r.pageCount, pdfPagesOf(r.filePath), '页数与 pdfinfo 一致')
    assert.ok(await dialog.locator('.dl-result li').filter({ hasText: `${r.pageCount} 页` }).count() >= 1, '完成信息里显示页数')
  }
  assert.equal(await dialog.locator('.dl-result li').count(), 2)
  assert.equal(await dialog.locator('.dl-result-note').innerText(), '当前草稿已保存为 v1')
  assert.equal(await primary().innerText(), '重新生成 2 份', '完成后主按钮是「重新生成」，两份时写明份数')
  assert.equal(await dialog.locator('.dl-result .ui-tag').count(), 0, '第一次生成没有覆盖任何文件')
  assert.ok(await radio('答案位置', '题后').isEnabled() && (await dialog.getByRole('checkbox', { name: '学生版和教师版各下载一份' }).isEnabled()), '完成后选项保持可改')
  await shot('done', '.dl-result')
  await dialog.getByRole('button', { name: '打开所在文件夹' }).first().click()
  await window.waitForTimeout(200)
  assert.deepEqual(await app.evaluate(() => (globalThis as unknown as { __shown: string[] }).__shown), [done[0].filePath])
  // 同一版本同一配置再点：覆盖原文件，结果区写明，不再说「已保存」
  await primary().click()
  await dialog.getByText('已重新生成 2 份').waitFor({ timeout: 60000 })
  assert.deepEqual(await dialog.locator('.dl-result .ui-tag').allInnerTexts(), ['已覆盖同名文件', '已覆盖同名文件'])
  assert.deepEqual((await exported()).slice(-2).map((r) => r.overwritten), [true, true])
  assert.equal(readdirSync(saveDir).filter((n) => n.startsWith('七年级数学第一单元测试_v1')).length, 2, '文件没有变多')
  await shot('regenerated', '.dl-result')
  // 选项一改，结果区清掉，主按钮回到下载
  await radio('答案位置', '题后').check()
  await dialog.locator('.dl-result').waitFor({ state: 'detached' })
  assert.equal(await primary().innerText(), '下载 2 份')
  await radio('答案位置', '卷尾').check()
  ok('各一份：生成中锁定（选项、切换、保存位置、取消、Esc）；完成后列出两份的路径与页数、可打开所在文件夹，选项保持可改，主按钮「再下载一份」，onExported 每份各调一次')

  // ---------- 四、完成后改选项再下一份 ----------
  await dialog.getByRole('checkbox', { name: '学生版和教师版各下载一份' }).uncheck()
  await radio('版别', '学生版').check()
  await radio('文件格式', 'Word（DOCX）').check()
  await settle()
  assert.equal(await primary().innerText(), '下载试卷', '页签是试卷：按钮写「下载试卷」，两份时才写份数')
  await primary().click()
  await dialog.getByText('已保存 1 份').waitFor({ timeout: 60000 })
  assert.equal(await dialog.locator('.dl-result-path').textContent(), join(saveDir, '七年级数学第一单元测试_v1_学生版.docx'))
  assert.equal(await dialog.locator('.dl-result-note').innerText(), '对应版本 v1')
  assert.equal(await dialog.locator('.dl-result-pages').count(), 0, 'Word 没有页数，不显示')
  assert.equal(await primary().innerText(), '重新生成')
  ok('各一份之后取消勾选、改成 Word 再下一份：沿用 v1，Word 不显示页数；同一配置再点「重新生成」覆盖原文件并写明，选项一改结果区清掉')

  // ---------- 五、答题卡页 ----------
  await radio('文件格式', 'PDF').check()
  await radio('下载内容', '答题卡').check()
  await settle()
  assert.equal(await group('文件格式').count(), 0, '答题卡页没有格式选项（固定 PDF）')
  assert.equal(await group('版别').count(), 0)
  assert.equal(await window.getByRole('dialog', { name: '下载答题卡' }).count(), 1, '标题跟着页签变成「下载答题卡」')
  assert.equal(await primary().innerText(), '下载答题卡')
  assert.deepEqual((await dialog.locator('.dl-label').allInnerTexts()).filter(Boolean), ['保存位置', '文件名'])
  await waitNames(['七年级数学第一单元测试_v1_答题卡.pdf'])
  await issue('没有设置分值').waitFor()
  assert.match(await issue('没有设置分值').innerText(), /答题卡上这些题的框头不显示分值/)
  assert.equal(await issue('没有答案').count(), 0, '答题卡不涉及答案')
  await dialog.getByText('只生成 PDF').waitFor()
  await shot('sheet')
  const exportedBefore = (await exported()).length
  await dialog.getByRole('checkbox', { name: /同时下载试卷（学生版/ }).check()
  await waitNames(['七年级数学第一单元测试_v1_答题卡.pdf', '七年级数学第一单元测试_v1_学生版.pdf'])
  assert.equal(await primary().innerText(), '下载 2 份')
  await primary().click()
  await dialog.getByText('已保存 2 份').waitFor({ timeout: 60000 })
  const sheetDone = (await exported()).slice(exportedBefore)
  assert.deepEqual(sheetDone.map((r) => r.kind), ['answer-sheet', 'paper'])
  assert.equal(sheetDone[0].pageCount, pdfPagesOf(sheetDone[0].filePath))
  assert.ok(sheetDone[0].filePath.endsWith('七年级数学第一单元测试_v1_答题卡.pdf'))
  assert.deepEqual(await dialog.locator('.dl-result li strong').allInnerTexts(), ['答题卡', '学生版'])
  assert.deepEqual(sheetDone.map((r) => r.overwritten), [false, true], '学生版 PDF 与前面各一份时生成的是同一个文件：覆盖了')
  assert.equal(await dialog.locator('.dl-result .ui-tag').allInnerTexts().then((t) => t.join()), '已覆盖同名文件')
  assert.equal(await primary().innerText(), '重新生成 2 份')
  ok('答题卡页：只有保存位置与文件名，固定 PDF；自检说明分值缺失；勾选同时下载试卷后一次生成答题卡与学生版')

  // 从「下载答题卡」入口打开：直接落在答题卡页
  await dialog.locator('.ui-modal-foot').getByRole('button', { name: '关闭' }).click()
  await dialog.waitFor({ state: 'detached' })
  await window.locator('#open-sheet').click()
  await dialog.waitFor()
  assert.ok(await radio('下载内容', '答题卡').isChecked(), 'initialKind 为答题卡时打开即在答题卡页')
  await dialog.getByRole('button', { name: '取消' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await window.evaluate(() => document.activeElement?.id), 'open-sheet', '关闭后焦点回到打开它的按钮')
  ok('initialKind：从答题卡入口打开直接落在答题卡页；关闭后焦点回到触发按钮')

  // ---------- 六、重名预览（S12） ----------
  await open(paperD)
  await window.waitForFunction(() => !!document.querySelector('.dl-name-text'))
  assert.equal(await pathText(), saveDir)
  await radio('试题来源', '不显示').check() // 回到默认配置：默认配置的文件名没有配置词
  await radio('作答区域', '不留').check()
  writeFileSync(join(saveDir, '重名预览卷_v1_学生版.pdf'), '别处留下的同名文件')
  await radio('版别', '教师版').check() // 触发预览刷新
  await radio('版别', '学生版').check()
  await waitNames(['重名预览卷_v1_学生版 (2).pdf'])
  await dialog.getByText('保存位置里已有同名文件，自动改名保存').waitFor()
  await primary().click()
  await dialog.getByText('已保存 1 份').waitFor({ timeout: 60000 })
  assert.equal(await dialog.locator('.dl-result-path').textContent(), join(saveDir, '重名预览卷_v1_学生版 (2).pdf'), '落盘的文件名与预览一致')
  assert.equal(readFileSync(join(saveDir, '重名预览卷_v1_学生版.pdf'), 'utf8'), '别处留下的同名文件', '已有文件不被覆盖')
  // 配置不同的再下一份：认不出占着基础名的是什么，就写自己与默认不同的项
  await radio('作答区域', '留作答区域').check()
  await waitNames(['重名预览卷_v1_学生版_留作答区域.pdf'])
  await dialog.getByText('保存位置里已有同名文件，自动改名保存').waitFor()
  await radio('作答区域', '不留').check()
  ok('文件名预览：保存位置里已有同名文件时预先显示「(2)」并标出原因，实际落盘与预览一致，已有文件不被覆盖')

  // ---------- 七、整卷没有答案、空试卷 ----------
  writeFileSync(settingsFile, JSON.stringify({ options: { ...STUDENT, answerPosition: 'end' }, directory: saveDir })) // 上次用的是教师版
  await open(paperB)
  await window.waitForFunction(() => document.querySelector('.dl-check') !== null)
  assert.ok(await radio('版别', '学生版').isChecked(), '上次是教师版但整卷没有答案：自动切回学生版')
  assert.ok(await radio('版别', '教师版').isDisabled(), '教师版选项禁用')
  await dialog.getByText('整卷 8 题都没有答案，教师版不能选').waitFor()
  assert.ok(await dialog.getByRole('checkbox', { name: '学生版和教师版各下载一份' }).isDisabled())
  assert.equal(await dialog.locator('.dl-check li.is-block').count(), 0)
  assert.ok(await primary().isEnabled(), '学生版仍可下载')
  await shot('paper-no-answers')
  ok('整卷没有答案：教师版与「各一份」禁用并写明原因，上次选的教师版自动回到学生版，学生版仍可下载')

  await open(paperC)
  await dialog.locator('.dl-check li.is-block').waitFor()
  assert.match(await dialog.locator('.dl-check li.is-block').innerText(), /空试卷.*试卷里还没有题目，无法下载/s)
  assert.ok(await primary().isDisabled(), '空试卷不能下载')
  assert.match(await dialog.locator('.dl-foot-note').innerText(), /试卷里还没有题目/, '页脚写明按钮不可用的原因')
  await radio('下载内容', '答题卡').check()
  await dialog.locator('.dl-check li.is-block').waitFor()
  assert.ok(await primary().isDisabled(), '答题卡同样不能下载')
  await shot('empty-paper')
  await dialog.getByRole('button', { name: '取消' }).click()
  ok('空试卷：下载按钮置灰，检查里写明「试卷里还没有题目，无法下载」，试卷与答题卡都一样')

  // ---------- 八、出错与键盘 ----------
  await open(paperA)
  await window.waitForFunction(() => !!document.querySelector('.dl-name-text'))
  const gone = mkdtempSync(join(tmpdir(), 'ewb-dialog-gone-'))
  await app.evaluate((_e, dir) => ((globalThis as unknown as { __pick: string }).__pick = dir), gone)
  await dialog.getByRole('button', { name: '更改…' }).click()
  await window.waitForFunction((p) => document.querySelector('.dl-path-text')?.textContent === p, gone)
  rmSync(gone, { recursive: true })
  await primary().click()
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /^保存位置不存在：/)
  assert.ok(await primary().isEnabled(), '出错后可以重试')
  assert.equal(await primary().innerText(), '下载试卷')
  await shot('error', '.dl-error')
  await app.evaluate((_e, dir) => ((globalThis as unknown as { __pick: string }).__pick = dir), otherDir)
  await dialog.getByRole('button', { name: '更改…' }).click()
  await window.waitForFunction((p) => document.querySelector('.dl-path-text')?.textContent === p, otherDir)
  await primary().click()
  await dialog.getByText('已保存 1 份').waitFor({ timeout: 60000 })
  assert.equal(await dialog.getByRole('alert').count(), 0, '成功后错误提示消失')
  assert.equal(readdirSync(otherDir).filter((n) => n.endsWith('.tmp')).length, 0)
  await window.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  ok('保存位置不存在时显示原因（已去掉 IPC 前缀），换位置后可再下载并清除错误；Esc 关闭弹窗')

  console.log(`下载弹窗端到端测试通过：${steps} 组检查；截图在 ${evidence}`)
} finally {
  await app.close()
}
