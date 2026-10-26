// 采集、试题库、试卷库、设置四个页面的端到端测试（方向 C）：
//   试卷库  S9 搜索、摘要「N 题 · M 分」（M1 按题号）、最新版本与「有改动未存为版本」（无版本的卷只写「未存为版本」，与编辑器同词）、按修改时间排序、继续上次编辑、
//           删除 8 秒内可撤销（先隐藏、到时才真删，等待删除的试卷不计入左栏份数）、另存为新试卷；第三轮的分类栏、标签条、勾选框的版面（分类与标签的行为在 papers-classify.e2e.ts）
//   试题库  S19 全库无答案只在顶部提示一次、S20 无结果写出条件并可清除、N4 短题不出「展开」、N8 关键词高亮、
//           N11 题型带题数按常用顺序、F11 加入试卷（最近 3 份 / 选择试卷…）与「已用于 N 份试卷」、筛选条件切页面后保留
//   设置    N6 版本号、默认下载位置（可更改并保存）、快捷键说明
//   入库    N7 空库「去采集」、S18 入库完成后「去试题库看本次入库」、没有新题时禁用确认、带答案 0 道的黄色提示
// 试题库、试卷库的数据：用本地样本页（test/fixtures 的数学卷 23 题、英语卷 20 题，共 43 道）经离线拦截入库，再用接口建 3 份试卷
// （「七年级数学英语综合测试」21 题含 15 空完形填空、「隔离A」「隔离B」）；入库部分同样用本地样本页代替组卷网，不访问外网。
// 用法：node test/e2e/pages.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { compareTypeNames, primaryQuestionType } from '../../src/shared/library.ts'
import { numberItems, numberLabel } from '../../src/shared/numbering.ts'
import { buildTo, launchApp, ROOT } from '../../scripts/e2e/app.ts'
import { ENGLISH_URL, installIntercept, PAPER_URL, QUESTION_URL } from './library-intercept.e2e.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-pages-'))
mkdirSync(evidence, { recursive: true })
// 各套端到端各用自己的构建目录；本套用 out-pages5，与其余各套的构建目录互不重叠
const OUT = 'out-pages5'
process.env.EWB_IMPORT_GAP_MS = '300' // 入库的页间间隔缩短，测试不必干等
buildTo(OUT)
// 用脚本路径启动时 Electron 在 main 目录里找 package.json，找不到就报 Electron 自己的版本号；
// 放一份与根目录一致的，设置页才读到应用的版本号（正式运行读的就是 package.json）
const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string }
writeFileSync(join(ROOT, `${OUT}/main/package.json`), JSON.stringify({ name: rootPackage.name, version: rootPackage.version, main: 'index.js' }))

let steps = 0
const ok = (name: string): void => {
  steps++
  console.log(`  ✓ ${steps}. ${name}`)
}

const resize = async (app: ElectronApplication, window: Page, width: number, height: number): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const)
  await window.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const)
}
const tab = (window: Page, label: string) => window.locator('.app-nav').getByRole('button', { name: label, exact: true })
const currentTab = (window: Page) => window.locator('.app-nav [aria-current="page"]')
const goTo = (window: Page, page: 'collect' | 'library' | 'papers' | 'settings', paperId?: number | null) =>
  window.evaluate(([p, id]) => window.dispatchEvent(new CustomEvent('ewb-navigate', { detail: { page: p, ...(id === undefined ? {} : { paperId: id }) } })), [page, paperId] as const)
