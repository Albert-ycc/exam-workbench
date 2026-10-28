// 组卷编辑器与版本管理端到端测试：拖拽组卷、题号重排、副本编辑与隔离、重启后草稿、存版本 / 恢复 / 预览 / 下载记录
// 用法：node test/e2e/editor.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { Locator, Page } from 'playwright'
import { buildTo, launchApp, type LaunchedApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { evidenceDir, makeTempDir } from '../../scripts/temp-dir.ts'
import { openDatabase } from '../../src/main/db.ts'
import { recordExport } from '../../src/main/papers/repo.ts'

const evidence = evidenceDir(process.argv[2], 'ewb-editor-')
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(evidence, `${name}.png`) })

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// ---------- 测试素材 ----------
function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
// 纯色 PNG，用来验证「换成本地图片」
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 操作封装 ----------
// dnd-kit 的 PointerSensor 需要分步移动的真实鼠标轨迹
async function dragTo(page: Page, source: Locator, target: { x: number; y: number }, whileHovering?: () => Promise<void>): Promise<void> {
  await source.scrollIntoViewIfNeeded()
  const box = (await source.boundingBox())!
  const sx = box.x + Math.min(box.width / 2, 80)
  const sy = box.y + Math.min(box.height / 2, 24)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 10, sy + 10, { steps: 4 })
  await page.mouse.move(target.x, target.y, { steps: 24 })
  await whileHovering?.()
  await page.mouse.up()
}

const libCard = (page: Page, id: number): Locator => page.locator(`[data-testid="lib-card"][data-question-id="${id}"]`)
const sectionAt = (page: Page, index: number): Locator => page.getByTestId('section').nth(index)
const itemWith = (page: Page, text: string): Locator => page.getByTestId('paper-item').filter({ hasText: text })
// 新建大题是个带预设的下拉：选「自定义名称…」得到名为「新大题」的空大题
async function addCustomSection(page: Page): Promise<void> {
  await page.getByTestId('add-section').click()
  await page.getByRole('menuitem', { name: '自定义名称…' }).click()
}

const itemNos = (page: Page): Promise<string[]> => page.getByTestId('item-no').allInnerTexts()

// 目标放到试卷栏的垂直中部再取坐标：贴近上下边缘时 dnd-kit 会自动滚动，落点就不是起手时算的位置了
const centered = (locator: Locator): Promise<void> => locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await centered(locator)
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
async function bottomOf(locator: Locator, inset = 8): Promise<{ x: number; y: number }> {
  await centered(locator)
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height - inset }
}
async function topOf(locator: Locator, inset = 6): Promise<{ x: number; y: number }> {
  await centered(locator)
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + inset }
}

async function saved(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved', null, { timeout: 8000 })
}

// 导航里的「试卷库」在有打开的试卷时回到编辑器，所以要先用编辑器里的返回按钮回到列表
async function openPaperList(page: Page): Promise<void> {
  if (await page.locator('.bar-back').count()) await page.locator('.bar-back').click()
  else await page.locator('.app-nav .nav-item', { hasText: '试卷库' }).click()
  await page.getByRole('heading', { name: '试卷库' }).waitFor()
}

async function createPaper(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '新建试卷' }).first().click()
  await page.getByRole('dialog').getByRole('textbox').fill(title)
  await page.getByRole('button', { name: '创建并打开' }).click()
  await page.getByLabel('试卷标题').waitFor()
  await page.locator('[data-testid="lib-card"]').first().waitFor()
}

async function openPaper(page: Page, title: string): Promise<void> {
  await openPaperList(page)
  await page.getByTestId('paper-row').filter({ hasText: title }).getByRole('button', { name: '打开', exact: true }).click()
  await page.getByLabel('试卷标题').waitFor()
  await page.getByTestId('save-state').waitFor()
}

// 行尾：macOS 上 End 只滚动不移光标
const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'

