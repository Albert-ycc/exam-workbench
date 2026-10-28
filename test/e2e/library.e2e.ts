// 入库与试题库端到端测试：粘贴链接 → 预览 → 确认 → 试题库筛选 / 展开答案 / 删除 → 同一链接再入全部跳过 → 整页入库
// 用法：node test/e2e/library.e2e.ts [证据目录] [--online]（也可设环境变量 EWB_LIBRARY_ONLINE=1 代替 --online）
//   离线（默认）：拦截内置浏览器会话的 https 请求，用本地样本页代替组卷网，不产生任何外网访问；
//                    另外覆盖验证页暂停与取消、答案图片、无效链接
//   --online：真实打开组卷网的试卷页与单题页，共 4 次页面加载（入库 2 次、再入一次 2 次）
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { skipWithoutFixtures } from '../../scripts/fixtures.ts'
import { evidenceDir } from '../../scripts/temp-dir.ts'
import { installIntercept, PAPER_URL, QUESTION_URL, VERIFY_FOREVER_URL, VERIFY_URL } from './library-intercept.e2e.ts'

const mode = process.argv.includes('--online') || process.env.EWB_LIBRARY_ONLINE === '1' ? 'online' : 'offline'
const evidence = evidenceDir(process.argv.slice(2).find((a) => !a.startsWith('--')), 'ewb-library-e2e-')
if (mode === 'offline') {
  skipWithoutFixtures('入库与试题库端到端（离线模式）')
  process.env.EWB_IMPORT_GAP_MS = '300'
}
buildTo('out-lib3')
// 离线模式：域名解析全部屏蔽，采集页在拦截生效前发出的请求也出不了网；online 模式才真正访问组卷网
const { app, window, dataDir } = await launchApp({ outDir: 'out-lib3', online: mode === 'online' })
const shot = (name: string): Promise<Buffer> => window.screenshot({ path: join(evidence, `${mode}-${name}.png`) })
let step = 0
const log = (text: string): void => console.log(`  ✓ ${++step}. ${text}`)

const nav = (label: string) => window.getByRole('button', { name: label, exact: true })
const button = (label: string) => window.getByRole('button', { name: label, exact: true })
const total = async (): Promise<number> => (await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1 }))).total
const libraryTotal = async (): Promise<string> => (await window.getByTestId('library-total').innerText()).trim()
const summary = async (): Promise<string> => {
  const el = window.getByTestId('import-summary')
  await el.waitFor({ timeout: 120_000 })
  return (await el.innerText()).replace(/\s+/g, '')
}
const result = async (): Promise<string> => {
  const el = window.getByTestId('import-result')
  await el.waitFor({ timeout: 30_000 })
  return (await el.innerText()).replace(/\s+/g, '')
}

async function startPaste(urls: string[]): Promise<void> {
  await nav('采集').click()
  const open = button('粘贴链接入库')
  if (await open.isEnabled()) await open.click()
  await window.locator('.import-textarea').fill(urls.join('\n'))
  await button('开始入库').click()
}

async function libraryChecks(): Promise<void> {
  await nav('试题库').click()
  await window.getByTestId('question-card').first().waitFor()
  assert.equal(await libraryTotal(), '共 23 道题')
  await shot('library-all')
  // 题型筛选：大类含子类，题型按钮上带题数
  const typeButton = (name: string, count: number) => window.locator('.lb-types').getByRole('button', { name: new RegExp(`^${name}\\s*${count}$`) })
  await typeButton('解答题', 8).click()
  await window.getByText('筛出 8 道，全库 23 道').waitFor()
  await typeButton('计算题', 2).click()
  await window.getByText('筛出 2 道，全库 23 道').waitFor()
  await shot('library-filter-type')
  log('试题库：题型筛选（解答题 8 道，其中计算题 2 道），题型按钮带题数')
  await window.locator('.lb-types').getByRole('button', { name: /^全部题型\s*23$/ }).click()
  await window.getByText('共 23 道题').waitFor()
  await typeButton('单选题', 10).click()
  await window.getByText('筛出 10 道，全库 23 道').waitFor()
  await window.locator('.lb-types').getByRole('button', { name: /^全部题型\s*23$/ }).click()
  // 来源卷筛选
  const options = await window.locator('.lb-filter select option').allInnerTexts()
  assert.equal(options.length, 2, `来源卷下拉：${options.join(' | ')}`)
  assert.match(options[1], /数学试题（23 题）/)
  await window.locator('.lb-filter select').selectOption({ index: 1 })
  await window.getByText('筛出 23 道，全库 23 道').waitFor()
  log('试题库：来源卷筛选（1 份来源卷，23 题）')
  // 关键词只匹配文字
  await window.getByPlaceholder('题干中的文字').fill('倒数')
  const kw = await window.evaluate(() => window.workbench.library.listQuestions({ keyword: '倒数', limit: 1000 }))
  assert.ok(kw.total > 0 && kw.total < 23)
  await window.getByText(`筛出 ${kw.total} 道，全库 23 道`).waitFor()
  assert.equal(await window.getByTestId('question-card').count(), kw.total)
  await shot('library-filter-keyword')
  await window.getByPlaceholder('题干中的文字').fill('data-role')
  await window.getByText('没有符合条件的题目').waitFor()
  assert.match(await window.locator('.lb-empty').innerText(), /关键词「data-role」/)
  log(`试题库：关键词筛选（「倒数」${kw.total} 道，「data-role」不命中标签属性，空结果写出当前条件）`)
  await window.locator('.lb-empty').getByRole('button', { name: '清除筛选', exact: true }).click()
  await window.getByText('共 23 道题').waitFor()
  // 入库时读到的难度与知识点：显示在题目行，左栏难度、知识点筛选有题数（归类筛选的细节在 library-classify.e2e.ts）
  const withMeta = await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1000 }))
  const withDifficulty = withMeta.items.filter((q) => q.difficulty !== null).length
  assert.ok(withDifficulty > 0 && withMeta.items.some((q) => q.knowledge.length > 0), '入库应读到难度与知识点')
  assert.equal(await window.getByTestId('meta-difficulty').count(), Math.min(30, withMeta.items.slice(0, 30).filter((q) => q.difficulty !== null).length))
  assert.ok((await window.locator('.lb-filter .cf-chips--tiles .cf-chip').count()) > 0)
  assert.ok((await window.locator('.lb-filter section', { hasText: '知识点' }).locator('.cf-row').count()) > 0)
  log(`试题库：入库读到的难度（${withDifficulty} 道）与知识点显示在题目行与左栏筛选里`)
}

