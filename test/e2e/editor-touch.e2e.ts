// 触屏操作：手指在试题库卡片上滑动要能滚动左栏，按住一会儿再移动才是拖拽；只有拖动手柄禁用浏览器的触摸滚动
// 用 CDP 的 Input.dispatchTouchEvent 注入真实触摸事件。用法：node test/e2e/editor-touch.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { evidenceDir, makeTempDir } from '../../scripts/temp-dir.ts'

const evidence = evidenceDir(process.argv[2], 'ewb-editor-touch-')
buildTo('out-editor4')
const dataDir = makeTempDir('ewb-editor-touch-data-')
const { questionIds } = seedDataDir(dataDir)
const { app, window: page } = await launchApp({ outDir: 'out-editor4', dataDir })

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

try {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.app-nav .nav-item', { hasText: '试卷库' }).click()
  await page.getByRole('button', { name: '新建试卷' }).first().click()
  await page.getByRole('dialog').getByRole('textbox').fill('触屏测试')
  await page.getByRole('button', { name: '创建并打开' }).click()
  await page.getByTestId('lib-card').first().waitFor()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const list = page.locator('.ed-lib-list')
  const card = page.locator(`[data-testid="lib-card"][data-question-id="${questionIds[4]}"]`)

  const swipeUp = async (): Promise<number> => {
    await list.evaluate((el) => (el.scrollTop = 0))
    const box = (await card.boundingBox())!
    const x = box.x + 150
    const y = box.y + 60
    await touch('touchStart', x, y)
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', x, y - i * 20)
      await page.waitForTimeout(16)
    }
    await touch('touchEnd')
    await page.waitForTimeout(400)
    return list.evaluate((el) => el.scrollTop)
  }

  await step('触摸样式：卡片可滚动（touch-action 不是 none），只有拖动手柄是 none', async () => {
    const cardAction = await card.evaluate((el) => getComputedStyle(el).touchAction)
    assert.notEqual(cardAction, 'none')
    // 手柄在试卷里才有，先放一道题进去
    await page.evaluate(async (qid) => {
      const q = (await window.workbench.library.getQuestion(qid))!
      const id = (await window.workbench.papers.list())[0].id
      await window.workbench.papers.saveDraft(id, { sections: [{ id: 's1', title: '单选', items: [{ id: 'i1', originQuestionId: q.id, sourceLabel: q.sourceLabel, questionType: q.questionType, numberCount: q.numberCount, stemHtml: q.stemHtml, answerHtml: q.answerHtml }] }] })
    }, questionIds[0])
    // 导航里的「试卷库」在有打开的试卷时回到编辑器，回列表要用编辑器里的返回按钮
    await page.locator('.bar-back').click()
    await page.getByTestId('paper-row').first().getByRole('button', { name: '打开', exact: true }).click()
    await page.getByTestId('paper-item').first().waitFor()
    const gripAction = await page.locator('.ed-grip').first().evaluate((el) => getComputedStyle(el).touchAction)
    assert.equal(gripAction, 'none')
  })

  await step('手指在题目卡片上向上滑动：左栏滚动，不触发拖拽', async () => {
    const before = await page.getByTestId('paper-item').count()
    const scrolled = await swipeUp()
    assert.ok(scrolled > 100, `左栏应随手指滚动，scrollTop=${scrolled}`)
    assert.equal(await page.getByTestId('paper-item').count(), before)
    console.log(`    滑动后左栏 scrollTop=${scrolled}`)
  })

  await step('对照：给卡片强加 touch-action:none 后同样的滑动滚不动（验证测试能抓到旧问题）', async () => {
    await page.addStyleTag({ content: '.ed-lib-row { touch-action: none !important }' })
    const scrolled = await swipeUp()
    assert.equal(scrolled, 0, `旧样式下滑动不应滚动，scrollTop=${scrolled}`)
    await page.evaluate(() => {
      document.querySelectorAll('style').forEach((s) => s.textContent?.includes('touch-action: none !important') && s.remove())
    })
    assert.ok((await swipeUp()) > 100, '移除后又能滚动')
  })

  await step('按住约 0.4 秒再移动：拖拽卡片到「新建大题」区，加入试卷', async () => {
    await list.evaluate((el) => (el.scrollTop = 0))
    const before = await page.getByTestId('paper-item').count()
    const box = (await card.boundingBox())!
    const zone = (await page.getByTestId('new-section-zone').boundingBox())!
    const sx = box.x + 150
    const sy = box.y + 40
    const tx = zone.x + zone.width / 2
    const ty = zone.y + zone.height / 2
    await touch('touchStart', sx, sy)
    await page.waitForTimeout(400)
    for (let i = 1; i <= 20; i++) {
      await touch('touchMove', sx + ((tx - sx) * i) / 20, sy + ((ty - sy) * i) / 20)
      await page.waitForTimeout(16)
    }
    await touch('touchEnd')
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="paper-item"]').length === n, before + 1)
    assert.equal(await list.evaluate((el) => el.scrollTop), 0, '长按拖拽时左栏不应滚动')
    await page.screenshot({ path: join(evidence, '触屏-长按拖拽后.png') })
  })

  console.log(`触屏测试通过：${passed} 项`)
} finally {
  await app.close()
}