const shot = (window: Page, name: string) => window.screenshot({ path: join(evidence, `${name}.png`) })
const paperRow = (window: Page, title: string) => window.getByTestId('paper-row').filter({ hasText: title })
const rowMenu = async (window: Page, title: string, item: string): Promise<void> => {
  await paperRow(window, title).getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: item, exact: true }).click()
}
// 轮询直到条件成立（page.waitForFunction 不等待异步函数的结果，这里在测试进程里轮询）
const until = async (condition: () => Promise<boolean>, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`等待条件超时（${timeoutMs}ms）：${condition}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
const totalText = async (window: Page): Promise<string> => (await window.getByTestId('library-total').innerText()).trim()

// ======================================================================
// 第一部分：样本页入库的数据（试卷库、试题库、设置）
// ======================================================================
const TOTAL = 43 // 数学卷 23 题 + 英语卷 20 题
const COMPOSITE = '七年级数学英语综合测试'
const real = await launchApp({ outDir: OUT })
const { app, window } = real

interface Q {
  id: number
  questionType: string
  numberCount: number
  stemHtml: string
  sourceLabel: string
  answerHtml: string | null
}

try {
  await resize(app, window, 1440, 900)

  // ---------------------------------------------------------------- 造数据：样本页入库 + 接口建三份试卷
  await installIntercept(app)
  // 样本里数学卷第二题带一张答案图，这里去掉：S19 要的是「全库都没有答案」
  await app.evaluate(() => {
    const state = (globalThis as unknown as { __ewb: { pages: Record<string, string> } }).__ewb
    const key = '/2p3543573.html'
    state.pages[key] = state.pages[key].replace(/<div class="item answer"><img[^>]*><\/div>/, '<div class="item answer"></div>')
  })
  const seedButton = (label: string) => window.getByRole('button', { name: label, exact: true })
  const seedPaste = async (url: string): Promise<void> => {
    await tab(window, '采集').click()
    const open = seedButton('粘贴链接入库')
    if (await open.isEnabled()) await open.click()
    await window.locator('.import-textarea').fill(url)
    await seedButton('开始入库').click()
  }
  await seedPaste(PAPER_URL)
  await window.getByTestId('import-summary').waitFor({ timeout: 120_000 })
  assert.equal((await window.getByTestId('import-summary').innerText()).replace(/\s+/g, ''), '拆出23道、带答案0道、已在库0道（入库时跳过）')
  await seedButton('确认入库').click()
  await window.getByTestId('import-result').waitFor()
  await seedButton('关闭').click() // 不点「去试题库看本次入库」：那会让试题库带着「本次入库」的筛选
  await window.getByTestId('import-result').waitFor({ state: 'detached' })
  await seedPaste(ENGLISH_URL) // 英语卷第一次打开是安全验证页：放行后重载
  await window.getByTestId('import-waiting').waitFor({ timeout: 30_000 })
  await app.evaluate(() => (globalThis as unknown as { __ewb: { verify: Set<string> } }).__ewb.verify.delete('/2p1111111.html'))
  await window.evaluate(() => window.workbench.browser.reload())
  await window.getByTestId('import-summary').waitFor({ timeout: 120_000 })
  assert.equal((await window.getByTestId('import-summary').innerText()).replace(/\s+/g, ''), '拆出20道、带答案0道、已在库0道（入库时跳过）')
  await seedButton('确认入库').click()
  await window.getByTestId('import-result').waitFor()
  await seedButton('关闭').click()

  const questions: Q[] = await window.evaluate(() => window.workbench.library.listQuestions({ limit: 100 }).then((p) => p.items))
  assert.equal(questions.length, TOTAL)
  const item = (q: Q, id: string) => ({ id, originQuestionId: q.id, sourceLabel: q.sourceLabel, questionType: q.questionType, numberCount: q.numberCount, stemHtml: q.stemHtml, answerHtml: q.answerHtml })
  const choice = questions.filter((q) => q.questionType === '单选题').slice(0, 3)
  const cloze = questions.find((q) => q.questionType.startsWith('完形填空'))!
  assert.equal(choice.length, 3)
  assert.equal(cloze.numberCount, 15)
  const firstOf = (type: RegExp): Q => questions.find((q) => type.test(q.questionType))!
  // 综合测试卷：4 道选择（3 数学 + 1 英语）+ 1 填空 + 1 计算 + 15 空完形填空 = 7 个题块、21 个题号
  const compositeBlocks = [
    { id: 's1', title: '选择题', items: [...choice, firstOf(/^单项选择/)].map((q, i) => item(q, `a${i}`)) },
    { id: 's2', title: '填空题', items: [item(firstOf(/^填空题/), 'b0')] },
    { id: 's3', title: '解答题', items: [item(firstOf(/^解答题-计算题/), 'c0')] },
    { id: 's4', title: '完形填空', items: [item(cloze, 'd0')] }
  ]
  const makePaper = (title: string, sections: unknown) =>
    window.evaluate(
      async ([t, secs]) => {
        const id = await window.workbench.papers.create(t as string)
        await window.workbench.papers.saveEdits(id, { draft: { sections: secs as never } })
        return id
      },
      [title, sections] as const
    )
  await makePaper(COMPOSITE, compositeBlocks)
  // 隔离A、B 用列表最末的两道数学题：试题库第一页的第一道题不被任何试卷用到（F11 要从「未用过」开始）
  await makePaper('隔离A', [{ id: 's1', title: '解答题', items: [item(questions.at(-1)!, 'a0')] }])
  await makePaper('隔离B', [{ id: 's1', title: '解答题', items: [item(questions.at(-2)!, 'b0')] }])

  // ---------------------------------------------------------------- 试卷库
  await tab(window, '试卷库').click()
  await window.getByTestId('paper-row').first().waitFor()
  const initial = await window.evaluate(() => window.workbench.papers.list())
  assert.equal(initial.length, 3)

  // M1：题数按题号。综合测试卷里有完形填空，题号排到 21，题块只有 7 个
  const main = paperRow(window, COMPOSITE)
  assert.match(await main.innerText(), /21 题/)
  assert.equal(initial.find((p) => p.title === COMPOSITE)!.structure.questionCount, 21)
  for (const paper of initial) assert.match(await paperRow(window, paper.title).innerText(), new RegExp(`${paper.structure.questionCount} 题`))
  ok('S9 / M1：试卷库每行显示「N 题」，按题号计（综合测试卷 21 题）')

  // 第三轮版面：左栏分类（全部、未分类带份数）、标签条、行勾选框与表头全选
  const railTexts = await window.locator('.pp-rail [data-testid="category-row"]').evaluateAll((els) => els.map((el) => el.textContent!.replace(/\s+/g, '')))
  assert.deepEqual(railTexts, ['全部3', '未分类3'], '没有分类时左栏只有「全部」「未分类」，份数 3')
  assert.equal(await window.locator('.pp-rail').getByRole('button', { name: '新建分类', exact: true }).count(), 1)
  assert.equal((await window.locator('.pp-tagbar').innerText()).replace(/\s+/g, ''), '标签还没有标签，在试卷的「⋯›标签…」里新建')
  assert.equal(await window.getByTestId('paper-row').getByRole('checkbox').count(), 3, '每行一个勾选框')
  assert.equal(await window.getByRole('checkbox', { name: '选择列表里的全部试卷' }).count(), 1, '表头一个全选框')
  assert.equal(await window.locator('.pp-thead').innerText().then((t) => t.replace(/\s+/g, '')), '标题题数·分值最新版本修改时间操作')
  // 标题最多两行，全名放在 title 属性里（标题按钮的悬停提示就是全名）
  for (const paper of initial) assert.equal(await paperRow(window, paper.title).locator('.pp-title').getAttribute('title'), paper.title)
  assert.equal(await window.locator('.pp-title').first().evaluate((el) => getComputedStyle(el).webkitLineClamp), '2')
  // 勾选后操作条替换表头文字：表头与列表的位置不变，选中第一份时列表不被推下去
  const geometry = async () => ({ head: await window.locator('.pp-thead').boundingBox(), list: await window.locator('.pp-list').boundingBox(), first: await window.getByTestId('paper-row').first().boundingBox() })
  const geometryBefore = await geometry()
  await window.getByTestId('paper-row').first().getByRole('checkbox').check()
  await window.getByTestId('bulk-bar').waitFor()
  assert.deepEqual(await geometry(), geometryBefore)
  assert.equal(await window.locator('.pp-thead .pp-bulk').count(), 1)
  assert.match(await window.getByTestId('bulk-bar').innerText(), /已选 1 份[\s\S]*移到分类[\s\S]*打标签[\s\S]*去标签[\s\S]*取消选择/)
  await window.getByTestId('bulk-bar').getByRole('button', { name: '取消选择', exact: true }).click()
  await window.getByTestId('bulk-bar').waitFor({ state: 'detached' })
  ok('第三轮版面：左栏「全部 3」「未分类 3」+「新建分类」，没有标签时标签条写明从哪里新建，每行勾选框与表头全选框，表头列名不变；标题两行截断且全名在 title 里；勾选后操作条替换表头文字、列表不挪位')

  // 造一份有分值的试卷：选择题每小题 4 分 ×3，完形填空 15 空每小题 1 分
  const scored = await window.evaluate(
    async ([choiceItems, clozeItem]) => {
      const id = await window.workbench.papers.create('分值测试卷')
      await window.workbench.papers.saveEdits(id, {
        draft: {
          sections: [
            { id: 's1', title: '选择题', defaultScore: 4, items: choiceItems },
            { id: 's2', title: '完形填空', defaultScore: 1, items: [clozeItem] }
          ]
        }
      })
      await window.workbench.papers.saveVersion(id, '')
      return id
    },
    [choice.map((q, i) => item(q, `c${i}`)), item(cloze, 'z0')] as const
  )
  const cnt = 3 + cloze.numberCount
  await tab(window, '设置').click()
  await tab(window, '试卷库').click()
  await paperRow(window, '分值测试卷').waitFor()
  const scoredText = await paperRow(window, '分值测试卷').innerText()
  assert.match(scoredText, new RegExp(`${cnt} 题 · ${12 + cloze.numberCount} 分`))
  assert.match(scoredText, /v1/)
  assert.equal(await paperRow(window, '分值测试卷').locator('.ui-tag').count(), 0, '刚存过版本：没有任何标签')
  assert.doesNotMatch(scoredText, /未存/)
  // 没存过版本的卷：只写「未存为版本」（与编辑器同词），没有版本可比对，不出现红色标签
  const noVersionRow = paperRow(window, '隔离A')
  assert.match(await noVersionRow.innerText(), /未存为版本/)
  assert.doesNotMatch(await noVersionRow.innerText(), /未存版本/)
  assert.equal(await noVersionRow.locator('.ui-tag').count(), 0, '无版本的卷不出红签')
  assert.doesNotMatch(await noVersionRow.innerText(), /有改动未存为版本|有未存改动/)
  ok(`S9：摘要「${cnt} 题 · ${12 + cloze.numberCount} 分」、最新版本 v1 且无标签；没存过版本的卷只写「未存为版本」、不出红签`)

  // 重命名后与最新版本不一致：出现「有改动未存为版本」，并排到最前（按修改时间）
  await rowMenu(window, '分值测试卷', '重命名')
  await window.getByLabel('试卷标题').fill('分值测试卷（改）')
  await window.getByRole('button', { name: '保存', exact: true }).click()
  await paperRow(window, '分值测试卷（改）').waitFor()
  const dirtyTag = paperRow(window, '分值测试卷（改）').locator('.ui-tag')
  assert.equal(await dirtyTag.count(), 1, '有版本且草稿改过：只有一个标签')
  assert.equal((await dirtyTag.innerText()).trim(), '有改动未存为版本')
  assert.doesNotMatch(await paperRow(window, '分值测试卷（改）').innerText(), /未存版本/)
  const order = await window.evaluate(() => window.workbench.papers.list().then((l) => l.map((p) => p.title)))
  const shownOrder = await window.getByTestId('paper-row').locator('.pp-title').allInnerTexts()
  assert.deepEqual(shownOrder, order, '列表顺序应与修改时间倒序一致')
  assert.equal(shownOrder[0], '分值测试卷（改）')
  await shot(window, 'papers-dirty-1440x900')
  await resize(app, window, 1280, 800)
  await shot(window, 'papers-dirty-1280x800')
  await resize(app, window, 1440, 900)
  ok('S9：重命名后出现「有改动未存为版本」（有版本且草稿改过，只一个标签），列表按修改时间倒序，刚改的排最前')

  // 搜索
  const count = initial.length + 1
  await window.getByLabel('搜索试卷').fill('隔离')
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 2)
  assert.equal(await window.locator('.pp-title mark').count(), 2)
  assert.match(await window.locator('.pp-count').innerText(), new RegExp(`筛出 2 份，共 ${count} 份`))
  await window.getByLabel('搜索试卷').fill('zzz不存在')
  await window.getByText('没有标题含「zzz不存在」的试卷').waitFor()
  await window.getByRole('button', { name: '清除搜索', exact: true }).click()
  await window.waitForFunction((n) => document.querySelectorAll('[data-testid="paper-row"]').length === n, count)
  ok('S9：按标题搜索（命中词高亮、写出筛出份数），无结果有「清除搜索」')

  // 继续上次编辑：打开修改时间最近的那份
  await window.getByRole('button', { name: /继续上次编辑/ }).click()
  await window.getByLabel('试卷标题').waitFor()
  assert.equal(await window.getByLabel('试卷标题').inputValue(), '分值测试卷（改）')
  await window.getByTestId('dirty-tag').waitFor()
  assert.equal((await window.getByTestId('dirty-tag').innerText()).trim(), '有改动未存为版本', '试卷库与编辑器同一状态用同一个词')
  await goTo(window, 'papers', null)
  await window.getByTestId('paper-row').first().waitFor()
  ok('S9：「继续上次编辑」打开最近修改的试卷；编辑器顶栏的状态词与试卷库一致')

  // 键盘：每行除勾选框外只有「打开」与「更多操作」两个按钮停靠点，标题按钮只服务鼠标；鼠标点标题照样能打开
  const stops = await window.getByTestId('paper-row').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('button')].filter((b) => b.tabIndex >= 0).map((b) => b.textContent?.trim() || b.getAttribute('aria-label'))))
  for (const row of stops) assert.equal(row.length, 2, `每行 Tab 停靠点：${row.join('|')}`)
  assert.equal(await window.locator('.pp-title').evaluateAll((els) => els.every((el) => el.getAttribute('tabindex') === '-1')), true)
  await paperRow(window, '隔离A').locator('.pp-title').click()
  await window.getByLabel('试卷标题').waitFor()
  assert.equal(await window.getByLabel('试卷标题').inputValue(), '隔离A')
  await goTo(window, 'papers', null)
  await window.getByTestId('paper-row').first().waitFor()
  ok('S10：试卷库每行除勾选框外只有「打开」「更多操作」两个按钮停靠点，点标题仍能打开')

  // 另存为新试卷
  await rowMenu(window, COMPOSITE, '另存为新试卷')
  await paperRow(window, `${COMPOSITE}（副本）`).waitFor()
  const dupToast = window.getByTestId('toast').filter({ hasText: '已另存为新试卷' })
  await dupToast.waitFor()
  const dupList = await window.evaluate(() => window.workbench.papers.list())
  const copy = dupList.find((p) => p.title === `${COMPOSITE}（副本）`)!
  assert.equal(copy.structure.questionCount, 21)
  assert.equal(copy.latestVersionNo, null)
  await dupToast.getByRole('button', { name: '打开', exact: true }).click()
  await window.getByLabel('试卷标题').waitFor()
  assert.equal(await window.getByLabel('试卷标题').inputValue(), `${COMPOSITE}（副本）`)
  await goTo(window, 'papers', null)
  await window.getByTestId('paper-row').first().waitFor()
  ok('S9 / F10：每行菜单「另存为新试卷」复制出带 21 题的副本（无版本），提示条里的「打开」进入副本')

  // 删除：8 秒内可撤销，先隐藏、到时才真删
  await rowMenu(window, '分值测试卷（改）', '删除')
  await paperRow(window, '分值测试卷（改）').waitFor({ state: 'detached' })
  // 等待删除的试卷不计入左栏份数
  const liveCount = (await window.evaluate(() => window.workbench.papers.list())).length - 1
  assert.equal(await window.locator('.pp-rail [data-testid="category-row"]').first().locator('em').innerText(), String(liveCount), '倒计时内左栏「全部」不再计这份')
  assert.equal(await window.locator('.pp-count').innerText(), `共 ${liveCount} 份`)
  const undoToast = window.getByTestId('toast').filter({ hasText: '已删除「分值测试卷（改）」' })
  await undoToast.waitFor()
  assert.ok((await window.evaluate(() => window.workbench.papers.list())).some((p) => p.title === '分值测试卷（改）'), '倒计时内试卷还在库里')
  await shot(window, 'papers-undo-toast-1440')
  await undoToast.getByRole('button', { name: '撤销', exact: true }).click()
  await paperRow(window, '分值测试卷（改）').waitFor()
  await window.waitForTimeout(500)
  assert.equal(await undoToast.count(), 0)
  ok('S9：删除后试卷立刻从列表消失、库里仍在；点「撤销」整行回来')

  await rowMenu(window, '分值测试卷（改）', '删除')
  await paperRow(window, '分值测试卷（改）').waitFor({ state: 'detached' })
  await window.waitForTimeout(3000)
  assert.ok((await window.evaluate(() => window.workbench.papers.list())).some((p) => p.title === '分值测试卷（改）'), '3 秒时还没真删')
  await tab(window, '试题库').click() // 切到别的页面倒计时照常走
  await until(async () => !(await window.evaluate(() => window.workbench.papers.list())).some((p) => p.title === '分值测试卷（改）'), 12_000)
  await tab(window, '试卷库').click()
  await window.getByTestId('paper-row').first().waitFor()
  assert.equal(await paperRow(window, '分值测试卷（改）').count(), 0)
  assert.equal(await window.getByTestId('toast').filter({ hasText: '已删除「分值测试卷（改）」' }).count(), 0, '到点后撤销提示一并消失')
  ok('S9：不撤销时 8 秒后真正删除（切页面也照常），撤销提示随之消失')

  // 截图：两个尺寸的试卷库
  await resize(app, window, 1440, 900)
  await shot(window, 'papers-1440x900')
  await resize(app, window, 1280, 800)
  await shot(window, 'papers-1280x800')
  await resize(app, window, 1440, 900)

  // ---------------------------------------------------------------- 试题库
  await tab(window, '试题库').click()
  await window.getByTestId('question-card').first().waitFor()
  const facets = await window.evaluate(() => window.workbench.library.facets({}))
  assert.equal(facets.total, TOTAL)
  assert.equal(facets.withAnswer, 0)
  assert.equal(await totalText(window), '共 43 道题')

  // S19：全库都没有答案，只在顶部提示一次，卡片上不逐个标「无答案」
  assert.equal(await window.getByTestId('no-answer-notice').count(), 1)
  assert.equal(await window.locator('.lb-row .ui-tag', { hasText: '无答案' }).count(), 0)
  assert.equal(await window.locator('.lb-row .ui-tag', { hasText: '有答案' }).count(), 0)
  assert.equal((await window.getByTestId('no-answer-notice').innerText()).replace(/\s+/g, ''), '全库43道题都还没有答案。教师版要带答案，可在试卷里给题目「添加答案」。知道了')
  assert.ok(await window.getByTestId('no-answer-notice').evaluate((el) => el.classList.contains('notice')), '提示条用全局 .notice 琥珀样式')
  ok('S19：全库 43 道题都没有答案 → 顶部提示一次（教师版要带答案，可在试卷里「添加答案」），卡片上没有「无答案」标记')

  // 红笔只标改动：平时每行的「删除」是中性的灰框按钮，不是红字红图标；点了之后才红
  const delButton = window.getByTestId('question-card').first().getByRole('button', { name: '删除', exact: true })
  const delStyle = await delButton.evaluate((el) => {
    const css = getComputedStyle(el)
    const svg = getComputedStyle(el.querySelector('svg')!)
    return { color: css.color, border: css.borderTopColor, icon: svg.color }
  })
  assert.equal(delStyle.color, 'rgb(26, 26, 26)', `删除字色应为印刷黑：${delStyle.color}`)
  assert.equal(delStyle.icon, delStyle.color, '垃圾桶图标与文字同色')
  assert.equal(delStyle.border, 'rgb(139, 142, 136)', `删除边框应为灰框：${delStyle.border}`)
  const redNow = await window.locator('.lb-list').evaluate((list) => [...list.querySelectorAll('*')].filter((el) => el.children.length === 0 || el.tagName === 'svg').filter((el) => getComputedStyle(el).color === 'rgb(195, 50, 43)' && el.getBoundingClientRect().width > 0).length)
  assert.equal(redNow, 0, '试题库列表里没有红色元素（红笔只标改动）')
  ok('方向 C：试题库每行「删除」是墨色字加灰框，整个列表没有红色元素；点了才进入红底确认')

  // N11：题型带题数，按常用顺序（选择 → 填空 → 阅读 → 解答 → 写作），不按拼音
  const groups = new Map<string, number>()
  for (const t of facets.types) groups.set(primaryQuestionType(t.type), (groups.get(primaryQuestionType(t.type)) ?? 0) + t.count)
  const expected = [...groups.entries()].map(([name, count]) => ({ name, count })).sort(compareTypeNames)
  // 题型多于 8 个时默认收起，展开后再核对全部
  if (expected.length > 8) await window.locator('.lb-types-foot').getByRole('button').click()
  const shownTypes =await window.locator('.lb-types > li > button').evaluateAll((els) => els.map((el) => [el.querySelector('span')!.textContent!, el.querySelector('em')!.textContent!]))
  assert.deepEqual(shownTypes, [['全部题型', String(TOTAL)], ...expected.map((g) => [g.name, String(g.count)])])
  const names = shownTypes.map((t) => t[0])
  for (const [a, b] of [['单选题', '填空题'], ['填空题', '阅读理解'], ['阅读理解', '解答题'], ['解答题', '书面表达']] as const) assert.ok(names.indexOf(a) < names.indexOf(b), `${a} 应排在 ${b} 前面`)
  ok(`N11：题型按钮带题数并按常用顺序排：${names.slice(1, 6).join('、')}…`)

  // 题型筛选：大类含子类，子类展开
  await window.locator('.lb-types').getByRole('button', { name: /^解答题\s*8$/ }).click()
  await window.getByText('筛出 8 道，全库 43 道').waitFor()
  assert.ok(await window.locator('.lb-chip', { hasText: '题型：解答题' }).isVisible())
  await window.locator('.lb-sub').getByRole('button', { name: /^计算题\s*2$/ }).click()
  await window.getByText('筛出 2 道，全库 43 道').waitFor()
  await window.getByRole('button', { name: '清除筛选：题型：解答题-计算题' }).click()
  await window.getByText('共 43 道题').waitFor()
  ok('题型筛选：解答题 8 道、其中计算题 2 道；点 chip 的 × 清除')

  // N8：关键词命中高亮
  await window.getByPlaceholder('题干中的文字').fill('数轴')
  const kw = await window.evaluate(() => window.workbench.library.listQuestions({ keyword: '数轴', limit: 100 }))
  assert.ok(kw.total > 0)
  await window.getByText(`筛出 ${kw.total} 道，全库 43 道`).waitFor()
  await window.locator('.lb-stem mark').first().waitFor()
  const marks = await window.locator('.lb-stem mark').allInnerTexts()
  assert.ok(marks.every((m) => m === '数轴'), `高亮的都是命中词：${marks.join('|')}`)
  await shot(window, 'library-keyword-highlight-1440')
  await window.getByPlaceholder('题干中的文字').fill('')
  await window.getByText('共 43 道题').waitFor()
  assert.equal(await window.locator('.lb-stem mark').count(), 0)
  ok(`N8：关键词「数轴」命中 ${kw.total} 道，命中词高亮 ${marks.length} 处，清空后高亮消失`)

  // S20：筛选无结果时写出当前生效的条件，并有「清除筛选」
  await window.locator('.lb-types').getByRole('button', { name: /^解答题\s*8$/ }).click()
  await window.getByPlaceholder('题干中的文字').fill('zzqq不存在')
  await window.locator('.lb-empty').waitFor()
  const emptyText = await window.locator('.lb-empty').innerText()
  assert.match(emptyText, /没有符合条件的题目/)
  assert.match(emptyText, /题型「解答题」/)
  assert.match(emptyText, /关键词「zzqq不存在」/)
  await shot(window, 'library-empty-result-1440')
  await window.locator('.lb-empty').getByRole('button', { name: '清除筛选', exact: true }).click()
  await window.getByText('共 43 道题').waitFor()
  assert.equal(await window.getByPlaceholder('题干中的文字').inputValue(), '')
  ok('S20：无结果时写出「题型「解答题」，关键词「zzqq不存在」」，一键清除后回到全部 43 道、关键词框同步清空')

  // 筛选条件切页面后保留
  await window.locator('.lb-types').getByRole('button', { name: /^单选题\s*10$/ }).click()
  await window.getByText('筛出 10 道，全库 43 道').waitFor()
  await tab(window, '设置').click()
  await tab(window, '试题库').click()
  await window.getByText('筛出 10 道，全库 43 道').waitFor()
  assert.equal(await window.locator('.lb-types').getByRole('button', { name: /^单选题\s*10$/ }).getAttribute('aria-pressed'), 'true')
  ok('筛选条件放在页面外：切到设置再回来，「单选题」仍选中')

  // N4：短题不出「展开」，长题出
  await window.locator('.lb-types').getByRole('button', { name: /^单项选择\s*10$/ }).click()
  await window.getByText('筛出 10 道，全库 43 道').waitFor()
  await window.waitForTimeout(500)
  const rows = window.getByTestId('question-card')
  assert.equal(await rows.count(), 10)
  assert.equal(await rows.nth(1).getByRole('button', { name: '展开全部题干' }).count(), 0, '两行的短题不显示「展开」')
  await window.locator('.lb-types').getByRole('button', { name: /^阅读理解\s*4$/ }).click()
  await window.getByText('筛出 4 道，全库 43 道').waitFor()
  await window.waitForTimeout(500)
  assert.ok((await window.getByRole('button', { name: '展开全部题干' }).count()) >= 1, '长题有「展开」')
  ok('N4：单项选择里的短题没有「展开全部题干」，阅读理解的长题有')

  await window.locator('.lb-types').getByRole('button', { name: /^全部题型\s*43$/ }).click()
  await window.getByText('共 43 道题').waitFor()
  await window.waitForTimeout(300)

  // 删除原题确认文案
  const first = window.getByTestId('question-card').first()
  await first.getByRole('button', { name: '删除', exact: true }).click()
  assert.match(await first.innerText(), /删除这道原题？/)
  assert.match(await first.innerText(), /试卷副本不受影响/)
  await first.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1 }))).total, TOTAL)
  ok('删除原题：整行变红底确认，写明「试卷副本不受影响」，取消后题目仍在')

  // F11：加入试卷 ▾（最近 3 份 + 选择试卷…）与「已用于 N 份试卷」
  const firstQuestion = (await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1 }))).items[0]
  const before = await window.evaluate(() => window.workbench.papers.list())
  const recent = before.slice(0, 3)
  const card = window.getByTestId('question-card').first()
  assert.equal(await card.getByTestId('question-usage').count(), 0)
  await card.getByRole('button', { name: '加入试卷', exact: true }).click()
  const menuItems = await window.getByRole('menuitem').allInnerTexts()
  assert.deepEqual(menuItems.map((t) => t.trim()), [...recent.map((p) => p.title), '选择试卷…'])
  await shot(window, 'library-add-menu-1440')
  await window.getByRole('menuitem', { name: recent[0].title, exact: true }).click()
  const addToast = window.getByTestId('toast').filter({ hasText: `已加入《${recent[0].title}》第` })
  await addToast.waitFor()
  const afterA = await window.evaluate((id) => window.workbench.papers.get(id), recent[0].id)
  const numbered = numberItems(afterA.draft.sections)
  const added = numbered.filter((n) => n.item.originQuestionId === firstQuestion.id).at(-1)!
  assert.ok(added, '题已进入草稿')
  assert.equal(added.item.stemHtml, firstQuestion.stemHtml)
  assert.match(await addToast.innerText(), new RegExp(`第 ${numberLabel(added)} 题`))
  await card.getByTestId('question-usage').waitFor()
  assert.equal((await card.getByTestId('question-usage').innerText()).trim(), '已用于 1 份试卷')
  await shot(window, 'library-add-toast-1440')
  ok(`F11：最近 3 份试卷（${recent.map((p) => p.title).join('、')}）+「选择试卷…」；加入后提示「已加入《${recent[0].title}》第 ${numberLabel(added)} 题」，卡片显示「已用于 1 份试卷」`)

  // 选择试卷…：弹窗里搜索，加入另一份
  const other = before.find((p) => p.id !== recent[0].id && p.title === '隔离B')!
  await card.getByRole('button', { name: '加入试卷', exact: true }).click()
  await window.getByRole('menuitem', { name: '选择试卷…', exact: true }).click()
  await window.getByRole('dialog').waitFor()
  await window.getByLabel('搜索试卷').fill('隔离B')
  assert.equal(await window.locator('.picker-item').count(), 1)
  await shot(window, 'library-add-picker-1440')
  await window.locator('.picker-item').click()
  await window.getByTestId('toast').filter({ hasText: `已加入《${other.title}》第` }).waitFor()
  await window.waitForFunction(() => document.querySelector('[data-testid="question-usage"]')?.textContent?.includes('2 份'), null, { timeout: 5000 })
  const otherDraft = (await window.evaluate((id) => window.workbench.papers.get(id), other.id)).draft
  assert.ok(numberItems(otherDraft.sections).some((n) => n.item.originQuestionId === firstQuestion.id))
  ok('F11：「选择试卷…」弹窗按标题搜索后加入「隔离B」，已用于 2 份试卷')

  // 同一份试卷再加一次：用到它的试卷数不变；目标满分等草稿字段不丢
  await window.evaluate(async (id) => {
    const paper = await window.workbench.papers.get(id)
    await window.workbench.papers.saveEdits(id, { draft: { ...paper.draft, targetScore: 100 } })
  }, recent[0].id)
  await card.getByRole('button', { name: '加入试卷', exact: true }).click()
  // 菜单里最近的试卷按修改时间重排过：按标题点
  await window.getByRole('menuitem', { name: recent[0].title, exact: true }).click()
  await until(async () => (await window.evaluate((id) => window.workbench.papers.get(id), recent[0].id)).draft.sections.flatMap((s) => s.items).filter((i) => i.originQuestionId === firstQuestion.id).length === 2, 5000)
  await window.waitForTimeout(500)
  assert.equal((await card.getByTestId('question-usage').innerText()).trim(), '已用于 2 份试卷')
  const again = await window.evaluate((id) => window.workbench.papers.get(id), recent[0].id)
  assert.equal(again.draft.targetScore, 100, '加入题目不能冲掉草稿里的目标满分')
  assert.equal(numberItems(again.draft.sections).filter((n) => n.item.originQuestionId === firstQuestion.id).length, 2)
  ok('F11：同一题再次加入同一份试卷，「已用于」仍按试卷数算（2 份）；草稿里的目标满分保留')

  // 提示条里的「打开」
  const openToast = window.getByTestId('toast').filter({ hasText: '已加入' }).last()
  await openToast.getByRole('button', { name: '打开', exact: true }).click()
  await window.getByLabel('试卷标题').waitFor()
  assert.equal(await window.getByLabel('试卷标题').inputValue(), recent[0].title)
  await goTo(window, 'library')
  await window.getByTestId('question-card').first().waitFor()
  ok('F11：提示条里的「打开」跳到该试卷的编辑器')

  // 两个尺寸的试题库截图
  await shot(window, 'library-1440x900')
  await resize(app, window, 1280, 800)
  await window.waitForTimeout(400)
  await shot(window, 'library-1280x800')
  await resize(app, window, 1440, 900)

  // 主进程查询：题型分布随筛选条件变化、已用于几份试卷、异常入参不崩
  const apiChecks = await window.evaluate(async (qid) => {
    const { library } = window.workbench
    const all = await library.facets({})
    const byKeyword = await library.facets({ keyword: '数轴' })
    const keywordTotal = (await library.listQuestions({ keyword: '数轴', limit: 100 })).total
    const onePaper = await library.facets({ sourcePaperId: (await library.listSourcePapers())[0].id })
    const byIds = await library.facets({ ids: [qid] })
    const badIds = await library.facets({ ids: 'x' as unknown as number[] }).then(() => 'ok', () => 'rejected')
    const usage = await library.questionUsage([qid, 999_999])
    const badUsage = await library.questionUsage('x' as unknown as number[])
    return {
      all: all.types.reduce((n, t) => n + t.count, 0),
      allTotal: all.total,
      keyword: byKeyword.types.reduce((n, t) => n + t.count, 0),
      keywordTotal,
      paper: onePaper.types.reduce((n, t) => n + t.count, 0),
      byIds,
      badIds,
      usage,
      badUsage
    }
  }, firstQuestion.id)
  assert.equal(apiChecks.all, apiChecks.allTotal)
  assert.equal(apiChecks.keyword, apiChecks.keywordTotal, '关键词条件下的题型分布总数等于命中题数')
  assert.ok(apiChecks.paper > 0 && apiChecks.paper < apiChecks.allTotal)
  assert.deepEqual(apiChecks.byIds.types, [{ type: firstQuestion.questionType, count: 1 }])
  assert.equal(apiChecks.byIds.total, apiChecks.allTotal, '全库题数不受筛选影响')
  assert.deepEqual(apiChecks.usage, { [firstQuestion.id]: 2 })
  assert.deepEqual(apiChecks.badUsage, {})
  assert.equal(apiChecks.badIds, 'ok')
  ok('主进程：facets 随来源卷 / 关键词 / 题号变化且总数对得上，questionUsage 只返回用到的题，异常入参不崩')

  // 接口模糊测试：筛选字段类型不对、关键词超长，不抛原始 TypeError / SQLite 错误
  const fuzz = await window.evaluate(async () => {
    const { library } = window.workbench
    type Any = never
    const attempt = async (fn: () => Promise<unknown>): Promise<{ ok: boolean; message: string; value?: unknown }> => {
      try {
        return { ok: true, message: '', value: await fn() }
      } catch (e) {
        return { ok: false, message: String(e) }
      }
    }
    const known = (await library.listQuestions({ limit: 2 })).items.map((q) => q.id)
    const typeSum = (f: unknown): number => (f as { types: { count: number }[] }).types.reduce((n, t) => n + t.count, 0)
    const cases = {
      kwNumber: await attempt(() => library.facets({ keyword: 123 } as Any)),
      kwObject: await attempt(() => library.listQuestions({ keyword: { a: 1 } } as Any)),
      kwArray: await attempt(() => library.facets({ keyword: ['数轴'] } as Any)),
      kwHuge: await attempt(() => library.facets({ keyword: '数'.repeat(100_000) })),
      kwHugeList: await attempt(() => library.listQuestions({ keyword: 'a'.repeat(100_000) })),
      typeNumber: await attempt(() => library.listQuestions({ questionType: 5 } as Any)),
      typeHuge: await attempt(() => library.listQuestions({ questionType: '解'.repeat(100_000) })),
      paperString: await attempt(() => library.listQuestions({ sourcePaperId: '1 OR 1=1' } as Any)),
      paperFloat: await attempt(() => library.facets({ sourcePaperId: 1.5 } as Any)),
      idsString: await attempt(() => library.listQuestions({ ids: 'x' } as Any)),
      idsMixed: await attempt(() => library.listQuestions({ ids: [known[0], 'x', null, known[0] + 0.5, known[1]] } as Any)),
      limitBad: await attempt(() => library.listQuestions({ limit: 'abc', offset: 'x' } as Any)),
      negative: await attempt(() => library.listQuestions({ limit: -5, offset: -9 })),
      notObject: await attempt(() => library.listQuestions('x' as Any)),
      nullFilter: await attempt(() => library.facets(null as Any))
    }
    const total = (await library.listQuestions({ limit: 1 })).total
    return { cases, total, kwNumberSum: typeSum(cases.kwNumber.value), allSum: typeSum((await library.facets({}))) }
  })
  for (const [name, result] of Object.entries(fuzz.cases)) {
    assert.equal(result.ok, true, `${name} 不应抛错：${result.message}`)
  }
  const page = (name: keyof typeof fuzz.cases) => fuzz.cases[name].value as { total: number; items: unknown[] }
  assert.equal(fuzz.kwNumberSum, fuzz.allSum, '关键词不是字符串按没设处理')
  assert.equal(page('kwObject').total, fuzz.total)
  assert.equal(page('typeNumber').total, fuzz.total, '题型不是字符串按没设处理')
  assert.equal(page('paperString').total, fuzz.total, '来源卷不是整数按没设处理（不会被当成 SQL 拼进去）')
  assert.equal(page('idsString').total, fuzz.total)
  assert.equal(page('idsMixed').total, 2, '题号里的字符串、null、小数被丢掉，只剩两个真实题号')
  assert.ok(page('limitBad').items.length > 0 && page('negative').items.length > 0)
  assert.equal(page('kwHugeList').total, 0, '超长关键词截到 100 字后照常查询，不报 LIKE pattern too complex')
  ok('接口模糊测试：关键词 / 题型 / 来源卷 / 题号 / 分页参数类型不对、关键词 10 万字，全部不抛原始错误且按没设处理')

  // ---------------------------------------------------------------- 设置
  await tab(window, '设置').click()
  await window.getByTestId('shortcut-table').waitFor()
  const info = await window.evaluate(() => window.workbench.data.info())
  assert.equal(info.appVersion, rootPackage.version)
  await window.getByTestId('app-version').filter({ hasText: info.appVersion }).waitFor()
  assert.equal((await window.getByTestId('app-version').innerText()).trim(), `组卷工作台 ${info.appVersion}`, '行标题是「版本」，内容不再重复写「版本」')
  const shortcutText = await window.getByTestId('shortcut-table').innerText()
  for (const part of ['Ctrl', 'S', '存为版本', 'Z', '撤销', 'Shift', '重做', 'Esc', '结束编辑', 'Alt', '↑', '↓', '题目']) assert.ok(shortcutText.includes(part), `快捷键表缺少「${part}」`)
  assert.equal(await window.getByTestId('shortcut-table').locator('tbody tr').count(), 5)
  ok(`N6：设置页显示版本号 ${info.appVersion}，快捷键表 5 行`)

  const defaults = await window.evaluate(() => window.workbench.exporter.getDefaults())
  await window.getByTestId('download-dir').filter({ hasText: defaults.directory }).waitFor()
  const picked = mkdtempSync(join(tmpdir(), 'ewb-pages-download-'))
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
  }, picked)
  await window.locator('section[aria-labelledby="st-download"]').getByRole('button', { name: '更改位置…' }).click()
  await window.getByTestId('download-dir').filter({ hasText: picked }).waitFor()
  assert.equal((await window.evaluate(() => window.workbench.exporter.getDefaults())).directory, picked, '更改后下载弹窗读到的默认位置一致')
  ok('N6：默认下载位置显示 getDefaults().directory，「更改位置…」选择后保存，getDefaults 读到新位置')

  // 提示条别压住截图：前面加入试卷的提示（8 秒）可能还在，逐条关掉
  const closeToast = window.getByRole('button', { name: '关闭提示' })
  while ((await closeToast.count()) > 0) await closeToast.first().click()
  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    await resize(app, window, w, h)
    await window.waitForTimeout(300)
    await shot(window, `settings-${w}x${h}`)
  }
} finally {
  await real.app.close()
}

// ======================================================================
// 第二部分：空库与入库（本地样本页代替组卷网）
// ======================================================================
const flow = await launchApp({ outDir: OUT })
try {
  const { app, window } = flow
  await installIntercept(app)
  await resize(app, window, 1440, 900)
  const button = (label: string) => window.getByRole('button', { name: label, exact: true })

  // N7：空库的试题库提示带「去采集」
  await currentTab(window).waitFor()
  assert.equal(await currentTab(window).innerText(), '采集', '空库首次启动进采集页')
  await tab(window, '试题库').click()
  await window.getByText('试题库还是空的').waitFor()
  await shot(window, 'library-empty-1440x900')
  await button('去采集').click()
  await window.locator('.app-nav [aria-current="page"]').filter({ hasText: '采集' }).waitFor()
  await window.locator('.cl-toolbar').waitFor()
  ok('N7：试题库为空时给出「去采集」，点击跳到采集页')

  // 采集页截图（原生浏览器视图不在页面截图里，只看工具栏与面板）
  await shot(window, 'collect-1440x900')
  await resize(app, window, 1280, 800)
  await shot(window, 'collect-1280x800')
  await resize(app, window, 1440, 900)

  const summary = async (): Promise<string> => {
    const el = window.getByTestId('import-summary')
    await el.waitFor({ timeout: 120_000 })
    return (await el.innerText()).replace(/\s+/g, '')
  }
  const startPaste = async (urls: string[]): Promise<void> => {
    await tab(window, '采集').click()
    const open = button('粘贴链接入库')
    if (await open.isEnabled()) await open.click()
    await window.locator('.import-textarea').fill(urls.join('\n'))
    await button('开始入库').click()
  }

  // S18：带答案 0 道时黄色提示
  await startPaste([ENGLISH_URL])
  await window.getByTestId('import-waiting').waitFor({ timeout: 30_000 })
  await app.evaluate(() => (globalThis as unknown as { __ewb: { verify: Set<string> } }).__ewb.verify.delete('/2p1111111.html'))
  await window.evaluate(() => window.workbench.browser.reload())
  assert.equal(await summary(), '拆出20道、带答案0道、已在库0道（入库时跳过）')
  assert.match(await window.getByTestId('import-no-answer').innerText(), /带答案 0 道/)
  await shot(window, 'import-preview-no-answer-1440')
  await button('取消').click()
  await window.locator('.import-panel').waitFor({ state: 'detached' })
  ok('S18：预览里带答案 0 道时出黄色提示')

  // 单题页 + 试卷页：23 道新题，其中带答案 1 道，没有黄色提示
  await startPaste([QUESTION_URL, PAPER_URL])
  assert.equal(await summary(), '拆出24道、带答案1道、已在库1道（入库时跳过）')
  assert.equal(await window.getByTestId('import-no-answer').count(), 0)
  await shot(window, 'import-preview-1440x900')
  await button('确认入库').click()
  await window.getByTestId('import-result').waitFor()
  assert.equal((await window.getByTestId('import-result').innerText()).replace(/\s+/g, ''), '新增23道，跳过1道（已在库）')
  await shot(window, 'import-done-1440x900')

  // S18：去试题库看本次入库
  await button('去试题库看本次入库').click()
  await window.locator('.lb-chip', { hasText: '本次入库' }).waitFor()
  await window.getByTestId('question-card').first().waitFor()
  assert.equal(await totalText(window), '筛出 23 道，全库 23 道')
  assert.equal(await window.locator('.import-panel').count(), 0)
  ok('S18：入库完成 → 「去试题库看本次入库」→ 试题库只显示本次新增的 23 道（带「本次入库」chip）')

  // 删掉一道、再整页入库补回：本次入库只有 1 道，与全库区分开
  const gone = (await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1 }))).items[0]
  await window.evaluate((id) => window.workbench.library.deleteQuestion(id), gone.id)
  await tab(window, '采集').click()
  await window.evaluate((url) => window.workbench.browser.navigate(url), PAPER_URL)
  await window.waitForFunction(() => !(document.querySelector('.toolbar-actions .ui-btn--primary') as HTMLButtonElement).disabled, null, { timeout: 60_000 })
  await button('整页入库').click()
  assert.match(await summary(), /^拆出23道、带答案[01]道、已在库22道（入库时跳过）$/)
  await button('确认入库').click()
  await window.getByTestId('import-result').waitFor()
  await button('去试题库看本次入库').click()
  await window.locator('.lb-chip', { hasText: '本次入库' }).waitFor()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="question-card"]').length === 1)
  assert.equal(await totalText(window), '筛出 1 道，全库 23 道')
  await window.getByRole('button', { name: '清除筛选', exact: true }).first().click()
  await window.getByText('共 23 道题').waitFor()
  ok('S18：补回 1 道后「本次入库」只显示这 1 道（全库 23 道）；清除筛选回到全部')

  // S18：再入一次，全部已在库 → 确认入库禁用并说明
  await startPaste([QUESTION_URL, PAPER_URL])
  assert.match(await summary(), /已在库24道（入库时跳过）$/)
  assert.equal(await button('确认入库').isDisabled(), true)
  assert.match(await window.getByTestId('import-nothing-new').innerText(), /没有可入库的新题/)
  await shot(window, 'import-preview-nothing-new-1440')
  await button('取消').click()
  ok('S18：拆出的题全部已在库时，「确认入库」置灰并说明原因')
} finally {
  await flow.app.close()
}

console.log(`页面端到端测试通过：${steps} 项，截图在 ${evidence}`)
