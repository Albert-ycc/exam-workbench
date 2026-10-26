// 评审返工的回归用例：过期提示条不会把题插成两份（B01）、编辑器卸载不误关别页的撤销提示条（G2）、标题长度上限、版本预览版式、
// 题号方格不串列、提示条与闪烁用色、分值表用词、窄窗口标签与表格横向滚动、键盘 Tab 顺序、插入位置红字不压旁注栏、
// 悬停竖条、题库栏琥珀通栏提示、下载记录用词、分值下限 0.5、1000×640 顶栏。
// 用法：node test/e2e/editor-review.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { openDatabase } from '../../src/main/db.ts'
import { recordExport } from '../../src/main/papers/repo.ts'
import { center, dragBetween, itemNos, itemOf, makeItem, makeTempDirs, openEditor, saved, sectionAt, seedPaper, structureDraft, watchErrors } from './editor-support.e2e.ts'

const dirs = makeTempDirs('review')
const evidence = process.argv[2] ?? dirs.evidence
mkdirSync(evidence, { recursive: true })
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(evidence, `${name}.png`) })

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// 三道没有答案的单选题，题库栏才会出现「都没有答案」的提示
{
  mkdirSync(join(dirs.dataDir, 'assets'), { recursive: true })
  const db = openDatabase(dirs.dataDir)
  const now = new Date().toISOString()
  const paperId = Number(db.prepare('INSERT INTO source_papers (url, title, fetched_at) VALUES (?, ?, ?)').run('https://zujuan.xkw.com/2p1.html', '评审用来源卷', now).lastInsertRowid)
  const insert = db.prepare(
    `INSERT INTO questions (zujuan_qid, source_paper_id, source_label, source_order, question_type, number_count, stem_html, answer_html, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (let i = 0; i < 3; i++) insert.run(`93000${i}`, paperId, '评审来源', i, '单选题', 1, `<p>评审用单选题第 ${i + 1} 号（　）</p>`, null, `review-${i}`, now)
  db.close()
}

buildTo('out-editor4')
const launched = await launchApp({ outDir: 'out-editor4', dataDir: dirs.dataDir, userDataDir: dirs.userDataDir })
const page = launched.window
const errors: string[] = []
watchErrors(page, errors)
await page.setViewportSize({ width: 1440, height: 900 })

const toastWith = (text: string | RegExp): Locator => page.getByTestId('toast').filter({ hasText: text })
const itemIds = (): Promise<string[]> => page.getByTestId('paper-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id') ?? ''))
const getDraft = (id: number) => page.evaluate((pid) => window.workbench.papers.get(pid).then((d) => d.draft), id)
const blurInputs = async (): Promise<void> => {
  await page.locator('.ed-sheet-title').click()
}
const css = (locator: Locator, prop: string): Promise<string> => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
const unique = (ids: string[]): boolean => new Set(ids).size === ids.length

try {
  // ================= B01 / G2 =================
  await step('B01 删题后顶栏撤销、Ctrl+Z、重做、恢复版本：「已删除 · 撤销」提示条随之关掉，题数与 id 保持唯一', async () => {
    const id = await seedPaper(page, '过期提示测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    assert.equal((await itemIds()).length, 10)

    // 顶栏撤销
    await itemOf(page, 'a2').getByRole('button', { name: /删除第 2 题/ }).click()
    await toastWith(/已删除第 2 题/).waitFor()
    assert.equal((await itemIds()).length, 9)
    await page.getByTestId('undo').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 10)
    assert.equal(await toastWith(/已删除第 2 题/).count(), 0, '撤销之后「已删除 · 撤销」提示条已关掉，没有可点的过期按钮')
    assert.ok(unique(await itemIds()), '题目 id 唯一')

    // Ctrl+Z
    await itemOf(page, 'a3').getByRole('button', { name: /删除第 3 题/ }).click()
    await toastWith(/已删除第 3 题/).waitFor()
    await blurInputs()
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 10)
    assert.equal(await toastWith(/已删除第/).count(), 0)

    // 重做（又把这道题删掉）：此前那条提示条同样不再出现
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 9)
    assert.equal(await toastWith(/已删除第/).count(), 0)
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 10)

    // 连删两题合并成「撤销全部」，顶栏撤销一次后这条提示条也关掉
    await itemOf(page, 'a1').getByRole('button', { name: /删除第 1 题/ }).click()
    await itemOf(page, 'a4').getByRole('button', { name: /删除第 3 题/ }).click()
    await toastWith('已删除 2 题').waitFor()
    await page.getByTestId('undo').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 9)
    assert.equal(await toastWith(/已删除/).count(), 0)
    await page.getByTestId('undo').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 10)

    // 恢复版本
    await page.evaluate((pid) => window.workbench.papers.saveVersion(pid, '基线'), id)
    await itemOf(page, 'a4').getByRole('button', { name: /删除第 4 题/ }).click()
    await toastWith(/已删除第 4 题/).waitFor()
    await saved(page)
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    await page.getByTestId('version-item').first().getByRole('button', { name: '恢复' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^恢复到 v/ }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await toastWith(/已删除第 4 题/).count(), 0, '恢复版本后，旧的删除提示条关掉')
    assert.equal((await itemIds()).length, 10)
    assert.ok(unique(await itemIds()))
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
    await saved(page)
    const draft = await getDraft(id)
    const all = draft.sections.flatMap((s) => s.items.map((i) => i.id))
    assert.equal(all.length, 10)
    assert.ok(unique(all), '落库的草稿里题目 id 也唯一')
  })

  await step('G2 在试卷库删除试卷后打开另一份再返回：8 秒撤销提示条还在，点撤销试卷回来、没有被删', async () => {
    const a = await seedPaper(page, 'A卷待删', { sections: [{ id: 'x', title: '选择题', items: [makeItem('x1', '甲')] }] })
    await seedPaper(page, 'B卷打开', { sections: [{ id: 'y', title: '选择题', items: [makeItem('y1', '乙')] }] })
    await page.locator('.bar-back').click()
    await page.getByRole('heading', { name: '试卷库' }).waitFor()
    await page.getByRole('button', { name: '「A卷待删」的更多操作' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    const toast = toastWith('已删除「A卷待删」')
    await toast.waitFor()
    await page.getByTestId('paper-row').filter({ hasText: 'B卷打开' }).getByRole('button', { name: '打开', exact: true }).click()
    await page.getByLabel('试卷标题').waitFor()
    await page.waitForFunction(() => (document.querySelector('input[aria-label="试卷标题"]') as HTMLInputElement)?.value === 'B卷打开')
    await page.getByTestId('paper-item').first().waitFor()
    await page.locator('.bar-back').click()
    await page.getByRole('heading', { name: '试卷库' }).waitFor()
    assert.equal(await toast.count(), 1, '编辑器卸载没有把试卷库的撤销提示条一起关掉')
    await toast.getByRole('button', { name: '撤销' }).click()
    await page.getByTestId('paper-row').filter({ hasText: 'A卷待删' }).waitFor()
    await page.waitForTimeout(600)
    const list = await page.evaluate(() => window.workbench.papers.list())
    assert.ok(list.some((p) => p.id === a), '试卷没有被删')
  })

  // ================= G3 =================
  await step('G3 编辑器标题输入框限 100 字，与保存、导出一致', async () => {
    const id = await seedPaper(page, '标题上限测试卷', structureDraft())
    await openEditor(page, id)
    assert.equal(await page.getByLabel('试卷标题').getAttribute('maxlength'), '100')
    await page.getByLabel('试卷标题').fill('')
    await page.keyboard.insertText('长'.repeat(150))
    assert.equal((await page.getByLabel('试卷标题').inputValue()).length, 100, '输入超过 100 字时被截住')
    await page.getByLabel('试卷标题').fill('标题上限测试卷')
  })

  // ================= 版本预览版式 =================
  await step('M3/G4 版本只读预览与编辑器卷面同一版式：拖动柄栏、正文、旁注栏三栏，纸面有边距', async () => {
    const id = await seedPaper(page, '预览版式测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    await page.evaluate((pid) => window.workbench.papers.saveVersion(pid, '预览用'), id)
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    await page.getByTestId('version-item').first().getByRole('button', { name: '查看' }).click()
    const sheet = page.getByTestId('preview-sheet')
    await sheet.waitFor()
    const geometry = await sheet.evaluate((el) => {
      const item = el.querySelector('.ed-item') as HTMLElement
      const main = item.querySelector('.ed-item-main') as HTMLElement
      const note = item.querySelector('.ed-note') as HTMLElement
      const r = (e: Element) => e.getBoundingClientRect()
      return { tracks: getComputedStyle(item).gridTemplateColumns.split(' ').length, sheetLeft: r(el).left, mainLeft: r(main).left, mainWidth: r(main).width, mainRight: r(main).right, noteLeft: r(note).left }
    })
    assert.equal(geometry.tracks, 3)
    assert.ok(geometry.mainLeft - geometry.sheetLeft >= 50, `正文离纸边应有拖动柄那一栏的距离：${geometry.mainLeft - geometry.sheetLeft}`)
    assert.ok(geometry.mainWidth >= 300)
    assert.ok(geometry.noteLeft >= geometry.mainRight - 1, '旁注栏在正文右边，不压在正文上')
    await shot(page, '01-版本预览-1440x900')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click()
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
  })

  // ================= 题号方格 =================
  await step('M1 题号方格一个大题超过 5 题时，号码换行后仍在号码列，不掉进大题序号列', async () => {
    const id = await seedPaper(page, '方格测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const rects = await page.getByTestId('grid-cell').evaluateAll((els) => els.map((e) => ({ no: Number(e.getAttribute('data-no')), x: e.getBoundingClientRect().left, y: e.getBoundingClientRect().top })))
    const label = await page.locator('.ed-grid-sec').first().evaluate((e) => ({ right: e.getBoundingClientRect().right, h: e.getBoundingClientRect().height }))
    for (const r of rects) assert.ok(r.x >= label.right - 1, `第 ${r.no} 题的方格落进了大题序号列`)
    const at = (no: number) => rects.find((r) => r.no === no)!
    assert.equal(Math.round(at(5).x), Math.round(at(10).x), '第 10 题与第 5 题同一列')
    assert.equal(Math.round(at(5).x), Math.round(at(15).x))
    assert.ok(at(10).y > at(5).y)
    const sec = await page.locator('.ed-grid-sec').nth(1).evaluate((e) => e.getBoundingClientRect().height)
    assert.ok(sec >= 85, `完形填空 15 个号码 3 行，大题序号格跨满 3 行：${sec}`)
    void label.h
    await shot(page, '02-题号方格-1440x900')
  })

  await step('S1 结构栏「还差 N 分」用琥珀色；S2 点题号后的闪烁是浅蓝不是黄', async () => {
    await page.getByLabel('目标满分', { exact: true }).fill('100')
    const note = page.getByTestId('target-note')
    await note.waitFor()
    assert.equal(await css(note, 'color'), 'rgb(138, 90, 0)', '琥珀色，与下载弹窗一致')
    await page.locator('[data-testid="grid-cell"][data-no="1"]').click()
    const bg = await itemOf(page, 'a1').evaluate((el) => getComputedStyle(el).backgroundColor)
    const [r, , b] = (bg.match(/\d+/g) ?? []).map(Number)
    assert.ok(b > r + 15, `闪烁底色应偏蓝：${bg}`)
  })

  // ================= 分值表用词 =================
  await step('S7 分值表题干里的公式写「[公式]」；「统一」改成「全部跟随大题」', async () => {
    const id = await seedPaper(page, '分值表测试卷', {
      sections: [
        {
          id: 's1',
          title: '解答题',
          defaultScore: 8,
          items: [makeItem('f1', '已知<img src="ewb-asset://0000000000000000000000000000000000000000000000000000000000000000.svg" width="20" height="14">，求值'), makeItem('f2', '丙', { score: 10 })]
        }
      ]
    })
    await openEditor(page, id)
    await page.getByRole('radio', { name: '分值表' }).click()
    const table = page.getByTestId('score-table')
    assert.match(await table.locator('.ed-scoretab-row').first().innerText(), /\[公式\]/)
    assert.doesNotMatch(await table.innerText(), /□/)
    await table.getByRole('button', { name: '全部跟随大题（1 题单独设分）' }).waitFor()
    assert.equal(await table.getByRole('button', { name: /^统一/ }).count(), 0)
    await page.getByRole('radio', { name: '结构', exact: true }).click()
  })

  // ================= 分值下限 =================
  await step('G1 分值输入框下限 0.5：输入 0 不接受，0.5 可以，清空仍是未设', async () => {
    const id = await seedPaper(page, '分值下限测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const head = page.getByLabel('一、选择题每小题分值', { exact: true })
    assert.equal(await head.getAttribute('aria-valuemin'), '0.5')
    await head.fill('0')
    assert.equal(await head.getAttribute('aria-invalid'), 'true', '0 低于下限，输入框标红')
    assert.equal(await sectionAt(page, 0).getByTestId('section-note').innerText(), '（共 4 小题，每小题 4 分，共 16 分）', '不合法的值不写进草稿')
    await head.fill('0.5')
    assert.equal(await sectionAt(page, 0).getByTestId('section-note').innerText(), '（共 4 小题，每小题 0.5 分，共 2 分）')
    await head.fill('')
    assert.equal(await sectionAt(page, 0).getByTestId('section-note').innerText(), '（共 4 小题）')
    await itemOf(page, 'a1').getByTestId('score-chip').click()
    assert.equal(await itemOf(page, 'a1').getByLabel(/分值/).getAttribute('aria-valuemin'), '0.5')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByLabel('目标满分', { exact: true }).getAttribute('aria-valuemin'), '0.5')
  })

  // ================= 悬停、题库栏提示 =================
  await step('S12 卷面题悬停：左边蓝黑竖条加浅灰底，与题库行一致', async () => {
    await blurInputs()
    const target = itemOf(page, 'a3')
    await target.hover({ position: { x: 300, y: 10 } })
    await page.waitForTimeout(150)
    assert.equal(await target.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(246, 246, 243)')
    assert.match(await target.evaluate((el) => getComputedStyle(el).boxShadow), /rgb\(31, 58, 104\)/)
    await shot(page, '03-卷面题悬停')
  })

  await step('S8 题库栏「当前列表的题目都没有答案」用全局琥珀通栏提示', async () => {
    const notice = page.locator('.ed-lib-inner > .notice')
    await notice.waitFor()
    assert.match(await notice.innerText(), /当前列表的题目都没有答案/)
    assert.equal(await css(notice, 'background-color'), 'rgb(251, 241, 219)')
    assert.equal(await css(notice, 'color'), 'rgb(138, 90, 0)')
  })

  // ================= 拖动 =================
  await step('S11 拖动时红色「插入为第 N 题」单独占一行，不压在上一题旁注栏的链接和分值上；松手后落点与红线一致', async () => {
    const id = await seedPaper(page, '拖动红字测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const from = await center(itemOf(page, 'a1').getByRole('button', { name: /拖动第/ }))
    const to = await center(itemOf(page, 'a3'))
    await dragBetween(page, from, { x: to.x, y: to.y + 40 }, async () => {
      const hint = page.locator('.ed-drop-hint')
      await hint.waitFor()
      const box = (await hint.boundingBox())!
      const others = await page.locator('.ed-note .ed-note-link, .ed-note .ed-score, .ed-note .ed-note-src, .ed-note .ui-tag').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return { x: r.left, y: r.top, w: r.width, h: r.height, text: (e.textContent ?? '').trim() }
        })
      )
      const hit = others.filter((o) => o.w > 0 && o.x < box.x + box.width && o.x + o.w > box.x && o.y < box.y + box.height && o.y + o.h > box.y)
      assert.deepEqual(hit, [], '红字不应与旁注栏的文字重叠')
      await shot(page, '04-拖动插入位置-1440x900')
    })
    await saved(page)
    const draft = await getDraft(id)
    assert.deepEqual(draft.sections[0].items.map((i) => i.id), ['a2', 'a3', 'a1', 'a4'], '松手后放在红线所在位置（第 3 题）')
  })

  // ================= 键盘 =================
  await step('S10 键盘 Tab：拖动手柄不是停靠点；题库栏收起后里面的控件不进 Tab 顺序', async () => {
    assert.equal(await itemOf(page, 'a1').getByRole('button', { name: /拖动第/ }).getAttribute('tabindex'), '-1')
    await page.getByRole('button', { name: '收起试题库' }).click()
    assert.equal(await page.locator('.ed-lib-inner').evaluate((el) => (el as HTMLElement).inert), true)
    await page.getByLabel('试卷标题').focus()
    const visited: string[] = []
    for (let k = 0; k < 40; k++) {
      await page.keyboard.press('Tab')
      visited.push(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null
          if (!a || a === document.body) return 'body'
          if (a.closest('.ed-lib-inner')) return 'IN-LIB'
          if (a.classList.contains('ed-grip')) return 'GRIP'
          return 'ok'
        })
      )
    }
    assert.ok(!visited.includes('IN-LIB'), '收起的题库栏里的控件进了 Tab 顺序')
    assert.ok(!visited.includes('GRIP'), '拖动手柄进了 Tab 顺序')
    await page.getByRole('button', { name: '展开试题库' }).click()
  })

  // ================= 下载记录用词 =================
  await step('S4 版本历史里的下载记录用下载弹窗的词：学生版 / 教师版、来源、作答区域；答题卡写自己的配置', async () => {
    const id = await seedPaper(page, '记录用词测试卷', structureDraft())
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    const version = await page.evaluate((pid) => window.workbench.papers.saveVersion(pid, '有下载'), id)
    const db = openDatabase(dirs.dataDir)
    const base = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false } as const
    recordExport(db, version.id, 'pdf', base, join(dirs.dataDir, '学生版.pdf'))
    recordExport(db, version.id, 'docx', { answerPosition: 'end', sourcePosition: 'before-stem', format: 'docx', answerArea: true }, join(dirs.dataDir, '教师版.docx'))
    recordExport(db, version.id, 'pdf', { answerPosition: 'after', sourcePosition: 'answer', format: 'pdf', answerArea: false }, join(dirs.dataDir, '教师版题后.pdf'))
    recordExport(db, version.id, 'pdf', base, join(dirs.dataDir, '答题卡.pdf'), 'answer-sheet')
    db.close()
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    const records = page.getByTestId('export-record')
    await records.nth(3).waitFor()
    const texts = await records.allInnerTexts()
    const find = (name: string): string => texts.find((t) => t.includes(name))!
    assert.match(find('学生版.pdf'), /学生版/)
    assert.match(find('学生版.pdf'), /来源：不显示 · 作答区域：不留/)
    assert.match(find('教师版.docx'), /答案：卷尾 · 来源：题文前 · 作答区域：留作答区域/)
    assert.match(find('教师版题后.pdf'), /答案：题后 · 来源：答案处 · 作答区域：不留/)
    assert.match(find('答题卡.pdf'), /答题卡/)
    assert.match(find('答题卡.pdf'), /A4 答题卡/)
    assert.doesNotMatch(find('答题卡.pdf'), /来源|作答区域/)
    assert.equal(texts.filter((t) => /不显示 · 来源|作答区域不添加|答案卷尾/.test(t)).length, 0, '旧用词不再出现')
    await shot(page, '05-下载记录用词-1440x900')
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
  })

  // ================= 窄窗口 =================
  const wideTable = `<table data-role="bordered"><tbody><tr>${Array.from({ length: 30 }, (_, k) => `<td>第${k + 1}列的数据</td>`).join('')}</tr></tbody></table>`
  await step('S9 窄窗口：结构条标签保留题型名；卷面与版本预览里很宽的表格能横向滚动', async () => {
    const id = await seedPaper(page, '窄窗口测试卷', {
      sections: [
        { id: 's1', title: '选择题', defaultScore: 4, items: [makeItem('t1', '甲', { stemHtml: `<p>下表：</p>${wideTable}` }), makeItem('t2', '乙')] },
        { id: 's2', title: '填空题', defaultScore: 4, items: [makeItem('t3', '丙', { questionType: '填空题' })] }
      ]
    })
    await openEditor(page, id)
    await page.getByTestId('paper-item').first().waitFor()
    await page.setViewportSize({ width: 1100, height: 700 })
    await page.getByTestId('struct-chip').first().waitFor()
    const chips = await page.getByTestId('struct-chip').allInnerTexts()
    assert.ok(chips[0].includes('选择题') && chips[1].includes('填空题'), `窄窗口标签应保留题型名：${chips.join(' | ')}`)
    // 打开版本历史，卷面更窄
    await page.evaluate((pid) => window.workbench.papers.saveVersion(pid, '宽表'), id)
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    await page.getByTestId('version-item').first().waitFor()
    const scrollable = async (locator: Locator): Promise<{ overflow: boolean; moved: boolean }> =>
      locator.evaluate((el) => {
        const e = el as HTMLElement
        const overflow = e.scrollWidth > e.clientWidth + 2
        e.scrollLeft = 80
        return { overflow, moved: e.scrollLeft > 0 }
      })
    const stem = itemOf(page, 't1').locator('.ed-item-main .question-html').first()
    assert.deepEqual(await scrollable(stem), { overflow: true, moved: true }, '编辑器卷面里的宽表格可以横向滚动')
    await shot(page, '06-窄窗口-宽表格-1100x700')
    await page.getByTestId('version-item').first().getByRole('button', { name: '查看' }).click()
    await page.getByTestId('preview-sheet').waitFor()
    const previewStem = page.getByTestId('preview-sheet').locator('.ed-item-main .question-html').first()
    assert.deepEqual(await scrollable(previewStem), { overflow: true, moved: true }, '版本预览里的宽表格可以横向滚动')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click()
    await page.locator('.ui-drawer').getByRole('button', { name: '关闭' }).click()
  })

  await step('S16 窗口最小 1000×640：顶栏标题区不折行、不挤乱', async () => {
    await page.setViewportSize({ width: 1000, height: 640 })
    await page.waitForTimeout(250)
    const bar = await page.locator('.ed-bar').evaluate((el) => {
      const kids = [...el.children].map((c) => {
        const r = c.getBoundingClientRect()
        return { cls: (c as HTMLElement).className.toString().slice(0, 24), top: r.top, h: r.height, left: r.left, right: r.right, w: r.width }
      })
      return { h: el.getBoundingClientRect().height, scroll: el.scrollWidth - el.clientWidth, kids }
    })
    assert.equal(bar.h, 56, '顶栏高度不变')
    assert.ok(bar.scroll <= 1, `顶栏不应横向溢出：${bar.scroll}`)
    for (const k of bar.kids.filter((x) => x.w > 0)) assert.ok(k.h <= 40, `${k.cls} 高 ${k.h}，被挤成多行`)
    const title = await page.getByLabel('试卷标题').boundingBox()
    assert.ok(title && title.width >= 120, `标题框宽 ${title?.width}`)
    const status = (await page.locator('.ed-status').boundingBox())!
    assert.ok(status.height <= 36, `保存状态不折行：${status.height}`)
    await shot(page, '07-顶栏-1000x640')
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  await step('整个过程没有未处理的界面错误', async () => {
    assert.deepEqual(errors.filter((e) => !/Autofill|favicon|ERR_FILE_NOT_FOUND|Failed to load resource/i.test(e)), [])
  })

  console.log(`评审返工回归测试通过：${passed} 项，截图在 ${evidence}`)
} catch (error) {
  await shot(page, '99-失败现场').catch(() => undefined)
  console.error(`失败现场截图：${join(evidence, '99-失败现场.png')}`)
  throw error
} finally {
  await launched.app.close().catch(() => undefined)
}
void itemNos