type WB = Window['workbench']
const call = <T>(page: Page, fn: (wb: WB) => Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.workbench)`) as Promise<T>

// ---------- 开始 ----------
buildTo('out-editor4')
const dataDir = makeTempDir('ewb-editor-data-')
const userDataDir = makeTempDir('ewb-editor-user-')
const { questionIds } = seedDataDir(dataDir)
// 真实组卷网的来源卷标题有 40 多字，下拉框里最长的选项不能撑宽左栏
const LONG_TITLES = [
  '2026-2027学年山东省德州市第一实验中学七年级上学期第一次阶段性质量检测数学试题（含详细答案与解析）',
  '2026-2027学年福建省泉州市鲤城区北师大附属实验中学七年级上学期期中联考英语试题（含听力材料与答案）'
]
{
  const db = openDatabase(dataDir)
  const ids = (db.prepare('SELECT id FROM source_papers ORDER BY id').all() as { id: number }[]).map((r) => r.id)
  ids.forEach((id, i) => db.prepare('UPDATE source_papers SET title = ? WHERE id = ?').run(LONG_TITLES[i], id))
  db.close()
}
const [qChoice, qBlank, qCalc, qSolve, qCloze] = questionIds
// 样例数据里的 PNG 字节本身是损坏的（CRC 与压缩数据都不对），界面上只会显示破图；
// 这里把数据目录里那个文件换成同尺寸的有效 PNG，让截图和图片相关的断言反映真实使用
for (const name of readdirSync(join(dataDir, 'assets')).filter((n) => n.endsWith('.png'))) writeFileSync(join(dataDir, 'assets', name), solidPng(96, 48, [196, 214, 242]))
const exportDir = makeTempDir('ewb-editor-out-')
const imagePath = join(makeTempDir('ewb-editor-img-'), '蓝色示意图.png')
writeFileSync(imagePath, solidPng(120, 72, [43, 109, 229]))

let launched: LaunchedApp = await launchApp({ outDir: 'out-editor4', dataDir, userDataDir })
let page = launched.window
await page.setViewportSize({ width: 1280, height: 800 })
const consoleErrors: string[] = []
const watch = (p: Page): void => {
  p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`console: ${m.text()}`))
}
watch(page)

try {
  const original = async (id: number) => (await call(page, (wb) => wb.library.listQuestions({}))).items.find((q) => q.id === id)!
  const blankBefore = await original(qBlank)

  // ================= 试卷库 =================
  await step('试卷库：空状态可见，新建试卷后直接进入编辑器', async () => {
    await openPaperList(page)
    await page.getByText('还没有试卷').waitFor()
    await shot(page, '01-试卷库-空')
    await createPaper(page, '七年级数学第一单元测试')
    assert.equal(await page.getByLabel('试卷标题').inputValue(), '七年级数学第一单元测试')
    assert.equal(await page.getByTestId('lib-card').count(), 6)
    await page.getByTestId('new-section-zone').waitFor()
  })

  await step('来源卷标题很长（40 字以上，两份）：左栏仍是 380px，试卷栏不被挤窄', async () => {
    const fixDir = join(evidence, 'fix')
    mkdirSync(fixDir, { recursive: true })
    const width = (selector: string): Promise<number> => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().width)
    const sources = await page.getByLabel('来源卷').locator('option').allInnerTexts()
    assert.ok(sources.filter((t) => t.length > 40).length >= 2, `来源卷选项应有两份 40 字以上的长标题：${sources.join(' | ')}`)
    const lib = await width('.ed-lib')
    const paper = await width('.ed-desk')
    console.log(`    窗口 ${(await page.evaluate(() => window.innerWidth))}×${await page.evaluate(() => window.innerHeight)}，左栏 ${lib.toFixed(1)}px，试卷栏 ${paper.toFixed(1)}px`)
    assert.ok(Math.abs(lib - 380) <= 2, `左栏应为 380±2px，实际 ${lib}`)
    assert.ok(paper >= 600, `试卷栏应不小于 600px，实际 ${paper}`)
    for (const label of ['题型', '来源卷']) assert.ok((await page.getByLabel(label).evaluate((el) => el.getBoundingClientRect().right)) <= 380 + 1, `${label}下拉框不应超出左栏`)
    assert.ok((await width('.ed-lib-head .ui-input')) <= 380, '搜索框不应超出左栏')
    await page.screenshot({ path: join(fixDir, '长标题来源卷-空试卷.png') })
  })

  // ================= 拖拽组卷 =================
  await step('试卷为空时拖入单选题：自动新建「单选题」大题', async () => {
    await dragTo(page, libCard(page, qChoice), await centerOf(page.getByTestId('new-section-zone')))
    await page.getByTestId('paper-item').first().waitFor()
    assert.equal(await sectionAt(page, 0).getByTestId('section-name').inputValue(), '单选题')
    assert.deepEqual(await itemNos(page), ['1'])
    assert.equal(await page.getByTestId('section-prefix').first().innerText(), '一、')
    await libCard(page, qChoice).getByText('已加入').waitFor()
  })

  await step('拖到已有大题末尾：填空题成为第 2 题', async () => {
    await dragTo(page, libCard(page, qBlank), await bottomOf(sectionAt(page, 0)))
    await page.getByTestId('paper-item').nth(1).waitFor()
    assert.deepEqual(await itemNos(page), ['1', '2'])
    assert.equal(await sectionAt(page, 0).getByTestId('paper-item').count(), 2)
  })

  await step('新建大题并改名，完形填空、解答题拖入第二个大题', async () => {
    await addCustomSection(page)
    assert.equal(await page.getByTestId('section').count(), 2)
    const nameInput = sectionAt(page, 1).getByTestId('section-name')
    await nameInput.fill('阅读与解答')
    await sectionAt(page, 1).getByText(/把题目拖到这里/).waitFor()
    await dragTo(page, libCard(page, qCloze), await centerOf(sectionAt(page, 1)))
    await sectionAt(page, 1).getByTestId('paper-item').first().waitFor()
    await dragTo(page, libCard(page, qSolve), await bottomOf(sectionAt(page, 1)))
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 4)
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
    assert.deepEqual(await page.getByTestId('section-prefix').allInnerTexts(), ['一、', '二、'])
  })

  await step('完形填空占 3 个题号，块内小题号按全卷题号填入', async () => {
    const cloze = itemWith(page, 'Tom is a new student')
    const text = await cloze.innerText()
    for (const n of [3, 4, 5]) assert.match(text, new RegExp(`${n}\\s*_{2,}`), `题干里应出现小题号 ${n}`)
    assert.match(text, /3\.\s*A\./)
    assert.match(text, /5\.\s*A\./)
    const lib = await page.locator('.ed-lib').evaluate((el) => el.getBoundingClientRect().width)
    const paper = await page.locator('.ed-desk').evaluate((el) => el.getBoundingClientRect().width)
    assert.ok(Math.abs(lib - 380) <= 2 && paper >= 600, `组卷后版面宽度应保持：左栏 ${lib}，试卷栏 ${paper}`)
    await page.locator('.ed-desk').evaluate((el) => (el.scrollTop = 0))
    await page.locator('.ed-lib-list').evaluate((el) => (el.scrollTop = 0))
    await page.getByTestId('save-state').filter({ hasText: '草稿已保存' }).waitFor()
    await shot(page, '02-编辑器-四道题两个大题')
    await page.screenshot({ path: join(evidence, 'fix', '长标题来源卷-组卷后.png') })
  })

  await step('释放在试卷之外（试题库区域）不会加入题目', async () => {
    await dragTo(page, libCard(page, qCalc), await centerOf(page.locator('.ed-lib-list')))
    await page.waitForTimeout(300)
    assert.equal(await page.getByTestId('paper-item').count(), 4)
  })

  await step('试题库筛选：按题型、来源卷、关键词缩小范围', async () => {
    const total = page.getByTestId('lib-total')
    await page.getByLabel('题型').selectOption({ label: '单选题' })
    await page.getByTestId('lib-card').first().waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="lib-card"]').length === 1)
    assert.equal((await total.innerText()).trim(), '共 1 道题')
    await page.getByLabel('题型').selectOption({ label: '全部题型' })
    const sourceLabel = await page.getByLabel('来源卷').locator('option').nth(1).innerText()
    const expected = Number(/（(\d+)）$/.exec(sourceLabel)![1])
    await page.getByLabel('来源卷').selectOption({ index: 1 })
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="lib-card"]').length === n, expected)
    assert.equal((await total.innerText()).trim(), `共 ${expected} 道题`)
    await page.getByLabel('来源卷').selectOption({ label: '全部来源卷' })
    await page.getByPlaceholder('题干关键词').fill('盈亏')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="lib-card"]').length === 1)
    assert.match(await page.getByTestId('lib-card').first().innerText(), /某超市一周/)
    await page.getByPlaceholder('题干关键词').fill('')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="lib-card"]').length === 6)
  })

  await step('拖动调序：解答题移到完形填空之前，题号随之变化', async () => {
    const grip = itemWith(page, '某超市一周的盈亏情况').getByRole('button', { name: /拖动第/ })
    await dragTo(page, grip, await topOf(itemWith(page, 'Tom is a new student'), 6), async () => {
      assert.equal(await page.locator('.ed-drop').count(), 1, '拖动中应显示一条插入位置线')
      await shot(page, '02b-拖动中的插入位置线')
    })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="item-no"]')[2]?.textContent === '3')
    assert.deepEqual(await itemNos(page), ['1', '2', '3', '4～6'])
    assert.match(await itemWith(page, 'Tom is a new student').innerText(), /4\s*_{2,}/)
    assert.match(await itemWith(page, 'Tom is a new student').innerText(), /6\.\s*A\./)
  })

  await step('跨大题拖动：填空题移到第二个大题末尾，第一个大题只剩单选题', async () => {
    const grip = itemWith(page, '数轴上点 A').getByRole('button', { name: /拖动第/ })
    await dragTo(page, grip, await bottomOf(sectionAt(page, 1)))
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="section"]')[0]?.querySelectorAll('[data-testid="paper-item"]').length === 1)
    assert.equal(await sectionAt(page, 1).getByTestId('paper-item').count(), 3)
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
    assert.match(await sectionAt(page, 1).getByTestId('paper-item').last().innerText(), /数轴上点 A/)
    await saved(page)
  })

  await step('大题上移 / 下移改变大题序号', async () => {
    await sectionAt(page, 1).getByRole('button', { name: '大题上移' }).click()
    assert.equal(await sectionAt(page, 0).getByTestId('section-name').inputValue(), '阅读与解答')
    assert.deepEqual(await itemNos(page), ['1', '2～4', '5', '6'])
    await sectionAt(page, 0).getByRole('button', { name: '大题下移' }).click()
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
    await saved(page)
  })

  await step('删除大题：空大题与有题的大题都直接删除，有题的大题可以撤销（M3）', async () => {
    await addCustomSection(page)
    assert.equal(await page.getByTestId('section').count(), 3)
    await sectionAt(page, 2).getByRole('button', { name: '删除大题' }).click()
    assert.equal(await page.getByTestId('section').count(), 2)
    const before = await itemNos(page)
    await sectionAt(page, 0).getByRole('button', { name: '删除大题' }).click()
    assert.equal(await page.getByTestId('section').count(), 1)
    const toast = page.getByTestId('toast').filter({ hasText: /已删除「.*」及 1 道题/ })
    await toast.waitFor()
    await toast.getByRole('button', { name: '撤销' }).click()
    assert.equal(await page.getByTestId('section').count(), 2)
    assert.deepEqual(await itemNos(page), before, '撤销后大题与题目原样回来')
    assert.equal(await sectionAt(page, 0).getByTestId('section-name').inputValue(), '单选题')
    await saved(page)
  })

  // ================= 编辑副本 =================
  await step('编辑填空题副本：改题干文字，保存后图片与题号占位保持', async () => {
    const card = itemWith(page, '数轴上点 A')
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    const stem = card.getByTestId('edit-stem')
    await stem.locator('p').first().click({ position: { x: 24, y: 8 } })
    await page.keyboard.press(LINE_END)
    await page.keyboard.insertText('（已改）')
    await saved(page)
    const papers = await call(page, (wb) => wb.papers.list())
    const detail = await call(page, async (wb) => wb.papers.get((await wb.papers.list())[0].id))
    const item = detail.draft.sections.flatMap((s) => s.items).find((i) => i.stemHtml.includes('（已改）'))!
    assert.ok(item, '草稿里应有修改后的题干')
    assert.match(item.stemHtml, /<img src="ewb-asset:\/\/[0-9a-f]{64}\.png"/)
    assert.equal(papers.length, 1)
    await shot(page, '03-编辑器-编辑题目副本')
    await card.getByRole('button', { name: '完成' }).click()
  })

  await step('改副本不影响试题库原题', async () => {
    const after = await original(qBlank)
    assert.equal(after.stemHtml, blankBefore.stemHtml)
    assert.equal(after.answerHtml, blankBefore.answerHtml)
    assert.ok(!after.stemHtml.includes('（已改）'))
  })

  await step('编辑单选题副本：公式图片尺寸与选项表属性在保存后依然保留', async () => {
    const card = itemWith(page, '下列说法正确的是')
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    await card.getByTestId('edit-stem').locator('p').first().click({ position: { x: 24, y: 8 } })
    await page.keyboard.press(LINE_END)
    await page.keyboard.insertText('（修订）')
    await saved(page)
    const detail = await call(page, async (wb) => wb.papers.get((await wb.papers.list())[0].id))
    const stem = detail.draft.sections[0].items[0].stemHtml
    assert.match(stem, /（修订）/)
    assert.match(stem, /width="64"/)
    assert.match(stem, /height="20"/)
    assert.match(stem, /data-role="options"/)
    assert.doesNotMatch(stem, /contenteditable|class=|style=/)
  })

  await step('删除图片：点选公式图后删除，草稿里不再有这张图', async () => {
    const card = itemWith(page, '下列说法正确的是')
    await card.getByTestId('edit-stem').locator('img').first().click()
    await card.getByRole('button', { name: '删除图片' }).click()
    await saved(page)
    assert.equal(await card.getByTestId('edit-stem').locator('img').count(), 0)
    const detail = await call(page, async (wb) => wb.papers.get((await wb.papers.list())[0].id))
    assert.doesNotMatch(detail.draft.sections[0].items[0].stemHtml, /<img/)
    await card.getByRole('button', { name: '完成' }).click()
  })

  await step('换成本地图片：选图后存进数据目录，内容改用新图并带尺寸', async () => {
    await launched.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, imagePath)
    const card = itemWith(page, '数轴上点 A')
    const oldSrc = await card.locator('img').first().getAttribute('src')
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    await card.getByTestId('edit-stem').locator('img').first().click()
    await card.getByRole('button', { name: '换成本地图片…' }).click()
    await page.waitForFunction((old) => document.querySelector('[data-testid="edit-stem"] img')?.getAttribute('src') !== old, oldSrc)
    await saved(page)
    const detail = await call(page, async (wb) => wb.papers.get((await wb.papers.list())[0].id))
    const blank = detail.draft.sections.flatMap((s) => s.items).find((i) => i.stemHtml.includes('（已改）'))!
    const match = blank.stemHtml.match(/<img src="(ewb-asset:\/\/[0-9a-f]{64}\.png)" width="(\d+)" height="(\d+)"/)
    assert.ok(match, `新图应带宽高：${blank.stemHtml}`)
    assert.notEqual(match[1], oldSrc)
    assert.equal(match[2], '120')
    assert.equal(match[3], '72')
    // 原图仍在试题库原题里
    assert.equal((await original(qBlank)).stemHtml, blankBefore.stemHtml)
    await card.getByRole('button', { name: '完成' }).click()
  })

  await step('完形填空编辑：全选删除也删不掉小题号占位', async () => {
    const card = itemWith(page, 'Tom is a new student')
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    const stem = card.getByTestId('edit-stem')
    await stem.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(700)
    const detail = await call(page, async (wb) => wb.papers.get((await wb.papers.list())[0].id))
    const cloze = detail.draft.sections.flatMap((s) => s.items).find((i) => i.numberCount === 3)!
    assert.equal((cloze.stemHtml.match(/data-ewb-qno="\d"/g) ?? []).length >= 3, true, `占位符应仍在：${cloze.stemHtml}`)
    // 正常改字依然可以
    await stem.locator('p').first().click({ position: { x: 24, y: 8 } })
    await page.keyboard.press(LINE_END)
    await page.keyboard.insertText(' Hello.')
    await saved(page)
    const after = await call(page, async (wb) => wb.papers.get((await wb.papers.list())[0].id))
    const cloze2 = after.draft.sections.flatMap((s) => s.items).find((i) => i.numberCount === 3)!
    assert.match(cloze2.stemHtml, /Hello\./)
    assert.deepEqual(cloze2.stemHtml.match(/data-ewb-qno="(\d)"/g), ['data-ewb-qno="0"', 'data-ewb-qno="1"', 'data-ewb-qno="2"', 'data-ewb-qno="0"', 'data-ewb-qno="1"', 'data-ewb-qno="2"'].slice(0, (cloze2.stemHtml.match(/data-ewb-qno/g) ?? []).length))
    await card.getByRole('button', { name: '完成' }).click()
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
  })

  await step('删除题目后可撤销，题号随之变化再恢复', async () => {
    await itemWith(page, '某超市一周的盈亏情况').getByRole('button', { name: /删除第/ }).click()
    assert.deepEqual(await itemNos(page), ['1', '2～4', '5'])
    await page.getByTestId('toast').filter({ hasText: /已删除第/ }).getByRole('button', { name: '撤销' }).click()
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
  })

  await step('改试卷标题后自动保存', async () => {
    await page.getByLabel('试卷标题').fill('七年级数学第一单元测试（A）')
    await saved(page)
    const papers = await call(page, (wb) => wb.papers.list())
    assert.equal(papers[0].title, '七年级数学第一单元测试（A）')
    await page.getByLabel('试卷标题').fill('')
    await page.getByLabel('试卷标题').blur()
    assert.equal(await page.getByLabel('试卷标题').inputValue(), '七年级数学第一单元测试（A）')
  })

  // ================= 另一份试卷不受影响 =================
  await step('另一份试卷用同一道原题：内容仍是原样，不受上一份试卷的修改影响', async () => {
    await page.locator('.bar-back').click()
    await page.getByRole('heading', { name: '试卷库' }).waitFor()
    await shot(page, '04-试卷库')
    await createPaper(page, '对照卷')
    assert.equal(await page.locator('.ed-lib-added').count(), 0, '新试卷里没有任何题已加入')
    await dragTo(page, libCard(page, qBlank), await centerOf(page.getByTestId('new-section-zone')))
    await page.getByTestId('paper-item').first().waitFor()
    const text = await page.getByTestId('paper-item').first().innerText()
    assert.match(text, /数轴上点 A/)
    assert.doesNotMatch(text, /已改/)
    await saved(page)
    const papers = await call(page, (wb) => wb.papers.list())
    const other = papers.find((p) => p.title === '对照卷')!
    const detail = await call(page, (wb) => wb.papers.list().then((l) => wb.papers.get(l.find((p) => p.title === '对照卷')!.id)))
    assert.equal(detail.draft.sections[0].items[0].stemHtml, blankBefore.stemHtml)
    assert.equal(other.structure.questionCount, 1)
    // 题库里原题的卡片也没变
    assert.doesNotMatch(await libCard(page, qBlank).innerText(), /已改/)
    await sectionAt(page, 0).getByRole('button', { name: '删除大题' }).click()
    assert.equal(await page.getByTestId('section').count(), 0)
    await saved(page)
    const emptied = await call(page, async (wb) => wb.papers.get((await wb.papers.list()).find((p) => p.title === '对照卷')!.id))
    assert.deepEqual(emptied.draft.sections, [])
    assert.equal((await original(qBlank)).stemHtml, blankBefore.stemHtml, '删除大题不影响试题库原题')
  })

  // ================= 重启后草稿还在 =================
  await step('重启应用（同一用户目录与数据目录）：试卷、标题、顺序、修改都在', async () => {
    await saved(page)
    await launched.app.close()
    launched = await launchApp({ outDir: 'out-editor4', dataDir, userDataDir })
    page = launched.window
    watch(page)
    await openPaperList(page)
    await page.getByTestId('paper-row').first().waitFor()
    assert.equal(await page.getByTestId('paper-row').count(), 2)
    await openPaper(page, '七年级数学第一单元测试（A）')
    await page.getByTestId('paper-item').first().waitFor()
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
    assert.equal(await sectionAt(page, 1).getByTestId('section-name').inputValue(), '阅读与解答')
    assert.match(await itemWith(page, '数轴上点 A').innerText(), /已改/)
    assert.match(await itemWith(page, 'Tom is a new student').innerText(), /3\s*_{2,}/)
    await shot(page, '05-编辑器-重启后')
  })

  await step('改动后立刻关闭窗口（不等自动保存）：关闭前的同步保存把改动写入', async () => {
    await sectionAt(page, 0).getByTestId('section-name').fill('单项选择题')
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await launched.app.waitForEvent('close')
    launched = await launchApp({ outDir: 'out-editor4', dataDir, userDataDir })
    page = launched.window
    watch(page)
    await openPaper(page, '七年级数学第一单元测试（A）')
    await page.getByTestId('paper-item').first().waitFor()
    assert.equal(await sectionAt(page, 0).getByTestId('section-name').inputValue(), '单项选择题')
  })

  // ================= 版本 =================
  let v1Snapshot: unknown
  await step('存为 v1（填说明），顶部提示变为「与 v1 一致」', async () => {
    await page.getByRole('button', { name: '存为版本' }).click()
    await shot(page, '06-存为版本弹窗')
    await page.getByRole('dialog').getByRole('textbox').fill('初稿')
    await page.getByRole('button', { name: '存为 v1' }).click()
    await page.getByTestId('clean-tag').waitFor()
    assert.match(await page.getByTestId('clean-tag').innerText(), /v1/)
    const versions = await call(page, async (wb) => wb.papers.listVersions((await wb.papers.list()).find((p) => p.title.includes('（A）'))!.id))
    assert.deepEqual(versions.map((v) => [v.versionNo, v.note, v.origin]), [[1, '初稿', 'manual']])
    v1Snapshot = (await call(page, (wb) => wb.papers.getVersion(1))).snapshot
  })

  await step('再改：删除填空题，出现「有未存为版本的改动」', async () => {
    await itemWith(page, '数轴上点 A').getByRole('button', { name: /删除第/ }).click()
    await saved(page)
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5'])
    assert.equal((await page.getByTestId('dirty-tag').innerText()).trim(), '有改动未存为版本')
  })

  await step('版本历史抽屉：列出 v1 的版本号、时间、说明、产生方式', async () => {
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    const row = page.getByTestId('version-item')
    await row.first().waitFor()
    assert.equal(await row.count(), 1)
    const text = await row.first().innerText()
    assert.match(text, /v1/)
    assert.match(text, /初稿/)
    assert.match(text, /手动保存/)
    assert.match(text, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  })

  await step('查看 v1：只读预览整卷（含 4 道题的题号），不改动当前草稿', async () => {
    await page.getByTestId('version-item').first().getByRole('button', { name: '查看' }).click()
    await page.getByTestId('preview-sheet').waitFor()
    const text = await page.getByTestId('preview-sheet').innerText()
    assert.match(text, /一、单项选择题/)
    assert.match(text, /二、阅读与解答/)
    assert.match(text, /数轴上点 A/)
    assert.equal(await page.getByTestId('preview-sheet').getByTestId('preview-item-no').count(), 4)
    assert.deepEqual(await page.getByTestId('preview-sheet').getByTestId('preview-item-no').allInnerTexts(), ['1', '2', '3～5', '6'])
    await shot(page, '08-版本只读预览')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click()
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5'])
  })

  await step('恢复 v1：先自动存「恢复 v1 前自动保存」的 v2，草稿回到 v1 的内容', async () => {
    await page.getByTestId('version-item').first().getByRole('button', { name: '恢复' }).click()
    const dialog = page.getByRole('dialog')
    assert.match(await dialog.innerText(), /覆盖当前草稿/)
    assert.match(await dialog.innerText(), /自动存为 v2/)
    await shot(page, '07-恢复确认')
    await dialog.getByRole('button', { name: '恢复到 v1' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="version-item"]').length === 2)
    assert.deepEqual(await itemNos(page), ['1', '2', '3～5', '6'])
    const versions = await call(page, async (wb) => wb.papers.listVersions((await wb.papers.list()).find((p) => p.title.includes('（A）'))!.id))
    assert.deepEqual(versions.map((v) => [v.versionNo, v.note, v.origin]), [[2, '恢复 v1 前自动保存', 'before_restore'], [1, '初稿', 'manual']])
    const v2 = await call(page, (wb) => wb.papers.getVersion(2))
    assert.equal(v2.snapshot.sections.flatMap((s) => s.items).length, 3, 'v2 保存的是恢复前的草稿（3 道题）')
    const detail = await call(page, async (wb) => wb.papers.get((await wb.papers.list()).find((p) => p.title.includes('（A）'))!.id))
    assert.deepEqual({ title: detail.title, sections: detail.draft.sections }, { title: (v1Snapshot as { title: string }).title, sections: (v1Snapshot as { sections: unknown }).sections })
    assert.deepEqual((await call(page, (wb) => wb.papers.getVersion(1))).snapshot, v1Snapshot, 'v1 内容不变')
  })

  await step('恢复后再存版本得到 v3；v1、v2 不变', async () => {
    await page.getByRole('button', { name: '存为版本' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill('恢复后')
    await page.getByRole('button', { name: '存为 v3' }).click()
    await page.getByTestId('clean-tag').waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="version-item"]').length === 3)
    const nos = await page.getByTestId('version-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-version-no')))
    assert.deepEqual(nos, ['3', '2', '1'])
    assert.deepEqual((await call(page, (wb) => wb.papers.getVersion(1))).snapshot, v1Snapshot)
    assert.equal((await call(page, (wb) => wb.papers.getVersion(3))).note, '恢复后')
    await shot(page, '09-版本历史抽屉')
  })

  // ================= 下载记录 =================
  await step('下载记录：格式、版别、配置摘要、文件名；按原配置重新下载出错时界面显示原因而不崩溃', async () => {
    await launched.app.evaluate(({ shell }) => {
      shell.showItemInFolder = () => undefined
      shell.openPath = async () => ''
    })
    const db = openDatabase(dataDir)
    const paperId = (db.prepare("SELECT id FROM papers WHERE title LIKE '%（A）%'").get() as { id: number }).id
    const v3 = db.prepare('SELECT id FROM paper_versions WHERE paper_id = ? AND version_no = 3').get(paperId) as { id: number }
    const v1 = db.prepare('SELECT id FROM paper_versions WHERE paper_id = ? AND version_no = 1').get(paperId) as { id: number }
    recordExport(db, v1.id, 'pdf', { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }, join(exportDir, '七年级数学第一单元测试（A）_v1_学生版.pdf'))
    recordExport(db, v3.id, 'docx', { answerPosition: 'end', sourcePosition: 'before-stem', format: 'docx', answerArea: true }, join(exportDir, '七年级数学第一单元测试（A）_v3_教师版.docx'))
    db.close()
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    await page.getByTestId('export-record').first().waitFor()
    assert.equal(await page.getByTestId('export-record').count(), 2)
    const v3Row = page.getByTestId('version-item').filter({ hasText: 'v3' }).first()
    const text = await v3Row.getByTestId('export-record').innerText()
    assert.match(text, /DOCX/)
    assert.match(text, /教师版/)
    assert.match(text, /答案：卷尾 · 来源：题文前 · 作答区域：留作答区域/)
    assert.match(text, /七年级数学第一单元测试（A）_v3_教师版\.docx/)
    const v1Text = await page.getByTestId('version-item').filter({ hasText: '初稿' }).getByTestId('export-record').innerText()
    assert.match(v1Text, /PDF/)
    assert.match(v1Text, /学生版/)
    assert.match(v1Text, /来源：不显示 · 作答区域：不留/)
    await shot(page, '10-版本历史-下载记录')

    await v3Row.getByRole('button', { name: '按原配置重新下载' }).first().click()
    const message = page.getByTestId('drawer-message')
    await message.waitFor()
    console.log(`    重新下载反馈：${(await message.innerText()).trim()}`)
    assert.ok((await message.innerText()).trim().length > 0)
    // 下载模块已就绪时重新下载会成功并多出一条记录；未就绪时界面显示错误原因，两种结果界面都不能崩
    assert.ok(await page.getByTestId('version-drawer').isVisible(), '出错后抽屉仍在')
    await v3Row.getByRole('button', { name: '打开所在文件夹' }).first().click()
    await page.getByRole('button', { name: '版本历史', exact: true }).waitFor()
  })

  await step('点「下载」不崩溃：先写入草稿，再打开下载弹窗（弹窗由下载模块提供）', async () => {
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
    await page.getByRole('button', { name: '下载试卷', exact: true }).click()
    await page.waitForTimeout(500)
    await page.getByLabel('试卷标题').waitFor()
    const dialogs = await page.getByRole('dialog').count()
    console.log(`    下载弹窗数量：${dialogs}`)
    if (dialogs > 0) {
      await shot(page, '11-下载弹窗')
      await page.getByRole('dialog').getByRole('button', { name: /取消|关闭/ }).first().click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    }
  })

  await step('试卷库：列表显示最新版本号、题数与「未存为版本」', async () => {
    await page.locator('.bar-back').click()
    await page.getByRole('heading', { name: '试卷库' }).waitFor()
    await page.getByTestId('paper-row').first().waitFor()
    const rows = await page.getByTestId('paper-row').allInnerTexts()
    assert.equal(rows.length, 2)
    assert.ok(rows.some((r) => /（A）/.test(r) && /v3/.test(r) && /6 题/.test(r)), `A 卷应显示 v3 与 6 题（完形填空 3 个题号按题号数计）：${rows.join(' | ')}`)
    assert.ok(rows.some((r) => /对照卷/.test(r) && /未存为版本/.test(r)), `对照卷应显示未存为版本：${rows.join(' | ')}`)
    await shot(page, '04b-试卷库-两份试卷')
  })

  await step('编辑器整个过程中没有未处理的界面错误', async () => {
    assert.deepEqual(consoleErrors.filter((e) => !/Autofill|favicon/i.test(e)), [])
  })

  console.log(`编辑器端到端测试通过：${passed} 项，截图在 ${evidence}`)
} catch (error) {
  await shot(page, '99-失败现场').catch(() => undefined)
  console.error(`失败现场截图：${join(evidence, '99-失败现场.png')}`)
  throw error
} finally {
  await launched.app.close().catch(() => undefined)
}
