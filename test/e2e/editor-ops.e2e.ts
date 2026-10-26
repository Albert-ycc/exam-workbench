// 编辑器操作端到端测试：「加入试卷」与批量加入、重复提示、隐藏已加入、撤销重做（20 步）、折叠、题目菜单与快捷键、大题名预设、
// 添加答案、存版本快捷键、恢复与「回到恢复前」、版本摘要、另存为新试卷、空卷置灰、连续删题合并提示、切页回来状态还在、
// 版本历史停靠、下载弹窗里点题号定位、自动滚动限速、拖动浮标文案、短题不显示「展开」、空库「去采集」。
// 用法：node test/e2e/editor-ops.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { openDatabase } from '../../src/main/db.ts'
import { addCustomSection, call, center, dragBetween, inDeskView, itemNos, itemOf, makeItem, makeTempDirs, openEditor, saved, sectionAt, sectionNames, seedPaper, structureDraft, watchErrors } from './editor-support.e2e.ts'

const dirs = makeTempDirs('ops')
const evidence = process.argv[2] ?? dirs.evidence
mkdirSync(evidence, { recursive: true })
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(evidence, `${name}.png`) })

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// ---------- 素材：6 道样例题 + 30 道单选题（让题库栏能滚动）+ 一道很长的题 ----------
const { questionIds } = seedDataDir(dirs.dataDir)
const [qChoice, qBlank, qCalc, qSolve, qCloze] = questionIds
{
  const db = openDatabase(dirs.dataDir)
  const paperId = (db.prepare('SELECT id FROM source_papers ORDER BY id').get() as { id: number }).id
  const insert = db.prepare(
    `INSERT INTO questions (zujuan_qid, source_paper_id, source_label, source_order, question_type, number_count, stem_html, answer_html, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const now = new Date().toISOString()
  for (let i = 0; i < 30; i++) insert.run(`91${String(i).padStart(4, '0')}`, paperId, '补充题库', 100 + i, '单选题', 1, `<p>补充单选题第 ${i + 1} 号：下列说法正确的是（　）</p>`, null, `extra-${i}`, now)
  const long = Array.from({ length: 12 }, (_, k) => `<p>很长的题干第 ${k + 1} 行：这一段文字用来撑出足够的高度。</p>`).join('')
  insert.run('919999', paperId, '补充题库', 200, '解答题', 1, long, null, 'extra-long', now)
  db.close()
}

buildTo('out-editor4')
const launched = await launchApp({ outDir: 'out-editor4', dataDir: dirs.dataDir, userDataDir: dirs.userDataDir })
const page = launched.window
const errors: string[] = []
watchErrors(page, errors)
await page.setViewportSize({ width: 1440, height: 900 })

const libRow = (id: number) => page.locator(`[data-testid="lib-card"][data-question-id="${id}"]`)
const toastWith = (text: string | RegExp) => page.getByTestId('toast').filter({ hasText: text })
const getDraft = (id: number) => page.evaluate((pid) => window.workbench.papers.get(pid).then((d) => d.draft), id)
const layout = (draft: { sections: { title: string; items: { id: string }[] }[] }): string => draft.sections.map((s) => `${s.title}:${s.items.map((i) => i.id).join(',')}`).join('|')
// 点一下卷面标题把焦点移出输入框，Ctrl+Z 才交给编辑器而不是输入框自己的撤销
const blurInputs = async (): Promise<void> => {
  await page.locator('.ed-sheet-title').click()
}

try {
  // ================= 空卷 =================
  const emptyId = (await page.evaluate(() => window.workbench.papers.create('空白测试卷'))) as number
  await openEditor(page, emptyId)

  await step('S3 空试卷：存为版本、下载试卷、下载答题卡置灰并写明原因', async () => {
    for (const name of ['存为版本', '下载试卷', '下载答题卡']) {
      const button = page.getByRole('button', { name, exact: true })
      assert.equal(await button.isDisabled(), true, `${name}应置灰`)
      assert.match((await button.getAttribute('title')) ?? '', /还没有题目/)
    }
    await page.getByText('添加题目后才能存版本、下载').waitFor()
    assert.equal(await page.getByRole('menuitem', { name: '另存为新试卷…' }).count(), 0)
    await shot(page, '01-空试卷')
  })

  await step('M2 题库「加入试卷」：按题型落到匹配的大题，没有就新建；新加入的题闪一下并滚到可见', async () => {
    await libRow(qChoice).getByRole('button', { name: '加入试卷' }).click()
    await page.getByTestId('paper-item').first().waitFor()
    assert.deepEqual(await sectionNames(page), ['单选题'])
    await page.waitForFunction(() => document.querySelector('[data-testid="paper-item"]')?.classList.contains('is-flash'))
    await libRow(qBlank).getByRole('button', { name: '加入试卷' }).click()
    await libRow(qCalc).getByRole('button', { name: '加入试卷' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 3)
    assert.deepEqual(await sectionNames(page), ['单选题', '填空题', '计算题'])
    assert.deepEqual(await itemNos(page), ['1', '2', '3'])
    assert.equal((await page.getByTestId('lib-added-count').innerText()).trim(), '· 已加入 3 道')
    for (const name of [/^存为版本/, '下载试卷', '下载答题卡']) assert.equal(await page.getByRole('button', { name, exact: typeof name === 'string' }).isDisabled(), false, `${name}有题后可用`)
    await saved(page)
  })

  await step('M2 多选批量加入：勾选两道题，一次加入，落点各按题型匹配', async () => {
    await libRow(qSolve).getByRole('checkbox').check()
    await libRow(qCloze).getByRole('checkbox').check()
    await page.getByText('已选 2 道').waitFor()
    await page.getByRole('button', { name: '加入试卷（2）' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 5)
    assert.deepEqual(await sectionNames(page), ['单选题', '填空题', '计算题', '完形填空', '解答题'], '批量加入按题库里的顺序依次落点')
    assert.deepEqual(await itemNos(page), ['1', '2', '3', '4～6', '7'])
    await toastWith('已加入 2 道题').waitFor()
    assert.equal(await page.getByText('已选 2 道').count(), 0, '加入后选择清空')
    assert.equal((await page.getByTestId('lib-added-count').innerText()).trim(), '· 已加入 5 道')
    await saved(page)
  })

  await step('S8 重复加入：提示「该题已在第 1 题」，可撤销', async () => {
    await libRow(qChoice).getByRole('button', { name: '加入试卷' }).click()
    const toast = toastWith('该题已在第 1 题')
    await toast.waitFor()
    assert.equal(await sectionAt(page, 0).getByTestId('paper-item').count(), 2)
    await toast.getByRole('button', { name: '撤销' }).click()
    assert.equal(await sectionAt(page, 0).getByTestId('paper-item').count(), 1)
  })

  await step('F4 隐藏已加入：只剩没加入的题，计数同步', async () => {
    const total = await page.getByTestId('lib-card').count()
    await page.getByRole('checkbox', { name: '隐藏已加入' }).check()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="lib-card"]').length < n, total)
    assert.equal(await page.locator('.ed-lib-added').count(), 0)
    assert.equal(await libRow(qChoice).count(), 0)
    await page.getByRole('checkbox', { name: '隐藏已加入' }).uncheck()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="lib-card"]').length === n, total)
  })

  // ================= 撤销 / 重做 =================
  const base = structureDraft()
  const baseLayout = layout(base)

  await step('F1 撤销重做：删题、删大题、调序、改名、改分值、加入共 7 步，Ctrl+Z 逐步回到起点，Ctrl+Shift+Z 逐步回来', async () => {
    const id = await seedPaper(page, '撤销测试卷', base)
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const sig = async (): Promise<string> => JSON.stringify((await getDraft(id)).sections)
    const states: string[] = [await sig()]
    const snap = async (): Promise<void> => {
      await saved(page)
      states.push(await sig())
    }
    // 1 删题
    await itemOf(page, 'a1').getByRole('button', { name: /删除第 1 题/ }).click()
    await snap()
    // 2 删大题（判断题）
    await sectionAt(page, 3).getByRole('button', { name: '删除大题' }).click()
    await snap()
    // 3 调序：选中第 3 题（a3 现在是第 2 题），Alt+↑ 上移
    await itemOf(page, 'a3').click({ position: { x: 300, y: 10 } })
    await page.keyboard.press('Alt+ArrowUp')
    await snap()
    // 4 大题改名
    const name = sectionAt(page, 0).getByTestId('section-name')
    await name.fill('单项选择题')
    await blurInputs()
    await snap()
    // 5 改单题分值
    await itemOf(page, 'a2').getByTestId('score-chip').click()
    await itemOf(page, 'a2').getByLabel(/分值/).fill('3')
    await page.keyboard.press('Enter')
    await blurInputs()
    await snap()
    // 6 大题下移
    await sectionAt(page, 0).getByRole('button', { name: '大题下移' }).click()
    await snap()
    // 7 从题库加入
    await libRow(qChoice).getByRole('button', { name: '加入试卷' }).click()
    await snap()
    assert.equal(new Set(states).size, 8, '每一步都改变了草稿')
    assert.equal(await page.getByTestId('undo').isDisabled(), false)
    assert.equal(await page.getByTestId('redo').isDisabled(), true)

    await blurInputs()
    for (let k = 6; k >= 0; k--) {
      await page.keyboard.press('ControlOrMeta+z')
      await saved(page)
      assert.equal(await sig(), states[k], `撤销到第 ${k} 步的状态`)
    }
    assert.equal(await page.getByTestId('undo').isDisabled(), true, '撤销到头后撤销按钮置灰')
    const restored = await getDraft(id)
    assert.equal(restored.sections[0].title, '选择题')
    assert.equal(restored.sections[0].items.find((i) => i.id === 'a2')?.score, undefined)
    for (let k = 1; k <= 7; k++) {
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await saved(page)
      assert.equal(await sig(), states[k], `重做到第 ${k} 步的状态`)
    }
    const redone = await getDraft(id)
    assert.equal(redone.sections.find((s) => s.title === '单项选择题')?.items.find((i) => i.id === 'a2')?.score, 3)
    await shot(page, '02-撤销重做之后')
  })

  await step('F1 历史最多 20 步：连做 22 步后撤销 25 次，只回退最近的 20 步', async () => {
    const id = await seedPaper(page, '二十步测试卷', { sections: [{ id: 'x', title: '起点', items: [makeItem('x1', '题')] }] })
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    for (let k = 0; k < 22; k++) await addCustomSection(page)
    assert.equal(await page.getByTestId('section').count(), 23)
    await blurInputs()
    for (let k = 0; k < 25; k++) await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="section"]').length === 3)
    assert.equal(await page.getByTestId('section').count(), 3, '22 步里最早的 2 步已经放不下')
    assert.equal(await page.getByTestId('undo').isDisabled(), true)
  })

  // ================= 折叠 =================
  await step('F2 大题折叠：单个折叠、一键全部折叠 / 展开', async () => {
    const id = await seedPaper(page, '折叠测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    assert.equal(await page.getByTestId('paper-item').count(), 10)
    await sectionAt(page, 0).getByRole('button', { name: /折叠一、选择题/ }).click()
    assert.equal(await page.getByTestId('paper-item').count(), 6)
    await sectionAt(page, 0).getByText(/已折叠，共 4 题/).waitFor()
    await page.getByRole('button', { name: '全部折叠' }).click()
    assert.equal(await page.getByTestId('paper-item').count(), 0)
    await page.getByRole('button', { name: '全部展开' }).click()
    assert.equal(await page.getByTestId('paper-item').count(), 10)
    // 点题号方格定位到折叠起来的大题里的题：先展开再滚过去
    await sectionAt(page, 2).getByRole('button', { name: /折叠三、解答题/ }).click()
    assert.equal(await page.getByTestId('paper-item').count(), 7)
    await page.locator('[data-testid="grid-cell"][data-no="21"]').click()
    await page.waitForFunction(() => document.querySelector('[data-item-id="c2"]'))
    assert.equal(await page.getByTestId('paper-item').count(), 10)
    assert.ok(await inDeskView(page, itemOf(page, 'c2')))
  })

  // ================= 题目菜单与快捷键 =================
  await step('F3 题目「⋯」菜单：下移、移到其他大题；Alt+↑↓ 同效', async () => {
    const id = await seedPaper(page, '菜单测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    await itemOf(page, 'a1').getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: /^下移/ }).click()
    await saved(page)
    assert.equal(layout(await getDraft(id)).split('|')[0], '选择题:a2,a1,a3,a4')
    await itemOf(page, 'a1').getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '三、解答题' }).click()
    await saved(page)
    assert.equal(layout(await getDraft(id)).split('|').slice(0, 3).join('|'), '选择题:a2,a3,a4|完形填空:b1|解答题:c1,c2,c3,a1')
    // 键盘：选中 a4，Alt+↓ 越过大题边界进入完形填空所在的大题开头
    await itemOf(page, 'a4').click({ position: { x: 300, y: 10 } })
    await page.keyboard.press('Alt+ArrowDown')
    await saved(page)
    assert.equal(layout(await getDraft(id)).split('|')[1], '完形填空:a4,b1')
    await page.keyboard.press('Alt+ArrowUp')
    await saved(page)
    assert.equal(layout(await getDraft(id)).split('|')[0], '选择题:a2,a3,a4')
  })

  await step('F8 大题名预设：新建大题直接选名称；大题名旁的下拉可改成预设名', async () => {
    await page.getByTestId('add-section').click()
    await page.getByRole('menuitem', { name: '阅读理解' }).click()
    const count = await page.getByTestId('section').count()
    assert.equal((await sectionNames(page))[count - 1], '阅读理解')
    await sectionAt(page, 0).getByRole('button', { name: '选用预设名称' }).click()
    await page.getByRole('menuitem', { name: '计算题' }).click()
    assert.equal((await sectionNames(page))[0], '计算题')
    await shot(page, '03-大题名预设')
  })

  await step('N 大题名输入框随内容增高', async () => {
    const name = sectionAt(page, 0).getByTestId('section-name')
    const before = (await name.boundingBox())!.height
    await name.fill('这是一个特别特别长的大题名称，用来检验输入框会随着内容增高而不是只显示一截，所以要写得足够长足够长足够长足够长足够长足够长')
    const after = (await name.boundingBox())!.height
    assert.ok(after > before + 10, `长名称应折成多行：${before} → ${after}`)
    await name.fill('选择题')
  })

  await step('F9 没答案的题直接「添加答案」，进入答案编辑并聚焦；S5 Esc 结束编辑，Ctrl+Enter 同效', async () => {
    const item = itemOf(page, 'a2')
    await item.getByTestId('add-answer').click()
    const editor = item.getByTestId('edit-answer')
    await editor.waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'edit-answer')
    await page.keyboard.insertText('【答案】B')
    await page.keyboard.press('Escape')
    await item.getByTestId('edit-answer').waitFor({ state: 'detached' })
    await item.getByRole('button', { name: '查看答案' }).waitFor()
    assert.equal(await item.getByTestId('add-answer').count(), 0)
    // Ctrl+Enter
    await item.getByRole('button', { name: '编辑', exact: true }).click()
    await item.getByTestId('edit-stem').click()
    await page.keyboard.press('ControlOrMeta+Enter')
    await item.getByTestId('edit-stem').waitFor({ state: 'detached' })
    await saved(page)
    const detail = await call(page, (wb) => wb.papers.list().then((l) => wb.papers.get(l.find((p) => p.title === '菜单测试卷')!.id)))
    assert.match(detail.draft.sections[0].items.find((i) => i.id === 'a2')!.answerHtml ?? '', /【答案】B/)
  })

  // ================= 版本 =================
  const verId = await seedPaper(page, '版本测试卷', structureDraft())
  await openEditor(page, verId)
  await page.getByTestId('paper-item').first().waitFor()

  await step('S5 Ctrl+S 打开「存为版本」，回车存成 v1；S15 存为版本按钮的红点随改动出现与消失', async () => {
    assert.equal(await page.locator('.ui-btn-dot').count(), 1, '尚未存版本，按钮上有红点')
    await page.getByRole('main').press('ControlOrMeta+s').catch(() => undefined)
    await page.keyboard.press('ControlOrMeta+s')
    const dialog = page.getByRole('dialog', { name: '存为版本' })
    await dialog.waitFor()
    await dialog.getByRole('textbox').fill('初稿')
    await page.keyboard.press('Enter')
    await page.getByTestId('clean-tag').waitFor()
    assert.equal(await page.locator('.ui-btn-dot').count(), 0, '存完版本，红点消失')
    assert.match(await page.getByTestId('clean-tag').innerText(), /与 v1 一致/)
  })

  await step('S7 版本列表自动写摘要：「4 个大题 · 24 题 · 57 分（2 题未设分）」', async () => {
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    const text = await page.getByTestId('version-structure').first().innerText()
    assert.equal(text.trim(), '4 个大题 · 24 题 · 57 分（2 题未设分）')
  })

  await step('S17 版本历史停靠在右侧：卷面被挤窄而不是被盖住', async () => {
    const drawer = (await page.locator('.ui-drawer').boundingBox())!
    const desk = (await page.locator('.ed-desk').boundingBox())!
    assert.ok(desk.x + desk.width <= drawer.x + 1, `卷面右缘 ${desk.x + desk.width} 不应超过抽屉左缘 ${drawer.x}`)
    await shot(page, '04-版本历史停靠-1440')
  })

  await step('S6 恢复版本：提示条带「回到恢复前」，顶栏写「内容同 v1」而不是误报有改动', async () => {
    await itemOf(page, 'a1').getByRole('button', { name: /删除第 1 题/ }).click()
    await saved(page)
    assert.equal(layout(await getDraft(verId)).split('|')[0], '选择题:a2,a3,a4')
    await page.getByTestId('version-item').first().getByRole('button', { name: '恢复' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '恢复到 v1' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(layout(await getDraft(verId)).split('|')[0], '选择题:a1,a2,a3,a4')
    assert.match(await page.getByTestId('clean-tag').innerText(), /内容同 v1/)
    assert.equal(await page.getByTestId('dirty-tag').count(), 0)
    const toast = toastWith('已恢复 v1 的内容')
    await toast.getByRole('button', { name: '回到恢复前' }).click()
    await saved(page)
    assert.equal(layout(await getDraft(verId)).split('|')[0], '选择题:a2,a3,a4', '回到了恢复前的内容')
    // 恢复前服务端把未存的改动存成了 v2，回到恢复前的内容正好与 v2 一致
    await page.waitForFunction(() => document.querySelector('[data-testid="clean-tag"]')?.textContent?.includes('与 v2 一致'))
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
  })

  await step('F10 另存为新试卷：从当前草稿复制，新试卷没有版本，当前这份不变', async () => {
    const before = (await call(page, (wb) => wb.papers.list())).length
    await page.getByTestId('bar-more').click()
    await page.getByRole('menuitem', { name: '另存为新试卷…' }).click()
    const dialog = page.getByRole('dialog', { name: '另存为新试卷' })
    assert.equal(await dialog.getByRole('textbox').inputValue(), '版本测试卷（副本）')
    await dialog.getByRole('textbox').fill('版本测试卷 B 卷')
    await dialog.getByRole('button', { name: '另存' }).click()
    await toastWith('已另存为新试卷').waitFor()
    const list = await call(page, (wb) => wb.papers.list())
    assert.equal(list.length, before + 1)
    const copy = list.find((p) => p.title === '版本测试卷 B 卷')!
    assert.equal(copy.latestVersionNo, null)
    assert.equal(copy.structure.questionCount, 23, '复制的是当前草稿（删掉了第 1 题）')
    assert.equal(layout(await getDraft(verId)).split('|')[0], '选择题:a2,a3,a4', '当前这份不变')
  })

  await step('F10 版本历史里每个版本也能另存为新试卷：复制的是那个版本的内容', async () => {
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    await page.locator('[data-testid="version-item"][data-version-no="1"]').getByRole('button', { name: '另存为新试卷' }).click()
    const dialog = page.getByRole('dialog', { name: '另存为新试卷' })
    assert.match(await dialog.innerText(), /复制这个历史版本的内容/)
    await dialog.getByRole('textbox').fill('由 v1 另存的卷')
    await dialog.getByRole('button', { name: '另存' }).click()
    await toastWith('已另存为新试卷').last().waitFor()
    const list = await call(page, (wb) => wb.papers.list())
    const copy = list.find((p) => p.title === '由 v1 另存的卷')!
    assert.equal(copy.structure.questionCount, 24, 'v1 里有 24 题')
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
  })

  // ================= 连续删题 =================
  await step('S13 连续删三题合并成一条提示，文案带题干前 10 字，「撤销全部」按原位置全部恢复', async () => {
    const id = await seedPaper(page, '删题测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    await page.getByTestId('toast').evaluateAll((els) => els.forEach((e) => e.querySelector<HTMLButtonElement>('.ui-toast-close')?.click()))
    await itemOf(page, 'a2').getByRole('button', { name: /删除第 2 题/ }).click()
    const toast = toastWith(/已删除第 2 题「甲题二」/)
    await toast.waitFor()
    await itemOf(page, 'a3').getByRole('button', { name: /删除第 2 题/ }).click()
    await itemOf(page, 'a4').getByRole('button', { name: /删除第 2 题/ }).click()
    const merged = toastWith('已删除 3 题')
    await merged.waitFor()
    assert.equal(await page.getByTestId('toast').filter({ hasText: /已删除/ }).count(), 1, '三次删除合并成一条')
    await merged.getByRole('button', { name: '撤销全部' }).click()
    await saved(page)
    assert.equal(layout(await getDraft(id)).split('|')[0], '选择题:a1,a2,a3,a4')
  })

  // ================= 切页回来 =================
  await step('S11 切到别的页面再回来：打开的试卷、卷面滚动位置、题库筛选、隐藏已加入、折叠状态都还在', async () => {
    const id = await seedPaper(page, '状态保持测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    await page.getByLabel('题型').selectOption({ label: '单选题' })
    await page.getByRole('checkbox', { name: '隐藏已加入' }).check()
    await sectionAt(page, 1).getByRole('button', { name: /折叠二、完形填空/ }).click()
    await page.locator('.ed-desk').evaluate((el) => (el.scrollTop = 260))
    await page.waitForTimeout(500)
    const scrolled = await page.locator('.ed-desk').evaluate((el) => el.scrollTop)
    assert.ok(scrolled > 100)
    await page.locator('.app-nav .nav-item', { hasText: '设置' }).click()
    await page.getByLabel('试卷标题').waitFor({ state: 'detached' })
    await page.locator('.app-nav .nav-item', { hasText: '试卷库' }).click()
    await page.getByLabel('试卷标题').waitFor()
    assert.equal(await page.getByLabel('试卷标题').inputValue(), '状态保持测试卷')
    await page.getByTestId('paper-item').first().waitFor()
    await page.waitForTimeout(300)
    assert.ok(Math.abs((await page.locator('.ed-desk').evaluate((el) => el.scrollTop)) - scrolled) <= 3, '卷面滚动位置回到原处')
    assert.equal(await page.getByLabel('题型').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0].textContent), '单选题')
    assert.equal(await page.getByRole('checkbox', { name: '隐藏已加入' }).isChecked(), true)
    assert.equal(await sectionAt(page, 1).getByText(/已折叠/).count(), 1)
    await page.getByRole('checkbox', { name: '隐藏已加入' }).uncheck()
    await page.getByLabel('题型').selectOption({ label: '全部题型' })
  })

  await step('M4 换筛选条件后题库栏回到顶部', async () => {
    const list = page.locator('.ed-lib-list')
    await list.evaluate((el) => (el.scrollTop = 400))
    assert.ok((await list.evaluate((el) => el.scrollTop)) > 100)
    await page.getByLabel('题型').selectOption({ label: '解答题' })
    await page.waitForFunction(() => (document.querySelector('.ed-lib-list') as HTMLElement).scrollTop === 0)
    await page.getByLabel('题型').selectOption({ label: '全部题型' })
  })

  await step('N 短题不显示「展开」，长题显示', async () => {
    await page.getByPlaceholder('题干关键词').fill('很长的题干')
    await page.getByTestId('lib-card').filter({ hasText: '很长的题干第 1 行' }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="lib-card"]').length === 1)
    await page.getByTestId('lib-card').getByRole('button', { name: '展开', exact: true }).waitFor()
    await page.getByPlaceholder('题干关键词').fill('补充单选题第 3 号')
    await page.getByTestId('lib-card').filter({ hasText: '补充单选题第 3 号' }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="lib-card"]').length === 1)
    assert.equal(await page.getByTestId('lib-card').getByRole('button', { name: '展开', exact: true }).count(), 0)
    await page.getByPlaceholder('题干关键词').fill('')
  })

  await step('S16 题库栏可折叠成窄条，折叠状态记住', async () => {
    await page.getByRole('button', { name: '收起试题库' }).click()
    assert.ok(((await page.locator('.ed-lib').boundingBox())!.width) <= 40)
    await page.locator('.app-nav .nav-item', { hasText: '采集' }).click().catch(() => undefined)
    await page.locator('.app-nav .nav-item', { hasText: '设置' }).click()
    await page.locator('.app-nav .nav-item', { hasText: '试卷库' }).click()
    await page.getByLabel('试卷标题').waitFor()
    assert.ok(((await page.locator('.ed-lib').boundingBox())!.width) <= 40, '切页回来仍是折叠的')
    await shot(page, '05-题库栏折叠')
    await page.getByRole('button', { name: '展开试题库' }).click()
    assert.ok(((await page.locator('.ed-lib').boundingBox())!.width) >= 300)
  })

  // ================= 拖动 =================
  await step('拖动浮标写「第 N 题 · 题型」与「松开放进 …」，插入位置写「插入为第 N 题」', async () => {
    const id = await seedPaper(page, '拖动测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const grip = itemOf(page, 'a1').getByRole('button', { name: /拖动第/ })
    const from = await center(grip)
    const to = await center(itemOf(page, 'a3'))
    await dragBetween(page, from, { x: to.x, y: to.y + 20 }, async () => {
      const strip = page.getByTestId('drag-strip')
      await strip.waitFor()
      const text = await strip.innerText()
      assert.match(text, /第 1 题 · 单选题/)
      assert.match(text, /松开放进「一、选择题」，成为第 3 题/)
      assert.match(await page.locator('.ed-drop-hint').innerText(), /插入为第 3 题/)
      await shot(page, '06-拖动中')
    })
    await saved(page)
    assert.equal(layout(await getDraft(id)).split('|')[0], '选择题:a2,a3,a1,a4')
    // 从题库拖：浮标里写题型与落点，公式图不会显示成空白
    const card = libRow(qChoice)
    const cardPos = await center(card.locator('.ed-lib-stem'))
    const target = await center(itemOf(page, 'c1'))
    await dragBetween(page, cardPos, { x: target.x, y: target.y - 10 }, async () => {
      const text = await page.getByTestId('drag-strip').innerText()
      assert.match(text, /单选题/)
      assert.match(text, /松开放进「三、解答题」，成为第 \d+ 题/)
    })
    await saved(page)
  })

  await step('M2 拖到卷面底边自动滚动：触发区约 80px，最快每秒不超过 400px', async () => {
    const id = await seedPaper(page, '滚动测试卷', {
      sections: [{ id: 'long', title: '选择题', items: Array.from({ length: 40 }, (_, k) => makeItem(`l${k}`, `长卷第 ${k + 1} 题的题干，随便写几个字撑出一点高度`)) }]
    })
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const desk = page.locator('.ed-desk')
    await desk.evaluate((el) => (el.scrollTop = 0))
    const box = (await desk.boundingBox())!
    const card = await center(libRow(qBlank).locator('.ed-lib-stem'))
    await page.mouse.move(card.x, card.y)
    await page.mouse.down()
    await page.mouse.move(card.x + 10, card.y + 10, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
    // 先停在触发区外：不滚动
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 120, { steps: 4 })
    await page.waitForTimeout(300)
    assert.equal(await desk.evaluate((el) => el.scrollTop), 0, '触发区之外不滚动')
    // 贴着底边停 1 秒
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2, { steps: 4 })
    const t0 = Date.now()
    const s0 = await desk.evaluate((el) => el.scrollTop)
    await page.waitForTimeout(1000)
    const s1 = await desk.evaluate((el) => el.scrollTop)
    const seconds = (Date.now() - t0) / 1000
    await page.mouse.up()
    const speed = (s1 - s0) / seconds
    console.log(`    贴底边 ${seconds.toFixed(2)} 秒滚动 ${s1 - s0}px，约 ${speed.toFixed(0)}px/s`)
    assert.ok(speed > 120, `应该在滚动：${speed}`)
    assert.ok(speed <= 400, `限速 400px/s 以内：${speed}`)
  })

  // ================= 下载弹窗里点题号定位 =================
  await step('S2 下载弹窗里缺答案的题号可点击：关闭弹窗，滚到该题并闪一下', async () => {
    const id = await seedPaper(page, '定位测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    await page.getByRole('button', { name: '下载试卷', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await dialog.getByRole('radio', { name: '教师版' }).click()
    const link = dialog.locator('.dl-no').first()
    await link.waitFor()
    const no = (await link.innerText()).trim()
    console.log(`    弹窗里第一个可点的题号：${no}`)
    await link.click()
    await dialog.waitFor({ state: 'detached' })
    const target = Number.parseInt(no, 10)
    await page.waitForFunction(() => document.querySelector('.is-flash')?.getAttribute('data-item-id'))
    const flashed = await page.locator('.is-flash').first().getAttribute('data-item-id')
    const firstNo = await page.locator(`[data-item-id="${flashed}"] [data-testid="item-no"]`).innerText()
    assert.ok(Number.parseInt(firstNo, 10) <= target, `闪动的题（${firstNo}）包含第 ${target} 题`)
    assert.ok(await inDeskView(page, page.locator(`[data-item-id="${flashed}"]`)))
  })

  // ================= 空库 =================
  await step('N 题库一道题都没有时，编辑器题库栏写明原因并给「去采集」按钮', async () => {
    await call(page, async (wb) => {
      for (const q of (await wb.library.listQuestions({ limit: 200 })).items) await wb.library.deleteQuestion(q.id)
    })
    const id = (await page.evaluate(() => window.workbench.papers.create('空库测试卷'))) as number
    await openEditor(page, id)
    await page.getByText('试题库里还没有题目').waitFor()
    await shot(page, '07-空库')
    // 只记录跳转请求，不真的进入采集页（采集页会加载组卷网）
    await page.evaluate(() => {
      const w = window as unknown as { __nav: unknown[] }
      w.__nav = []
      window.addEventListener(
        'ewb-navigate',
        (e) => {
          w.__nav.push((e as CustomEvent).detail)
          e.stopImmediatePropagation()
        },
        true
      )
    })
    await page.getByRole('button', { name: '去采集' }).click()
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __nav: unknown[] }).__nav), [{ page: 'collect' }])
  })

  await step('整个过程没有未处理的界面错误', async () => {
    assert.deepEqual(errors.filter((e) => !/Autofill|favicon/i.test(e)), [])
  })

  console.log(`编辑器操作端到端测试通过：${passed} 项，截图在 ${evidence}`)
} catch (error) {
  await shot(page, '99-失败现场').catch(() => undefined)
  console.error(`失败现场截图：${join(evidence, '99-失败现场.png')}`)
  throw error
} finally {
  await launched.app.close().catch(() => undefined)
}