async function answerCheck(): Promise<void> {
  const card = window.getByTestId('question-card').filter({ has: window.locator('.ui-tag--ok') }).first()
  await card.waitFor()
  await card.getByRole('button', { name: '查看答案', exact: true }).click()
  const img = card.locator('.lb-answer img').first()
  await img.waitFor()
  const width = await img.evaluate((el: HTMLImageElement) => new Promise<number>((done) => (el.complete ? done(el.naturalWidth) : el.addEventListener('load', () => done(el.naturalWidth)))))
  assert.ok(width > 0, '答案图片应能通过本地协议显示')
  await shot('library-answer')
  await card.getByRole('button', { name: '收起答案', exact: true }).click()
  log('试题库：有答案的题可展开答案，答案图片从数据目录显示')
}

async function deleteCheck(): Promise<void> {
  await nav('试题库').click()
  await window.getByTestId('question-card').first().waitFor()
  const first = window.getByTestId('question-card').first()
  await first.getByRole('button', { name: '删除', exact: true }).click()
  await shot('library-delete-confirm')
  await first.getByRole('button', { name: '取消', exact: true }).click() // 先点取消：题目还在
  assert.equal(await total(), 23)
  await first.getByRole('button', { name: '删除', exact: true }).click()
  await first.getByRole('button', { name: '确认删除', exact: true }).click()
  await window.getByText('共 22 道题').waitFor()
  assert.equal(await total(), 22)
  log('试题库：删除需要二次确认，取消后题目仍在，确认后 23 → 22')
}

