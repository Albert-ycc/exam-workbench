// 试卷结构与分值端到端测试：大题「每题 N 分」、单题分值 chip、逐题分值表三处入口互相同步；大题说明与全卷合计（含完形填空 15 空）；
// 结构面板（题号方格标缺答案 / 未设分并点击定位、目标满分、拖动调大题顺序）；窄窗口的结构条。
// 用法：node test/e2e/editor-structure.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { call, center, dragBetween, inDeskView, itemNos, itemOf, makeTempDirs, openEditor, saved, sectionAt, sectionNames, seedPaper, structureDraft, watchErrors } from './editor-support.e2e.ts'

const dirs = makeTempDirs('structure')
const evidence = process.argv[2] ?? dirs.evidence
mkdirSync(evidence, { recursive: true })
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(evidence, `${name}.png`) })

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

buildTo('out-editor4')
const launched = await launchApp({ outDir: 'out-editor4', dataDir: dirs.dataDir, userDataDir: dirs.userDataDir })
const page = launched.window
const errors: string[] = []
watchErrors(page, errors)
await page.setViewportSize({ width: 1440, height: 900 })

const note = (page: Page, index: number): Promise<string> => sectionAt(page, index).getByTestId('section-note').innerText()
const paneTotal = (page: Page): Promise<string> => page.getByTestId('struct-total-score').innerText()
const paneScores = (page: Page): Promise<string[]> => page.getByTestId('struct-row').getByTestId('struct-score').allInnerTexts()
const paneCounts = (page: Page): Promise<string[]> => page.getByTestId('struct-row').getByTestId('struct-count').allInnerTexts()

try {
  const paperId = await seedPaper(page, '结构与分值测试卷', structureDraft())
  await openEditor(page, paperId)
  await page.getByTestId('paper-item').first().waitFor()

  await step('题数按题号数：完形填空 15 空算 15 题，全卷 24 题，题号连续', async () => {
    assert.deepEqual(await itemNos(page), ['1', '2', '3', '4', '5～19', '20', '21', '22', '23', '24'])
    assert.deepEqual(await paneCounts(page), ['4', '15', '3', '2'])
    assert.equal((await page.getByTestId('struct-total-count').innerText()).trim(), '24')
    await shot(page, '01-结构与分值-1440')
  })

  await step('大题说明与全卷合计：全部相同写每小题几分，不同写满分，没设全只写题数', async () => {
    assert.equal(await note(page, 0), '（共 4 小题，每小题 4 分，共 16 分）')
    assert.equal(await note(page, 1), '（共 15 小题，每小题 1 分，共 15 分）')
    assert.equal(await note(page, 2), '（共 3 小题，满分 26 分）')
    assert.equal(await note(page, 3), '（共 2 小题）')
    assert.deepEqual((await paneScores(page)).map((t) => t.trim()), ['16', '15', '26', '—'])
    assert.equal((await paneTotal(page)).trim(), '57', '判断题还没设分，合计只算已设分的 57')
    assert.equal(await page.getByTestId('sheet-total').count(), 0, '没设全分值，卷头不写全卷满分')
    assert.equal((await itemOf(page, 'b1').getByTestId('score-chip').innerText()).trim(), '（每小题 1 分，共 15 分）')
    assert.equal((await itemOf(page, 'c3').getByTestId('score-chip').innerText()).trim(), '（本题 10 分）')
    assert.equal((await itemOf(page, 'd1').getByTestId('score-chip').innerText()).trim(), '＋分值')
  })

  await step('分值入口一：大题的「每小题 N 分」改成 5，大题说明、题上标注、结构表同步', async () => {
    await page.getByLabel('一、选择题每小题分值', { exact: true }).fill('5')
    assert.equal(await note(page, 0), '（共 4 小题，每小题 5 分，共 20 分）')
    assert.equal((await itemOf(page, 'a1').getByTestId('score-chip').innerText()).trim(), '（本题 5 分）')
    assert.deepEqual((await paneScores(page)).map((t) => t.trim()), ['20', '15', '26', '—'])
    assert.equal((await paneTotal(page)).trim(), '61')
  })

  await step('分值入口二：单题分值 chip 单独改第 2 题为 6，该大题变成「满分」写法，chip 带蓝点', async () => {
    const chip = itemOf(page, 'a2').getByTestId('score-chip')
    await chip.click()
    await itemOf(page, 'a2').getByLabel('第 2 题分值').fill('6')
    await page.keyboard.press('Enter')
    assert.equal((await chip.innerText()).trim(), '（本题 6 分）')
    assert.ok((await chip.getAttribute('class'))!.includes('is-own'), '单独设置的分值带蓝点')
    assert.equal(await note(page, 0), '（共 4 小题，满分 21 分）')
    assert.equal((await paneTotal(page)).trim(), '62')
    assert.ok(!(await itemOf(page, 'a1').getByTestId('score-chip').getAttribute('class'))!.includes('is-own'))
  })

  await step('分值入口三：分值表里逐题填，Tab 跳到下一题继续填', async () => {
    await page.getByRole('radio', { name: '分值表' }).click()
    const table = page.getByTestId('score-table')
    await table.waitFor()
    const third = table.getByLabel('第 3 题分值（分值表）')
    await third.fill('7')
    assert.equal((await itemOf(page, 'a3').getByTestId('score-chip').innerText()).trim(), '（本题 7 分）')
    assert.equal(await note(page, 0), '（共 4 小题，满分 23 分）')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '第 4 题分值（分值表）')
    await page.keyboard.type('9')
    assert.equal((await itemOf(page, 'a4').getByTestId('score-chip').innerText()).trim(), '（本题 9 分）')
    assert.equal(await note(page, 0), '（共 4 小题，满分 27 分）')
    await shot(page, '02-分值表')
    await page.getByRole('radio', { name: '结构', exact: true }).click()
  })

  await step('清空单题分值回到跟随大题；单独设分的题数在分值表里可一键统一', async () => {
    const chip = itemOf(page, 'a2').getByTestId('score-chip')
    await chip.click()
    await itemOf(page, 'a2').getByLabel('第 2 题分值').fill('')
    await page.keyboard.press('Enter')
    assert.equal((await chip.innerText()).trim(), '（本题 5 分）')
    await page.getByRole('radio', { name: '分值表' }).click()
    await page.getByRole('button', { name: /全部跟随大题（2 题单独设分）/ }).first().click()
    assert.equal(await note(page, 0), '（共 4 小题，每小题 5 分，共 20 分）')
    await page.getByRole('radio', { name: '结构', exact: true }).click()
    assert.equal((await paneTotal(page)).trim(), '61')
  })

  await step('题号方格：缺答案与未设分的题号做记号，图例给出数量；点题号定位并闪一下', async () => {
    const cells = page.getByTestId('grid-cell')
    assert.equal(await cells.count(), 24)
    const missing = await cells.evaluateAll((els) => els.filter((e) => e.classList.contains('is-missing')).map((e) => Number(e.getAttribute('data-no'))))
    assert.deepEqual(missing, [2, 3, ...Array.from({ length: 15 }, (_, k) => 5 + k), 20, 21, 22, 23, 24])
    const unscored = await cells.evaluateAll((els) => els.filter((e) => e.classList.contains('is-unscored')).map((e) => Number(e.getAttribute('data-no'))))
    assert.deepEqual(unscored, [23, 24])
    const legend = await page.getByTestId('grid-legend').innerText()
    assert.match(legend, /缺答案 22 题/)
    assert.match(legend, /未设分 2 题/)
    await page.locator('.ed-desk').evaluate((el) => (el.scrollTop = 0))
    await page.locator('[data-testid="grid-cell"][data-no="12"]').click()
    await page.waitForFunction(() => document.querySelector('[data-item-id="b1"]')?.classList.contains('is-flash'))
    assert.ok(await inDeskView(page, itemOf(page, 'b1')), '点第 12 题后，完形填空那一块滚进了可见范围')
    const current = await cells.evaluateAll((els) => els.filter((e) => e.classList.contains('is-current')).map((e) => Number(e.getAttribute('data-no'))))
    assert.deepEqual(current, Array.from({ length: 15 }, (_, k) => 5 + k), '选中块占的 15 个题号都标为当前')
    await shot(page, '03-点题号定位')
  })

  await step('目标满分：还差 / 超出 / 一致，存在草稿里，不算试卷内容的改动', async () => {
    const target = page.getByLabel('目标满分', { exact: true })
    const text = (): Promise<string> => page.getByTestId('target-note').innerText()
    await target.fill('100')
    assert.equal((await text()).trim(), '还差 39 分（另有 2 题未设分）')
    await target.fill('61')
    assert.match(await text(), /^✓ 与当前总分一致/)
    // 把判断题每小题设成 2 分，全卷满分 65
    await page.getByLabel('四、判断题每小题分值', { exact: true }).fill('2')
    assert.equal(await note(page, 3), '（共 2 小题，每小题 2 分，共 4 分）')
    assert.equal((await page.getByTestId('sheet-total').innerText()).trim(), '（全卷满分：65分）')
    assert.equal((await text()).trim(), '超出 4 分', '目标 61、实际 65')
    await target.fill('60')
    assert.equal((await text()).trim(), '超出 5 分')
    await saved(page)
    const detail = await call(page, (wb) => wb.papers.list().then((l) => wb.papers.get(l[0].id)))
    assert.equal(detail.draft.targetScore, 60)
    // 存成版本后只改目标满分：草稿仍与最新版本一致
    await page.getByRole('button', { name: '存为版本' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /存为 v1/ }).click()
    await page.getByTestId('clean-tag').waitFor()
    await target.fill('70')
    await saved(page)
    assert.equal(await page.getByTestId('dirty-tag').count(), 0, '只改目标满分不算有改动')
    const snapshot = (await call(page, (wb) => wb.papers.getVersion(1))).snapshot as unknown as Record<string, unknown>
    assert.ok(!('targetScore' in snapshot), '目标满分不进版本快照')
  })

  await step('结构面板拖动调大题顺序：解答题拖到最前，大题序号与题号随之重排', async () => {
    const rows = page.getByTestId('struct-row')
    assert.equal(await rows.count(), 4)
    const grip = rows.nth(2).getByRole('button', { name: /拖动调整.*顺序/ })
    const from = await center(grip)
    const to = await center(rows.nth(0))
    await dragBetween(page, from, { x: to.x, y: to.y - 8 })
    await page.waitForFunction(() => (document.querySelector('[data-testid="section-name"]') as HTMLTextAreaElement)?.value === '解答题')
    assert.deepEqual(await sectionNames(page), ['解答题', '选择题', '完形填空', '判断题'])
    assert.deepEqual(await itemNos(page), ['1', '2', '3', '4', '5', '6', '7', '8～22', '23', '24'])
    assert.equal(await note(page, 0), '（共 3 小题，满分 26 分）')
    await saved(page)
  })

  await step('窄窗口（1280）：结构栏收成卷面顶部的结构条，每个大题一枚标签，点击定位，滚动时当前大题高亮', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByTestId('struct-bar').waitFor()
    assert.equal(await page.getByTestId('struct-pane').count(), 0)
    const chips = page.getByTestId('struct-chip')
    assert.equal(await chips.count(), 4)
    assert.match(await chips.nth(1).innerText(), /二\s*选择题\s*4 题\s*·\s*20 分/)
    assert.match(await page.getByTestId('struct-total').innerText(), /共 24 题 · 满分 65 分/)
    await chips.nth(3).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="struct-chip"]')[3]?.getAttribute('aria-current') === 'true')
    assert.ok(await inDeskView(page, sectionAt(page, 3)))
    await page.locator('.ed-desk').evaluate((el) => (el.scrollTop = 0))
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="struct-chip"]')[0]?.getAttribute('aria-current') === 'true')
    await shot(page, '04-结构条-1280')
  })

  await step('窄窗口：「试卷结构」弹出完整面板，点题号方格关闭面板并定位', async () => {
    await page.getByTestId('struct-toggle').click()
    const pop = page.getByTestId('struct-popover')
    await pop.waitFor()
    await shot(page, '05-结构面板弹出-1280')
    assert.equal(await pop.getByTestId('struct-row').count(), 4)
    await pop.locator('[data-testid="grid-cell"][data-no="24"]').click()
    await pop.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelector('[data-item-id="d2"]')?.classList.contains('is-flash'))
    assert.ok(await inDeskView(page, itemOf(page, 'd2')))
  })

  await step('整个过程没有未处理的界面错误', async () => {
    assert.deepEqual(errors.filter((e) => !/Autofill|favicon/i.test(e)), [])
  })

  console.log(`试卷结构与分值端到端测试通过：${passed} 项，截图在 ${evidence}`)
} catch (error) {
  await shot(page, '99-失败现场').catch(() => undefined)
  console.error(`失败现场截图：${join(evidence, '99-失败现场.png')}`)
  throw error
} finally {
  await launched.app.close().catch(() => undefined)
}