try {
  await nav('采集').waitFor()
  if (mode === 'offline') {
    await installIntercept(app)
    await window.waitForTimeout(500)

    // 1. 无效链接
    await nav('采集').click()
    await button('粘贴链接入库').click()
    await window.locator('.import-textarea').fill('https://example.com/2p3543573.html')
    await window.getByRole('alert').waitFor()
    assert.match(await window.getByRole('alert').innerText(), /不是组卷网的试卷页或试题页链接/)
    assert.equal(await button('开始入库').isDisabled(), true)
    await shot('paste-invalid')
    log('粘贴框拒绝非组卷网链接，开始入库不可用')

    // 2. 验证页暂停 → 用户处理后自动继续
    await window.locator('.import-textarea').fill(VERIFY_URL)
    await button('开始入库').click()
    await window.getByTestId('import-waiting').waitFor({ timeout: 30_000 })
    assert.match(await window.getByTestId('import-waiting').innerText(), /安全验证/)
    await shot('waiting-verification')
    await app.evaluate(() => {
      ;(globalThis as unknown as { __ewb: { verify: Set<string> } }).__ewb.verify.delete('/2p1111111.html')
    })
    await window.evaluate(() => window.workbench.browser.reload()) // 用户通过验证后页面刷新
    assert.equal(await summary(), '拆出20道、带答案0道、已在库0道（入库时跳过）')
    await shot('preview-english')
    await button('取消').click()
    await window.locator('.import-panel').waitFor({ state: 'detached' })
    assert.equal(await total(), 0)
    log('验证页：暂停并提示，处理后自动继续，预览拆出 20 道；取消预览后库里仍为 0')

    // 3. 等待验证时取消
    await button('粘贴链接入库').click()
    await window.locator('.import-textarea').fill(VERIFY_FOREVER_URL)
    await button('开始入库').click()
    await window.getByTestId('import-waiting').waitFor({ timeout: 30_000 })
    await button('取消').click()
    await window.locator('.import-panel').waitFor({ state: 'detached' })
    await window.waitForTimeout(2500)
    assert.equal(await window.getByTestId('import-waiting').count(), 0)
    assert.equal(await button('整页入库').count(), 1)
    log('等待验证时取消：面板收起，任务不再继续')

    // 4. 页面标明的题数与拆出的不一致
    await button('粘贴链接入库').click()
    await window.locator('.import-textarea').fill('https://zujuan.xkw.com/2p3333333.html')
    await button('开始入库').click()
    assert.match(await summary(), /拆出20道.*1条链接的拆出题数与页面标明的不一致/)
    assert.match(await window.locator('.import-callout[role="alert"]').innerText(), /页面标明共 30 题，拆出 20 道/)
    await shot('preview-count-mismatch')
    await button('取消').click()
    await window.locator('.import-panel').waitFor({ state: 'detached' })
    log('页面标明题数与拆出题数不一致时，预览提示核对')
  }

  // 单题页 + 试卷页一起入库（试卷里含单题页的那道题，应只入一次）
  const urls = mode === 'online' ? [PAPER_URL, QUESTION_URL] : [QUESTION_URL, PAPER_URL]
  await startPaste(urls)
  const sum1 = await summary()
  assert.equal(sum1.startsWith('拆出24道、带答案' + (mode === 'offline' ? '1' : '0') + '道、已在库1道（入库时跳过）'), true, sum1)
  await shot('preview')
  assert.equal(await window.locator('.import-questions li.dup').count(), 1)
  await button('确认入库').click()
  assert.equal(await result(), '新增23道，跳过1道（已在库）')
  await shot('done')
  await button('关闭').click()
  assert.equal(await total(), 23)
  log(`预览「${sum1}」→ 确认入库：新增 23 道，跳过 1 道`)

  await libraryChecks()
  if (mode === 'offline') await answerCheck()

  // 同一链接再入一次：全部跳过（online 只再入试卷链接，控制对组卷网的访问次数）
  const again = mode === 'online' ? [PAPER_URL] : urls
  await startPaste(again)
  const sum2 = await summary()
  assert.equal(sum2, `拆出${again.length === 2 ? 24 : 23}道、带答案${mode === 'offline' ? '1' : '0'}道、已在库${again.length === 2 ? 24 : 23}道（入库时跳过）`, sum2)
  await shot('preview-again')
  // S18：拆出的题全部已在库，没有新题可入，「确认入库」不可用并说明原因
  assert.equal(await button('确认入库').isDisabled(), true)
  assert.match(await window.getByTestId('import-nothing-new').innerText(), /没有可入库的新题/)
  await shot('preview-nothing-new')
  await button('取消').click()
  await window.locator('.import-panel').waitFor({ state: 'detached' })
  assert.equal(await total(), 23)
  log(`同一链接再入一次：${sum2}，确认入库置灰并说明「没有可入库的新题」，库内仍为 23 道`)

  await deleteCheck()

  // 整页入库：内置浏览器当前页是试卷页，库里缺的那 1 道补回来
  await nav('采集').click()
  if (mode === 'offline') {
    await window.evaluate(() => window.workbench.browser.navigate('https://zujuan.xkw.com/'))
    await window.waitForTimeout(1500)
    assert.equal(await button('整页入库').isDisabled(), true, '非试卷页不能整页入库')
    await window.evaluate((url) => window.workbench.browser.navigate(url), PAPER_URL)
  }
  await window.waitForFunction(() => !(document.querySelector('.toolbar-actions .ui-btn--primary') as HTMLButtonElement).disabled, null, { timeout: 60_000 })
  await shot('current-page-enabled')
  await button('整页入库').click()
  const sum3 = await summary()
  assert.match(sum3, /^拆出23道、带答案[01]道、已在库22道（入库时跳过）$/, sum3)
  await button('确认入库').click()
  assert.equal(await result(), '新增1道，跳过22道（已在库）')
  await button('关闭').click()
  assert.equal(await total(), 23)
  log('整页入库：试卷页拆出 23 道，补回删掉的 1 道' + (mode === 'offline' ? '；非试卷页按钮不可用' : ''))

  if (mode === 'offline') {
    const served = await app.evaluate(() => (globalThis as unknown as { __ewb: { served: string[] } }).__ewb.served)
    const pageLoads = served.filter((u) => /zujuan\.xkw\.com\/\d+[pq]\d+\.html/.test(u))
    console.log(`  拦截日志：试卷/单题页请求 ${pageLoads.length} 次，图片请求 ${served.filter((u) => /\.png/.test(u)).length} 次`)
  }
  await nav('试题库').click()
  await window.getByTestId('question-card').first().waitFor()
  await shot('library-final')
  console.log(`端到端测试（${mode}）通过：${step} 项，证据在 ${evidence}，数据目录 ${dataDir}`)
} catch (error) {
  await window.screenshot({ path: join(evidence, `${mode}-failure.png`) }).catch(() => undefined)
  throw error
} finally {
  await app.close()
}

