// 试卷库分类与标签端到端测试（第三轮 P1–P6）
//   P1 左侧分类：全部 / 各分类 / 未分类带份数、新建 / 改名 / 上移下移 / 删除（确认框写明份数）、30 字边界、重名报错、份数不含等待删除的试卷
//   P2 标签筛选：多选取并集，与标题搜索、当前分类同时生效；管理标签（改名合并、删除）
//   P3 行上「⋯」的「移到分类」「标签」；勾选多份后的操作条（移到分类、打标签、去标签、取消选择）
//   P4 在某个分类下新建试卷直接归入；另存为新试卷继承分类与标签
//   P5 分类与标签只用于整理：列表顺序、修改时间、「继续上次编辑」、版本状态都不变
//   P6 新建分类的常用名下拉（已有的不再列）
// 用法：node test/e2e/papers-classify.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { CATEGORY_PRESETS } from '../../src/shared/classify.ts'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-papers-classify-'))
mkdirSync(evidence, { recursive: true })
buildTo('out-papers3')

let steps = 0
const ok = (name: string): void => {
  steps++
  console.log(`  ✓ ${steps}. ${name}`)
}

const SIZES = [
  [1440, 900],
  [1280, 800],
  [1000, 640]
] as const

const resize = async (app: ElectronApplication, window: Page, width: number, height: number): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const)
  await window.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const)
}
const shot = (window: Page, name: string) => window.screenshot({ path: join(evidence, `${name}.png`) })
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const dataDir = mkdtempSync(join(tmpdir(), 'ewb-papers-classify-data-'))
seedDataDir(dataDir)
const { app, window } = await launchApp({ outDir: 'out-papers3', dataDir })

// 三个尺寸各截一张，结束后回到 1440×900；浮层类界面只截 1440 与 1000（窗口尺寸一变浮层会重新定位，保持打开）
// 打开着菜单或小框时不能去点提示条的关闭（点在浮层外会把浮层关掉），传 keepOpen
const shots = async (name: string, sizes: readonly (readonly [number, number])[] = SIZES, keepOpen = false): Promise<void> => {
  if (!keepOpen) await clearToasts()
  for (const [w, h] of sizes) {
    await resize(app, window, w, h)
    await window.waitForTimeout(250)
    await shot(window, `${name}-${w}x${h}`)
  }
  await resize(app, window, 1440, 900)
  await window.waitForTimeout(150)
}
const NARROW = [
  [1440, 900],
  [1000, 640]
] as const

// ---------- 页面元素 ----------
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rail = window.locator('.pp-rail')
const railButton = (name: string): Locator => rail.getByTestId('category-row').locator('.pp-cat-main').filter({ has: window.locator('span', { hasText: new RegExp(`^${esc(name)}$`) }) })
const railRow = (name: string): Locator => rail.getByTestId('category-row').filter({ has: window.locator('.pp-cat-main > span', { hasText: new RegExp(`^${esc(name)}$`) }) })
const railCount = async (name: string): Promise<number> => Number((await railRow(name).locator('em').innerText()).trim())
const railState = (): Promise<[string, number][]> =>
  rail.getByTestId('category-row').evaluateAll((els) => els.map((li) => [li.querySelector('.pp-cat-main > span')!.textContent!, Number(li.querySelector('em')!.textContent)] as [string, number]))
// 操作后左栏要等主进程写完、列表重读才更新：轮询到一致再断言，超时则按最后一次的结果报错
const expectRail = async (expected: [string, number][]): Promise<void> => {
  const deadline = Date.now() + 5000
  let last = await railState()
  while (JSON.stringify(last) !== JSON.stringify(expected) && Date.now() < deadline) {
    await sleep(100)
    last = await railState()
  }
  assert.deepEqual(last, expected)
}
const expectCount = async (name: string, n: number): Promise<void> => {
  const deadline = Date.now() + 5000
  while ((await railCount(name).catch(() => -1)) !== n && Date.now() < deadline) await sleep(100)
  assert.equal(await railCount(name), n, `左栏「${name}」的份数`)
}
const railNames = async (): Promise<string[]> => (await railState()).map(([name]) => name)
const rows = (): Locator => window.getByTestId('paper-row')
const row = (title: string): Locator => rows().filter({ has: window.locator('.pp-title').filter({ hasText: new RegExp(`^${title}$`) }) })
const shownTitles = (): Promise<string[]> => rows().locator('.pp-title').allInnerTexts()
const rowTags = (title: string): Promise<string[]> => row(title).getByTestId('paper-tag').allInnerTexts()
const tagBar = window.locator('.pp-tagbar')
const tagChip = (name: string): Locator => tagBar.locator('.cf-chip').filter({ has: window.locator('span', { hasText: new RegExp(`^${name}$`) }) })
const tagChipCount = async (name: string): Promise<number> => Number((await tagChip(name).locator('em').innerText()).trim())
const headCount = async (): Promise<string> => (await window.locator('.pp-count').innerText()).trim()
const categoryDialog = (name: string) => window.getByRole('dialog', { name })
const toastWith = (text: string | RegExp): Locator => window.getByTestId('toast').filter({ hasText: text })
const apiList = () => window.evaluate(() => window.workbench.papers.list())
const apiCategories = () => window.evaluate(() => window.workbench.papers.listCategories())
const apiTags = () => window.evaluate(() => window.workbench.papers.listTags())
const bulk = window.getByTestId('bulk-bar')
const boxOf = async (locator: Locator) => (await locator.boundingBox())!
// 标签条第一行里每个标签块的位置（收起时第二行以下被裁掉，不算）
const firstRowChips = (): Promise<{ x: number; right: number; y: number; text: string }[]> =>
  tagBar.evaluate((bar) => {
    const top = bar.getBoundingClientRect().top
    return [...bar.querySelectorAll<HTMLElement>('.cf-chip')]
      .map((el) => ({ rect: el.getBoundingClientRect(), text: el.innerText.replace(/\s+/g, '') }))
      .filter((c) => c.rect.top < top + 32)
      .map((c) => ({ x: c.rect.left, right: c.rect.right, y: c.rect.top, text: c.text }))
      .sort((a, b) => a.x - b.x)
  })
const goTo = (page: 'library' | 'papers', paperId?: number | null) =>
  window.evaluate(([p, id]) => window.dispatchEvent(new CustomEvent('ewb-navigate', { detail: { page: p, ...(id === undefined ? {} : { paperId: id }) } })), [page, paperId] as const)
// 试卷库页卸载、编辑器出现才算进了编辑器（新建弹窗里也有「试卷标题」输入框，只等标签会等到弹窗）
const waitEditor = async (): Promise<void> => {
  await window.locator('.pp-page').waitFor({ state: 'detached' })
  await window.getByLabel('试卷标题').waitFor()
}
const backToList = async (): Promise<void> => {
  await goTo('papers', null)
  await rows().first().waitFor()
}
// 经试题库页绕一圈回来，让试卷库页重新挂载、重新读数据（接口改了数据后用）
const reloadList = async (): Promise<void> => {
  await goTo('library')
  await window.locator('.lb-page').waitFor()
  await backToList()
}
const clearToasts = async (): Promise<void> => {
  const close = window.getByRole('button', { name: '关闭提示' })
  while ((await close.count()) > 0) await close.first().click()
}
const rowMenu = async (title: string, item: string): Promise<void> => {
  await row(title).getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: item, exact: true }).click()
}
// 行上「⋯」→「移到分类…」→ 点一个分类
const moveRow = async (title: string, category: string): Promise<void> => {
  await rowMenu(title, '移到分类…')
  const pop = window.getByRole('dialog', { name: '移到分类' })
  await pop.getByRole('button', { name: category, exact: true }).click()
  await pop.waitFor({ state: 'detached' })
}
const createCategory = async (name: string): Promise<void> => {
  await rail.getByRole('button', { name: '新建分类', exact: true }).click()
  const dlg = categoryDialog('新建分类')
  await dlg.getByLabel('分类名称').fill(name)
  await dlg.getByRole('button', { name: '创建', exact: true }).click()
  await dlg.waitFor({ state: 'detached' })
}
const pickerPopover = window.getByRole('dialog', { name: '打标签' })
const checkRow = (title: string): Locator => row(title).getByRole('checkbox')
// 记下每份试卷的修改时间与版本状态，用来证明归类操作没有动它们
const stamp = async (): Promise<Map<number, string>> => new Map((await apiList()).map((p) => [p.id, `${p.updatedAt}|${p.latestVersionNo}|${p.draftDirty}`]))
const continueTitle = async (): Promise<string> => (await window.getByRole('button', { name: /继续上次编辑/ }).getAttribute('title')) ?? ''

const T = {
  unit: '七年级数学第一单元测试',
  mid: '七年级数学期中考试',
  en1: '七年级英语周测1',
  en2: '七年级英语周测2',
  phy: '八年级物理作业',
  draft: '未整理的草稿卷'
}
const LONG_CATEGORY = Array.from('七年级上册第一学期期中期末综合复习阶段检测汇总卷分类名称三十字').slice(0, 30).join('')
const LONG_TAG = Array.from('七年级上册第一单元月考易错题整理汇总再加一点').slice(0, 20).join('')
assert.equal(Array.from(LONG_CATEGORY).length, 30)
assert.equal(Array.from(LONG_TAG).length, 20)

try {
  await resize(app, window, 1440, 900)

  // ---------- 造数据：六份试卷，前三份放了题，第一份存过一个版本且草稿没动 ----------
  const questions = await window.evaluate(() => window.workbench.library.listQuestions({ limit: 100 }).then((p) => p.items))
  assert.equal(questions.length, 6)
  const item = (q: (typeof questions)[number], id: string) => ({ id, originQuestionId: q.id, sourceLabel: q.sourceLabel, questionType: q.questionType, numberCount: q.numberCount, stemHtml: q.stemHtml, answerHtml: q.answerHtml })
  const ids: Record<string, number> = {}
  for (const [i, title] of Object.values(T).entries()) {
    ids[title] = await window.evaluate((t) => window.workbench.papers.create(t), title)
    if (i < 3) {
      const picks = questions.slice(i, i + 3)
      await window.evaluate(
        async ([paperId, its]) => {
          await window.workbench.papers.saveEdits(paperId as number, { draft: { sections: [{ id: 's1', title: '选择题', defaultScore: 4, items: its as never }] } })
        },
        [ids[title], picks.map((q, k) => item(q, `i${i}-${k}`))] as const
      )
    }
    await sleep(8) // 修改时间精确到毫秒，错开一点保证顺序确定
  }
  await window.evaluate((id) => window.workbench.papers.saveVersion(id, ''), ids[T.unit])
  await reloadList()

  // ================================================================== P1 分类栏、P6 常用名
  await expectRail([['全部', 6], ['未分类', 6]])
  assert.equal(await window.locator('.pp-count').innerText(), '共 6 份')
  await shots('papers-01-initial')
  ok('P1：没有分类时左栏只有「全部 6」「未分类 6」和「新建分类」')

  await rail.getByRole('button', { name: '新建分类', exact: true }).click()
  const createDlg = categoryDialog('新建分类')
  await createDlg.getByRole('button', { name: '选用常用分类名' }).click()
  assert.deepEqual(
    (await window.getByRole('menuitem').allInnerTexts()).map((t) => t.trim()),
    [...CATEGORY_PRESETS]
  )
  await shots('papers-02-create-presets', NARROW, true)
  await window.getByRole('menuitem', { name: '周测', exact: true }).click()
  assert.equal(await createDlg.getByLabel('分类名称').inputValue(), '周测')
  await createDlg.getByRole('button', { name: '创建', exact: true }).click()
  await createDlg.waitFor({ state: 'detached' })
  await expectRail([['全部', 6], ['周测', 0], ['未分类', 6]])
  ok(`P6：「常用名」下拉列出 ${CATEGORY_PRESETS.join('、')}，选「周测」填进输入框，创建后左栏出现「周测 0」`)

  // 已建过的常用名不再列；也可直接输入
  await rail.getByRole('button', { name: '新建分类', exact: true }).click()
  await categoryDialog('新建分类').getByRole('button', { name: '选用常用分类名' }).click()
  assert.deepEqual(
    (await window.getByRole('menuitem').allInnerTexts()).map((t) => t.trim()),
    CATEGORY_PRESETS.filter((p) => p !== '周测')
  )
  await window.keyboard.press('Escape')
  ok('P6：已建过的「周测」不再出现在常用名下拉里')

  // 重名、全角空格、英文大小写：接口的中文原因原样显示，弹窗不关
  const nameField = createDlg.getByLabel('分类名称')
  const createBtn = createDlg.getByRole('button', { name: '创建', exact: true })
  await nameField.fill('周测')
  await createBtn.click()
  await createDlg.getByRole('alert').filter({ hasText: '已有分类「周测」' }).waitFor()
  await nameField.fill('　周测　')
  await createBtn.click()
  await createDlg.getByRole('alert').filter({ hasText: '已有分类「周测」' }).waitFor()
  assert.equal(await createDlg.getByLabel('分类名称').getAttribute('aria-invalid'), 'true')
  await shot(window, 'papers-03-create-duplicate-1440x900')
  await nameField.fill('Quiz')
  await createBtn.click()
  await createDlg.waitFor({ state: 'detached' })
  await rail.getByRole('button', { name: '新建分类', exact: true }).click()
  await nameField.fill('quiz')
  await createBtn.click()
  await createDlg.getByRole('alert').filter({ hasText: /已有分类/ }).waitFor()
  // 空名、纯空白：不能提交
  await nameField.fill('　 　')
  assert.equal(await createBtn.isDisabled(), true)
  // 31 字：不静默截断，提示并禁止提交
  await nameField.fill(LONG_CATEGORY + '字')
  await createDlg.getByRole('alert').filter({ hasText: '分类名最多 30 字' }).waitFor()
  assert.equal(await createBtn.isDisabled(), true)
  await shot(window, 'papers-04-create-too-long-1440x900')
  // 30 字：可以
  await nameField.fill(LONG_CATEGORY)
  assert.equal(await createBtn.isDisabled(), false)
  await createBtn.click()
  await createDlg.waitFor({ state: 'detached' })
  // 名称里的 HTML、表情：按文字显示，不当标签解析
  const HTML_NAME = '<img src=x onerror=1>😀'
  await createCategory(HTML_NAME)
  await railRow(HTML_NAME).waitFor()
  assert.equal(await rail.locator('img').count(), 0, '分类名里的 <img> 不会变成图片')
  assert.equal(await rail.locator('.pp-cat-main > span').filter({ hasText: HTML_NAME }).count(), 1)
  await railRow(HTML_NAME).getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '删除', exact: true }).click()
  await window.getByRole('dialog', { name: /^删除分类「/ }).getByRole('button', { name: '删除', exact: true }).click()
  await railRow(HTML_NAME).waitFor({ state: 'detached' })
  // 用常用名再建两个
  for (const preset of ['单元测试', '期中']) {
    await rail.getByRole('button', { name: '新建分类', exact: true }).click()
    await createDlg.getByRole('button', { name: '选用常用分类名' }).click()
    await window.getByRole('menuitem', { name: preset, exact: true }).click()
    await createBtn.click()
    await createDlg.waitFor({ state: 'detached' })
  }
  assert.deepEqual(await railNames(), ['全部', '周测', 'Quiz', LONG_CATEGORY, '单元测试', '期中', '未分类'])
  assert.deepEqual(
    (await apiCategories()).map((c) => c.name),
    ['周测', 'Quiz', LONG_CATEGORY, '单元测试', '期中']
  )
  ok('P1：重名（含全角空格、英文大小写）显示接口的中文原因且弹窗不关；空名与 31 字不能提交；30 字可以；新建的分类按顺序排在左栏')

  // ================================================================== P3 行内移到分类、P5 不动修改时间
  let before = await stamp()
  const lastBefore = await continueTitle()
  assert.equal(lastBefore, `继续编辑《${T.draft}》`)
  const orderBefore = await shownTitles()

  await row(T.unit).getByRole('button', { name: /更多操作/ }).click()
  assert.deepEqual(
    (await window.getByRole('menuitem').allInnerTexts()).map((t) => t.trim()),
    ['重命名', '另存为新试卷', '移到分类…', '标签…', '删除']
  )
  await shot(window, 'papers-05-row-menu-1440x900')
  await window.getByRole('menuitem', { name: '移到分类…', exact: true }).click()
  const movePop = window.getByRole('dialog', { name: '移到分类' })
  await movePop.waitFor()
  assert.deepEqual(
    (await movePop.getByRole('button').allInnerTexts()).map((t) => t.trim()),
    ['周测', 'Quiz', LONG_CATEGORY, '单元测试', '期中', '未分类']
  )
  assert.equal(await movePop.getByRole('button', { name: '未分类', exact: true }).getAttribute('aria-pressed'), 'true', '当前所在的分类打勾')
  await shots('papers-06-move-popover', NARROW, true)
  await movePop.getByRole('button', { name: '单元测试', exact: true }).click()
  await movePop.waitFor({ state: 'detached' })
  await toastWith(`已将「${T.unit}」移到分类「单元测试」`).waitFor()
  await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('更多操作') === true)
  // 键盘：Esc 关掉小框，焦点回到这一行的「⋯」
  await rowMenu(T.mid, '移到分类…')
  await movePop.waitFor()
  await window.keyboard.press('Escape')
  await movePop.waitFor({ state: 'detached' })
  await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('七年级数学期中考试') === true && document.activeElement?.getAttribute('aria-label')?.includes('更多操作') === true)
  await moveRow(T.mid, '期中')
  await moveRow(T.phy, LONG_CATEGORY)
  await expectRail([['全部', 6], ['周测', 0], ['Quiz', 0], [LONG_CATEGORY, 1], ['单元测试', 1], ['期中', 1], ['未分类', 3]])
  ok('P3：行菜单「移到分类…」弹出分类列表（当前所在的打勾），选一个即移入，提示条写明去向，焦点回到「⋯」；左栏份数同步')

  // ================================================================== P3 批量：操作条替换表头
  const theadBox = async () => ({ head: await window.locator('.pp-thead').boundingBox(), list: await window.locator('.pp-list').boundingBox(), first: await rows().first().boundingBox() })
  const beforeBulk = await theadBox()
  await checkRow(T.en1).check()
  await bulk.waitFor()
  const afterFirst = await theadBox()
  assert.deepEqual(afterFirst, beforeBulk, '勾选第一份：表头、列表、第一行的位置与尺寸都不变，列表不被推下去')
  assert.equal(await window.locator('.pp-thead .pp-bulk').count(), 1, '操作条在表头那一行里')
  assert.equal(await window.locator('.pp-thead').evaluate((el) => el.classList.contains('is-bulk')), true)
  assert.equal(await window.locator('.pp-thead').getByText('题数 · 分值').count(), 0, '表头文字被操作条替换')
  await checkRow(T.en2).check()
  assert.equal((await bulk.getByText(/已选/).innerText()).trim(), '已选 2 份')
  await shots('papers-07-bulk-bar')
  await bulk.getByRole('button', { name: '移到分类', exact: true }).click()
  assert.deepEqual(
    (await window.getByRole('menuitem').allInnerTexts()).map((t) => t.trim()),
    ['周测', 'Quiz', LONG_CATEGORY, '单元测试', '期中', '未分类']
  )
  await window.getByRole('menuitem', { name: '周测', exact: true }).click()
  await toastWith('已将 2 份试卷移到分类「周测」').waitFor()
  await expectRail([['全部', 6], ['周测', 2], ['Quiz', 0], [LONG_CATEGORY, 1], ['单元测试', 1], ['期中', 1], ['未分类', 1]])
  ok('P3：勾选两份 →「移到分类」→「周测」，左栏周测 2、未分类 1')

  // 在「全部」下每行显示所属分类名
  assert.equal((await row(T.unit).getByTestId('paper-category').innerText()).trim(), '单元测试')
  assert.equal((await row(T.phy).getByTestId('paper-category').innerText()).trim(), LONG_CATEGORY)
  assert.equal(await row(T.draft).getByTestId('paper-category').count(), 0, '未分类的试卷不写分类名')
  await clearToasts()
  await shots('papers-08-all-with-categories')
  ok('P1：在「全部」下，行上显示所属分类名（30 字分类名省略显示）；未分类的行不写')

  // ================================================================== P5 顺序、修改时间、版本状态、继续上次编辑
  const after = await stamp()
  assert.deepEqual([...after], [...before], '所有试卷的修改时间、最新版本、草稿改动状态都没变')
  assert.deepEqual(await shownTitles(), orderBefore, '归类后列表顺序不变（仍按修改时间）')
  assert.equal(await continueTitle(), lastBefore, '「继续上次编辑」不变')
  assert.equal(await row(T.unit).locator('.ui-tag').count(), 0, '存过版本的试卷归类后没有「有改动未存为版本」')
  await row(T.unit).getByRole('button', { name: '打开', exact: true }).click()
  await waitEditor()
  assert.equal(await window.getByTestId('dirty-tag').count(), 0, '编辑器里也没有「有改动未存为版本」')
  await backToList()
  before = await stamp() // 编辑器自己的保存另算，后面的对比从这里起
  ok('P5：移到分类后所有试卷的修改时间与版本状态不变、列表顺序不变、「继续上次编辑」不变、编辑器里不出现「有改动未存为版本」')

  // ================================================================== P1 切换分类、份数、搜索
  await railButton('周测').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 2)
  assert.deepEqual(await shownTitles(), [T.en2, T.en1])
  assert.equal(await headCount(), '筛出 2 份，共 6 份')
  assert.equal(await rows().getByTestId('paper-category').count(), 0, '在某个分类下不重复写分类名')
  assert.equal(await railButton('周测').getAttribute('aria-pressed'), 'true')
  await shots('papers-09-category-view')
  await railButton('未分类').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 1)
  assert.deepEqual(await shownTitles(), [T.draft])
  await railButton('全部').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 6)
  // 分类与标题搜索同时生效
  await railButton('周测').click()
  await window.getByLabel('搜索试卷').fill('周测1')
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 1)
  assert.deepEqual(await shownTitles(), [T.en1])
  await window.getByLabel('搜索试卷').fill('数学')
  await window.getByText('没有符合条件的试卷').waitFor()
  assert.match(await window.locator('.ui-empty-desc').innerText(), /分类「周测」，标题含「数学」/)
  await window.getByRole('button', { name: '清除筛选', exact: true }).click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 2)
  assert.equal(await window.getByLabel('搜索试卷').inputValue(), '')
  assert.equal(await railButton('周测').getAttribute('aria-pressed'), 'true', '清除筛选不改当前分类')
  ok('P1：点「周测」只看 2 份并写明「筛出 2 份，共 6 份」；「未分类」「全部」可切回；分类与标题搜索同时生效，无结果写出条件并可清除')

  // ================================================================== P4 在分类下新建直接归入
  const periodId = (await apiCategories()).find((c) => c.name === '周测')!.id
  await window.getByRole('button', { name: '新建试卷', exact: true }).click()
  const newDlg = window.getByRole('dialog', { name: '新建试卷' })
  await newDlg.getByText('新试卷归入分类「周测」。').waitFor()
  await newDlg.getByLabel('试卷标题').fill('周测3')
  await newDlg.getByRole('button', { name: '创建并打开', exact: true }).click()
  await waitEditor()
  const created = (await apiList()).find((p) => p.title === '周测3')!
  assert.equal(created.categoryId, periodId, '在「周测」下新建的试卷归入「周测」')
  await backToList()
  assert.equal(await railButton('周测').getAttribute('aria-pressed'), 'true', '从编辑器回来仍在「周测」')
  assert.deepEqual(await shownTitles(), ['周测3', T.en2, T.en1])
  assert.equal(await continueTitle(), '继续编辑《周测3》', '新建的试卷是最近修改的')
  ok('P4：在「周测」下新建「周测3」直接归入周测（接口核对），编辑器回来仍停在「周测」，周测 3 份')

  for (const [view, title] of [['全部', '全部下新建'], ['未分类', '未分类下新建']] as const) {
    await railButton(view).click()
    await window.getByRole('button', { name: '新建试卷', exact: true }).click()
    assert.equal(await window.getByRole('dialog', { name: '新建试卷' }).getByText(/归入分类/).count(), 0)
    await window.getByRole('dialog', { name: '新建试卷' }).getByLabel('试卷标题').fill(title)
    await window.getByRole('dialog', { name: '新建试卷' }).getByRole('button', { name: '创建并打开', exact: true }).click()
    await waitEditor()
    const made = (await apiList()).find((p) => p.title === title)!
    assert.equal(made.categoryId, null, `在「${view}」下新建不归类`)
    await window.evaluate((id) => window.workbench.papers.remove(id), made.id)
    await backToList()
  }
  await expectRail([['全部', 7], ['周测', 3], ['Quiz', 0], [LONG_CATEGORY, 1], ['单元测试', 1], ['期中', 1], ['未分类', 1]])
  ok('P4：在「全部」「未分类」下新建的试卷不归类')

  // ================================================================== P2/P3 标签
  await railButton('全部').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 7)
  assert.equal((await tagBar.innerText()).replace(/\s+/g, ''), '标签还没有标签，在试卷的「⋯›标签…」里新建')
  assert.equal(await tagBar.getByRole('button').count(), 0, '没有标签时标签条里没有按钮')
  await shots('papers-10-tagbar-empty', NARROW)
  await rowMenu(T.en1, '标签…')
  await pickerPopover.waitFor()
  const picker = pickerPopover.getByLabel('搜索或新建标签')
  await picker.fill('易错')
  await pickerPopover.getByText('新建「易错」').waitFor()
  await picker.press('Enter')
  await row(T.en1).getByTestId('paper-tag').filter({ hasText: '易错' }).waitFor()
  assert.deepEqual((await apiTags()).map((t) => t.name), ['易错'])
  // 同名（不分大小写、全角空格按半角）不新建，直接勾上
  await picker.fill('期中复习')
  await picker.press('Enter')
  await row(T.en1).getByTestId('paper-tag').filter({ hasText: '期中复习' }).waitFor()
  assert.deepEqual((await rowTags(T.en1)).sort(), ['易错', '期中复习'].sort())
  await shots('papers-11-tag-picker', NARROW, true)
  await window.keyboard.press('Escape')
  await pickerPopover.waitFor({ state: 'detached' })
  // 小框开着时点一下不弹提示；关上后汇总成一条（S8）
  const tagToasts = (): Locator => window.getByTestId('toast').filter({ hasText: /打上|去掉/ })
  await clearToasts()
  assert.equal(await tagToasts().count(), 0)
  // 另外几份：易错 → 第一单元；期中复习 → 期中考试
  await rowMenu(T.unit, '标签…')
  await pickerPopover.locator('.cf-prow').filter({ hasText: '易错' }).click()
  await row(T.unit).getByTestId('paper-tag').filter({ hasText: '易错' }).waitFor()
  assert.equal(await tagToasts().count(), 0, '小框开着：点一下不弹提示')
  await window.keyboard.press('Escape')
  await toastWith(`已给「${T.unit}」打上「易错」`).waitFor()
  assert.equal(await tagToasts().count(), 1, '关上后只有一条汇总提示')
  await clearToasts()
  await rowMenu(T.mid, '标签…')
  await pickerPopover.locator('.cf-prow').filter({ hasText: '期中复习' }).click()
  await row(T.mid).getByTestId('paper-tag').filter({ hasText: '期中复习' }).waitFor()
  // 再点一次取消、再点一次打上：最终只有「打上」一件事
  await pickerPopover.locator('.cf-prow').filter({ hasText: '期中复习' }).click()
  await row(T.mid).getByTestId('paper-tag').waitFor({ state: 'detached' })
  await pickerPopover.locator('.cf-prow').filter({ hasText: '期中复习' }).click()
  await row(T.mid).getByTestId('paper-tag').filter({ hasText: '期中复习' }).waitFor()
  assert.equal(await tagToasts().count(), 0)
  await window.keyboard.press('Escape')
  await toastWith(`已给「${T.mid}」打上「期中复习」`).waitFor()
  assert.equal(await tagToasts().count(), 1)
  await clearToasts()
  // 点了又点回原样：没有净改动，不弹提示
  await rowMenu(T.mid, '标签…')
  await pickerPopover.locator('.cf-prow').filter({ hasText: '期中复习' }).click()
  await row(T.mid).getByTestId('paper-tag').waitFor({ state: 'detached' })
  await pickerPopover.locator('.cf-prow').filter({ hasText: '期中复习' }).click()
  await row(T.mid).getByTestId('paper-tag').filter({ hasText: '期中复习' }).waitFor()
  await window.keyboard.press('Escape')
  await pickerPopover.waitFor({ state: 'detached' })
  await window.waitForTimeout(400)
  assert.equal(await tagToasts().count(), 0, '没有净改动：不弹提示')
  // 物理作业批量打「易错」
  await checkRow(T.phy).check()
  await bulk.getByRole('button', { name: '打标签', exact: true }).click()
  await pickerPopover.locator('.cf-prow').filter({ hasText: '易错' }).click()
  await row(T.phy).getByTestId('paper-tag').filter({ hasText: '易错' }).waitFor()
  assert.equal(await tagToasts().count(), 0, '批量的小框开着：点一下不弹提示')
  await window.keyboard.press('Escape')
  await toastWith(`已给「${T.phy}」打上「易错」`).waitFor()
  await bulk.getByRole('button', { name: '取消选择', exact: true }).click()
  await bulk.waitFor({ state: 'detached' })
  assert.deepEqual(await rowTags(T.unit), ['易错'])
  assert.deepEqual(await rowTags(T.mid), ['期中复习'])
  assert.deepEqual(await rowTags(T.phy), ['易错'])
  assert.equal(await tagChipCount('易错'), 3)
  assert.equal(await tagChipCount('期中复习'), 2)
  ok('P2/P3：行菜单「标签…」弹出 TagPicker，输入新名回车即新建并打上、同名直接勾上、再点取消；标签条出现「易错 3」「期中复习 2」')

  // 打标签不动修改时间与顺序
  const afterTags = await stamp()
  for (const [id, value] of before) assert.equal(afterTags.get(id), value, `试卷 ${id} 打标签后修改时间与版本状态不变`)
  ok('P5：打标签后原有六份试卷的修改时间与版本状态不变')

  // 筛选：标签并集，与分类、搜索同时生效
  await clearToasts()
  await tagChip('易错').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 3)
  assert.deepEqual(await shownTitles(), [T.phy, T.en1, T.unit])
  assert.equal(await headCount(), '筛出 3 份，共 7 份')
  await tagChip('期中复习').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 4)
  assert.deepEqual(await shownTitles(), [T.phy, T.en1, T.mid, T.unit], '多选取并集')
  // 「清除」「管理标签」在标签行的右端：标签 → 一排标签 → 清除 → 管理标签，同一行，管理标签贴着右边
  const labelBox = await boxOf(tagBar.locator('.cf-title'))
  const rowChips = await firstRowChips()
  const firstChipBox = { x: rowChips[0].x, y: rowChips[0].y, width: rowChips[0].right - rowChips[0].x, height: 28 }
  const lastChipBox = { x: rowChips.at(-1)!.x, y: rowChips.at(-1)!.y, width: rowChips.at(-1)!.right - rowChips.at(-1)!.x, height: 28 }
  const clearBox = await boxOf(tagBar.locator('.cf-clear'))
  const manageBox = await boxOf(tagBar.getByRole('button', { name: '管理标签', exact: true }))
  const barBox = await boxOf(tagBar)
  assert.ok(labelBox.x + labelBox.width <= firstChipBox.x, '「标签」在最左')
  assert.ok(lastChipBox.x + lastChipBox.width <= clearBox.x, `「清除」在标签后面，不贴着「标签」二字：清除 x=${clearBox.x}，最后一个标签右边=${lastChipBox.x + lastChipBox.width}`)
  assert.ok(clearBox.x + clearBox.width <= manageBox.x, '「清除」在「管理标签」左边')
  assert.ok(Math.abs(clearBox.y + clearBox.height / 2 - (firstChipBox.y + firstChipBox.height / 2)) < 6 && Math.abs(manageBox.y + manageBox.height / 2 - (firstChipBox.y + firstChipBox.height / 2)) < 6, '同一行')
  const gapRight = barBox.x + barBox.width - 24 - (manageBox.x + manageBox.width)
  assert.ok(Math.abs(gapRight) < 3, `「管理标签」贴着行的右端：差 ${gapRight}px`)
  await shots('papers-12-tag-filter-union')
  await railButton('周测').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 1)
  assert.deepEqual(await shownTitles(), [T.en1])
  assert.equal(await tagChipCount('易错'), 1, '标签份数按当前分类算')
  assert.equal(await tagChipCount('期中复习'), 1)
  await railButton('期中').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 1)
  assert.deepEqual(await shownTitles(), [T.mid])
  assert.equal(await tagChipCount('易错'), 0, '期中分类里没有带「易错」的试卷：份数为 0')
  await railButton('周测').click()
  await window.getByLabel('搜索试卷').fill('周测2')
  await window.getByText('没有符合条件的试卷').waitFor()
  assert.match(await window.locator('.ui-empty-desc').innerText(), /分类「周测」，标签「易错」「期中复习」，标题含「周测2」/)
  await shots('papers-13-no-result')
  await window.getByRole('button', { name: '清除筛选', exact: true }).click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 3)
  assert.equal(await tagChip('易错').getAttribute('aria-pressed'), 'false')
  assert.equal(await railButton('周测').getAttribute('aria-pressed'), 'true')
  ok('P2：标签多选取并集（易错 + 期中复习 = 4 份），与当前分类、标题搜索同时生效；标签份数按当前分类算；无结果写出三个条件，清除筛选只清标签与搜索')

  // ================================================================== P2 标签名边界
  await railButton('全部').click()
  await rowMenu(T.en2, '标签…')
  await picker.fill(LONG_TAG + '多')
  await pickerPopover.getByRole('alert').filter({ hasText: '标签名最多 20 字' }).waitFor()
  assert.equal(await pickerPopover.getByText(/^新建「/).count(), 0, '超过 20 字不能新建')
  await picker.fill(LONG_TAG)
  await picker.press('Enter')
  await row(T.en2).getByTestId('paper-tag').first().waitFor()
  await picker.fill('易错　题')
  await pickerPopover.getByText('新建「易错 题」').waitFor()
  await picker.press('Enter')
  await row(T.en2).getByTestId('paper-tag').filter({ hasText: '易错 题' }).waitFor()
  assert.deepEqual((await apiTags()).map((t) => t.name).sort(), ['易错', '易错 题', '期中复习', LONG_TAG].sort())
  // 标签名里的 HTML、表情：按文字显示
  const HOSTILE = '<b onclick=1>x</b>😀'
  await picker.fill(HOSTILE)
  await picker.press('Enter')
  await row(T.en2).getByTestId('paper-tag').filter({ hasText: HOSTILE }).waitFor()
  assert.equal(await row(T.en2).locator('b').count(), 0, '标签名里的 <b> 不会被当成标签')
  await window.keyboard.press('Escape')
  const hostile = (await apiTags()).find((t) => t.name === HOSTILE)!
  await window.evaluate((id) => window.workbench.papers.deleteTag(id), hostile.id)
  await reloadList()
  await shots('papers-14-long-names')
  ok('P2：标签名 20 字可以、21 字不能新建（提示「标签名最多 20 字」）、全角空格按半角规整成「易错 题」；20 字标签在行上省略显示')

  // ================================================================== P3 批量：半选、补齐、去标签、勾选只对眼前的试卷生效
  await checkRow(T.en1).check()
  await checkRow(T.en2).check()
  assert.equal((await bulk.getByText(/已选/).innerText()).trim(), '已选 2 份')
  await bulk.getByRole('button', { name: '打标签', exact: true }).click()
  await pickerPopover.locator('.cf-prow').filter({ hasText: '易错' }).first().waitFor()
  const rowState = async (name: string): Promise<string | null> => pickerPopover.locator('.cf-prow').filter({ has: window.locator('.cf-prow-name', { hasText: new RegExp(`^${name}$`) }) }).getAttribute('aria-checked')
  assert.equal(await rowState('易错'), 'mixed', '只有一份有的标签显示半选')
  assert.equal(await rowState('期中复习'), 'mixed')
  // 行上的数是「所选试卷里有几份」，不是全库份数
  const pickCount = (name: string): Promise<string> => pickerPopover.locator('.cf-prow').filter({ has: window.locator('.cf-prow-name', { hasText: new RegExp(`^${name}$`) }) }).locator('em').innerText()
  assert.equal(await pickCount('易错'), '1', '所选 2 份里 1 份带「易错」（全库有 3 份）')
  assert.equal(await pickCount('期中复习'), '1')
  assert.equal(await pickerPopover.locator('.cf-prow--new').count(), 0)
  await shots('papers-15-bulk-picker-mixed', NARROW, true)
  await pickerPopover.locator('.cf-prow').filter({ has: window.locator('.cf-prow-name', { hasText: /^易错$/ }) }).click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length > 0)
  await row(T.en2).getByTestId('paper-tag').filter({ hasText: /^易错$/ }).waitFor()
  assert.equal(await rowState('易错'), 'true', '点半选的标签补齐到全部所选试卷')
  assert.equal(await pickCount('易错'), '2')
  assert.equal(await tagToasts().count(), 0, '小框开着不弹提示')
  await window.keyboard.press('Escape')
  await toastWith('已给 2 份试卷打上「易错」').waitFor()
  await clearToasts()
  // 去标签：同一个 TagPicker，只列所选试卷里带着的标签，没有「新建」
  await bulk.getByRole('button', { name: '去标签', exact: true }).click()
  const removePopover = window.getByRole('dialog', { name: '去标签' })
  await removePopover.waitFor()
  const removeNames = await removePopover.locator('.cf-prow .cf-prow-name').allInnerTexts()
  assert.deepEqual(removeNames.sort(), ['易错', '期中复习', '易错 题', LONG_TAG].sort(), '只列所选两份带着的标签')
  const removeCount = (name: string): Promise<string> => removePopover.locator('.cf-prow').filter({ has: window.locator('.cf-prow-name', { hasText: new RegExp(`^${name}$`) }) }).locator('em').innerText()
  assert.equal(await removeCount('易错'), '2')
  assert.equal(await removeCount('期中复习'), '1')
  const removeSearch = removePopover.getByLabel('搜索或新建标签')
  assert.equal(await removeSearch.getAttribute('placeholder'), '搜索标签')
  await shots('papers-15b-bulk-remove-picker', NARROW, true)
  await removeSearch.fill('不存在的新标签')
  assert.equal(await removePopover.getByText(/^新建「/).count(), 0, '去标签里没有「新建」')
  await removeSearch.press('Enter')
  assert.equal((await apiTags()).some((t) => t.name === '不存在的新标签'), false, '回车也建不出标签')
  await removePopover.getByText('没有匹配的标签').waitFor()
  await shots('papers-15b2-bulk-remove-no-create', NARROW, true)
  await removeSearch.fill('')
  await removePopover.locator('.cf-prow').filter({ has: window.locator('.cf-prow-name', { hasText: /^易错$/ }) }).click()
  await row(T.en1).getByTestId('paper-tag').filter({ hasText: /^易错$/ }).waitFor({ state: 'detached' })
  assert.equal(await tagToasts().count(), 0, '去标签的小框开着：不弹提示')
  assert.equal(await removePopover.locator('.cf-prow .cf-prow-name', { hasText: /^易错$/ }).count(), 0, '去掉后这个标签从列表里消失')
  await window.keyboard.press('Escape')
  await toastWith('已从 2 份试卷去掉标签「易错」').waitFor()
  assert.ok(!(await rowTags(T.en1)).includes('易错') && !(await rowTags(T.en2)).includes('易错'))
  assert.ok((await rowTags(T.unit)).includes('易错'), '没勾选的试卷不受影响')
  // 所选的试卷都没有标签：去标签的小框写明，且仍然没有「新建」
  await bulk.getByRole('button', { name: '取消选择', exact: true }).click()
  await checkRow(T.draft).check()
  await bulk.getByRole('button', { name: '去标签', exact: true }).click()
  await removePopover.waitFor()
  assert.equal((await removePopover.locator('.cf-picker-empty').innerText()).trim(), '所选试卷都没有标签')
  assert.equal(await removePopover.locator('.cf-prow').count(), 0)
  await shots('papers-15c-bulk-remove-empty', NARROW, true)
  await window.keyboard.press('Escape')
  await bulk.getByRole('button', { name: '取消选择', exact: true }).click()
  await checkRow(T.en1).check()
  await checkRow(T.en2).check()
  ok('P3：批量打标签（行上的数是所选里有几份，半选点一下补齐）、去标签（同一个 TagPicker，只列所选里带着的标签、没有「新建」、所选都没有标签时写明）；小框开着不弹提示，关上汇总一条；没勾选的试卷不受影响')

  // 勾选只对眼前列表生效：换了范围，看不见的试卷不会被操作
  assert.equal((await bulk.getByText(/已选/).innerText()).trim(), '已选 2 份')
  await railButton('未分类').click()
  await bulk.waitFor({ state: 'detached' })
  await railButton('周测').click()
  await bulk.waitFor()
  assert.equal((await bulk.getByText(/已选/).innerText()).trim(), '已选 2 份', '回到原来的范围，勾选还在')
  await railButton('单元测试').click()
  await bulk.waitFor({ state: 'detached' })
  await clearToasts()
  await railButton('全部').click()
  await bulk.getByRole('button', { name: '取消选择', exact: true }).click()
  // 全选
  const all = window.getByRole('checkbox', { name: '选择列表里的全部试卷' })
  await all.check()
  assert.equal((await bulk.getByText(/已选/).innerText()).trim(), '已选 7 份')
  await checkRow(T.draft).uncheck()
  assert.equal((await bulk.getByText(/已选/).innerText()).trim(), '已选 6 份')
  assert.equal(await all.evaluate((el: HTMLInputElement) => el.indeterminate), true, '部分勾选时表头显示半选')
  await all.check()
  await bulk.getByRole('button', { name: '取消选择', exact: true }).click()
  assert.equal(await window.getByRole('checkbox', { checked: true }).count(), 0)
  ok('P3：勾选只对眼前列表生效（换分类后操作条消失，回来还在）；表头全选 / 半选；取消选择清空')

  // ================================================================== P2 管理标签
  await clearToasts()
  await tagBar.getByRole('button', { name: '管理标签', exact: true }).click()
  const manager = window.getByRole('dialog', { name: '管理试卷标签' })
  await manager.waitFor()
  assert.deepEqual(
    (await manager.locator('.cf-mrow .cf-mname').allInnerTexts()).sort(),
    ['易错', '易错 题', '期中复习', LONG_TAG].sort()
  )
  await shots('papers-16-tag-manager', NARROW)
  // 改名：「期中复习」改成「易错」→ 并入已有标签
  await manager.getByRole('button', { name: '改名：期中复习', exact: true }).click()
  await manager.getByLabel('标签「期中复习」的新名称').fill('易错')
  await manager.getByLabel('标签「期中复习」的新名称').press('Enter')
  const mergeDlg = window.getByRole('dialog', { name: '并入标签「易错」' })
  await mergeDlg.waitFor()
  assert.match(await mergeDlg.innerText(), /「期中复习」将并入「易错」，原来带「期中复习」的 2 份试卷都会带上「易错」，「期中复习」随后删除。/)
  await mergeDlg.getByRole('button', { name: '并入', exact: true }).click()
  await mergeDlg.waitFor({ state: 'detached' })
  await window.waitForFunction(() => [...document.querySelectorAll('[data-testid="paper-tag"]')].every((el) => el.textContent !== '期中复习'))
  assert.deepEqual((await apiTags()).map((t) => t.name).sort(), ['易错', '易错 题', LONG_TAG].sort())
  assert.ok((await rowTags(T.mid)).includes('易错'))
  assert.ok((await rowTags(T.en1)).includes('易错'))
  // 改名：「易错」→「易错题」
  await manager.getByRole('button', { name: '改名：易错', exact: true }).click()
  await manager.getByLabel('标签「易错」的新名称').fill('易错题')
  await manager.getByLabel('标签「易错」的新名称').press('Enter')
  await window.waitForFunction(() => [...document.querySelectorAll('[data-testid="paper-tag"]')].some((el) => el.textContent === '易错题'))
  // 删除正在使用的标签：先筛选到它，再删，筛选随之失效
  await manager.getByRole('button', { name: '关闭', exact: true }).first().click()
  await manager.waitFor({ state: 'detached' })
  await tagChip('易错题').click()
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 4)
  const usedBy = (await apiList()).filter((p) => p.tags.some((t) => t.name === '易错题')).length
  assert.equal(usedBy, 4, '「期中复习」并入后，第一单元、物理作业、周测1、期中考试都带「易错题」')
  await tagBar.getByRole('button', { name: '管理标签', exact: true }).click()
  await manager.getByRole('button', { name: '删除：易错题', exact: true }).click()
  const delTag = window.getByRole('dialog', { name: '删除标签「易错题」' })
  assert.match(await delTag.innerText(), /4 份试卷会去掉这个标签，试卷本身不受影响。/)
  await delTag.getByRole('button', { name: '删除', exact: true }).click()
  await delTag.waitFor({ state: 'detached' })
  await manager.getByRole('button', { name: '关闭', exact: true }).first().click()
  await manager.waitFor({ state: 'detached' })
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="paper-row"]').length === 7)
  assert.deepEqual((await apiTags()).map((t) => t.name).sort(), ['易错 题', LONG_TAG].sort())
  assert.equal(await tagBar.locator('.cf-chip[aria-pressed="true"]').count(), 0, '被删标签的筛选随之失效')
  assert.equal(await headCount(), '共 7 份')
  ok('P2：管理标签——改成已有名称先确认再并入（行上标签同步）、普通改名、删除正在使用的标签（写明 4 份试卷）后筛选失效、列表回到全部')

  // ================================================================== P4 另存为新试卷继承分类与标签
  await rowMenu(T.en1, '标签…')
  await pickerPopover.getByLabel('搜索或新建标签').fill('易错 题')
  await pickerPopover.getByLabel('搜索或新建标签').press('Enter')
  await row(T.en1).getByTestId('paper-tag').filter({ hasText: '易错 题' }).waitFor()
  await window.keyboard.press('Escape')
  const en1Before = (await apiList()).find((p) => p.title === T.en1)!
  await rowMenu(T.en1, '另存为新试卷')
  const copyTitle = `${T.en1}（副本）`
  await row(copyTitle).waitFor()
  await toastWith('已另存为新试卷').waitFor()
  const copy = (await apiList()).find((p) => p.title === copyTitle)!
  assert.equal(copy.categoryId, en1Before.categoryId)
  assert.deepEqual(copy.tags.map((t) => t.id).sort(), en1Before.tags.map((t) => t.id).sort())
  assert.equal(copy.tags.length, 1)
  assert.equal((await row(copyTitle).getByTestId('paper-category').innerText()).trim(), '周测')
  assert.deepEqual(await rowTags(copyTitle), await rowTags(T.en1))
  await railButton('周测').click()
  await row(copyTitle).waitFor()
  assert.equal(await continueTitle(), `继续编辑《${copyTitle}》`)
  ok('P4：另存为新试卷后，副本在列表里可见，带着原试卷的分类「周测」与标签；在「周测」下同样看得到')
  await clearToasts()

  // ================================================================== P1 分类改名、调序、删除
  await railButton('全部').click()
  await railRow('期中').getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const renameDlg = categoryDialog('分类改名')
  assert.equal(await renameDlg.getByLabel('分类名称').inputValue(), '期中')
  assert.equal(await renameDlg.getByRole('button', { name: '选用常用分类名' }).count(), 0, '改名时不给常用名')
  await renameDlg.getByLabel('分类名称').fill('周测')
  await renameDlg.getByRole('button', { name: '保存', exact: true }).click()
  await renameDlg.getByRole('alert').filter({ hasText: '已有分类「周测」' }).waitFor()
  await renameDlg.getByLabel('分类名称').fill('期中考试')
  await renameDlg.getByRole('button', { name: '保存', exact: true }).click()
  await renameDlg.waitFor({ state: 'detached' })
  assert.deepEqual(await railNames(), ['全部', '周测', 'Quiz', LONG_CATEGORY, '单元测试', '期中考试', '未分类'])
  await expectCount('期中考试', 1)
  assert.equal((await row(T.mid).getByTestId('paper-category').innerText()).trim(), '期中考试', '改名后行上的分类名同步')
  // 上移 / 下移
  await railRow('单元测试').getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '上移', exact: true }).click()
  await window.waitForFunction((name) => [...document.querySelectorAll('.pp-cat-main > span')].map((el) => el.textContent).indexOf(name) === 3, '单元测试')
  assert.deepEqual(
    (await apiCategories()).map((c) => c.name),
    ['周测', 'Quiz', '单元测试', LONG_CATEGORY, '期中考试']
  )
  await railRow('周测').getByRole('button', { name: /更多操作/ }).click()
  assert.equal(await window.getByRole('menuitem', { name: '上移', exact: true }).getAttribute('aria-disabled'), 'true', '第一个分类不能再上移')
  await window.getByRole('menuitem', { name: '下移', exact: true }).click()
  await window.waitForFunction((name) => [...document.querySelectorAll('.pp-cat-main > span')].map((el) => el.textContent).indexOf(name) === 2, '周测')
  await railRow('期中考试').getByRole('button', { name: /更多操作/ }).click()
  assert.equal(await window.getByRole('menuitem', { name: '下移', exact: true }).getAttribute('aria-disabled'), 'true', '最后一个分类不能再下移')
  await window.keyboard.press('Escape')
  assert.deepEqual(
    (await apiCategories()).map((c) => c.name),
    ['Quiz', '周测', '单元测试', LONG_CATEGORY, '期中考试']
  )
  assert.deepEqual(await railNames(), ['全部', 'Quiz', '周测', '单元测试', LONG_CATEGORY, '期中考试', '未分类'])
  ok('P1：分类改名（重名报接口原因、成功后行上同步）、上移 / 下移（首尾禁用、顺序落库）')

  // 份数不含等待删除的试卷
  const periodCount = await railCount('周测')
  assert.equal(periodCount, 4)
  await row(`${T.en1}（副本）`).waitFor()
  await rowMenu(`${T.en1}（副本）`, '删除')
  await row(`${T.en1}（副本）`).waitFor({ state: 'detached' })
  assert.equal(await railCount('周测'), 3, '等待删除的试卷不计入分类份数')
  assert.equal(await railCount('全部'), 7, '全部也扣掉等待删除的试卷')
  assert.equal(await tagChipCount('易错 题'), 2, '也不计入标签份数')
  const undo = toastWith(`已删除「${T.en1}（副本）」`)
  await undo.getByRole('button', { name: '撤销', exact: true }).click()
  await row(`${T.en1}（副本）`).waitFor()
  assert.equal(await railCount('周测'), 4)
  assert.equal(await tagChipCount('易错 题'), 3)
  await clearToasts()
  ok('P1/P2：删除后 8 秒内，该试卷不计入分类份数与标签份数，撤销后恢复')

  // 删除分类：确认框写明份数；空分类；正在使用的分类；删除时正停在这个分类
  await railRow('Quiz').getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '删除', exact: true }).click()
  const delCat = window.getByRole('dialog', { name: /^删除分类「/ })
  assert.equal(await delCat.getByRole('heading').innerText(), '删除分类「Quiz」')
  assert.equal((await delCat.locator('.ui-confirm-body').innerText()).trim(), '其中没有试卷，不影响其他分类。')
  await delCat.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok((await railNames()).includes('Quiz'), '取消后分类还在')
  await railButton('周测').click()
  await railRow('周测').getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '删除', exact: true }).click()
  assert.equal(await delCat.getByRole('heading').innerText(), '删除分类「周测」')
  assert.equal((await delCat.locator('.ui-confirm-body').innerText()).trim(), '其中 4 份试卷回到「未分类」，试卷本身不受影响。')
  await shots('papers-17-delete-category-confirm', NARROW)
  await delCat.getByRole('button', { name: '删除', exact: true }).click()
  await delCat.waitFor({ state: 'detached' })
  await toastWith('已删除分类「周测」，4 份试卷回到「未分类」').waitFor()
  await railRow('周测').waitFor({ state: 'detached' })
  assert.equal(await railButton('全部').getAttribute('aria-pressed'), 'true', '删除时正停在这个分类，回到「全部」')
  await expectCount('未分类', 5)
  const stillThere = await apiList()
  assert.equal(stillThere.length, 8, '试卷一份没少')
  assert.equal(stillThere.filter((p) => p.categoryId === null).length, 5)
  assert.ok((await row(T.en1).getByTestId('paper-tag').count()) > 0, '试卷的标签还在')
  assert.equal(await row(T.en1).getByTestId('paper-category').count(), 0)
  ok('P1：删除分类的确认框：标题「删除分类「周测」」，正文「其中 4 份试卷回到「未分类」，试卷本身不受影响。」（空分类写「其中没有试卷，不影响其他分类。」，取消不删）；删除后试卷全部回到未分类、标签保留，正停在该分类时回到「全部」')

  // 删除正在使用的 30 字分类
  await railRow(LONG_CATEGORY).getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '删除', exact: true }).click()
  assert.equal(await delCat.getByRole('heading').innerText(), `删除分类「${LONG_CATEGORY}」`)
  assert.equal((await delCat.locator('.ui-confirm-body').innerText()).trim(), '其中 1 份试卷回到「未分类」，试卷本身不受影响。')
  await shots('papers-17b-delete-long-category-confirm', NARROW)
  await delCat.getByRole('button', { name: '删除', exact: true }).click()
  await delCat.waitFor({ state: 'detached' })
  await expectCount('未分类', 6)
  await clearToasts()
  await railRow('Quiz').getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '删除', exact: true }).click()
  await delCat.getByRole('button', { name: '删除', exact: true }).click()
  await delCat.waitFor({ state: 'detached' })
  await railRow('Quiz').waitFor({ state: 'detached' })
  assert.deepEqual(await railNames(), ['全部', '单元测试', '期中考试', '未分类'])
  ok('P1：删除正在使用的 30 字分类、删除空分类，左栏与份数同步')

  // ================================================================== 空分类
  await railButton('单元测试').click()
  await railRow('单元测试').getByRole('button', { name: /更多操作/ }).click()
  await window.getByRole('menuitem', { name: '删除', exact: true }).click()
  await delCat.getByRole('button', { name: '删除', exact: true }).click()
  await delCat.waitFor({ state: 'detached' })
  await createCategory('作业')
  await railButton('作业').click()
  await window.getByText('「作业」里还没有试卷').waitFor()
  await shots('papers-18-empty-category')
  await window.getByRole('main').getByRole('button', { name: '新建试卷', exact: true }).last().click()
  await window.getByRole('dialog', { name: '新建试卷' }).getByText('新试卷归入分类「作业」。').waitFor()
  await window.keyboard.press('Escape')
  ok('P1/P4：空分类给出说明与「新建试卷」，新建弹窗写明归入的分类')

  // ================================================================== 标签很多：标签条一行、标题最多两行、列表至少六行（S17）
  await railButton('全部').click()
  const existingTags = (await apiTags()).length
  const longTitle = (n: number): string => `七年级数学上册第一章有理数单元检测卷含答案教师版2026年秋季学期七年级${n}班使用的第${n}份复习资料`
  const bigIds = await window.evaluate(
    async ([long1, long2, long3]) => {
      const api = window.workbench.papers
      const tagIds: number[] = []
      for (let i = 1; i <= 300; i++) tagIds.push((await api.createTag(`标签${String(i).padStart(3, '0')}`)).id)
      const paperIds: number[] = []
      // 先建的在下面，最后建的排在最上面：长短标题交错，长标题的带很多标签
      const plan: [string, number][] = [['期末复习卷', 2], ['寒假作业', 3], [long3, 12], ['周测10月第3周', 4], ['错题整理', 5], [long2, 40], ['课堂小测', 0], ['国庆作业', 6], [long1, 25], ['期中模拟卷', 4]]
      for (const [title, n] of plan) {
        const id = await api.create(title)
        paperIds.push(id)
        if (n > 0) await api.changeTags([id], { add: tagIds.slice(0, n) })
        await new Promise((resolve) => setTimeout(resolve, 8))
      }
      return { tagIds, paperIds }
    },
    [longTitle(1), longTitle(2), longTitle(3)] as const
  )
  await reloadList()
  const totalTags = existingTags + 300
  assert.equal((await apiTags()).length, totalTags)
  await resize(app, window, 1000, 640)
  const more = tagBar.getByRole('button', { name: `更多（共 ${totalTags} 个）`, exact: true })
  await more.waitFor()
  assert.ok((await boxOf(tagBar)).height <= 44, `标签条默认一行：高 ${(await boxOf(tagBar)).height}`)
  assert.equal(await tagBar.locator('div:has(> .cf-chips)').evaluate((el) => el.getBoundingClientRect().height <= 30), true)
  const measure = () =>
    window.evaluate(() => {
      const list = document.querySelector('.pp-list')!.getBoundingClientRect()
      const rowEls = [...document.querySelectorAll<HTMLElement>('[data-testid="paper-row"]')]
      const titles = [...document.querySelectorAll<HTMLElement>('.pp-title')].map((el) => ({ title: el.getAttribute('title'), text: el.textContent, height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }))
      const metas = [...document.querySelectorAll<HTMLElement>('.pp-meta')].map((el) => el.getBoundingClientRect().height)
      const fully = rowEls.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= list.top - 1 && b.bottom <= list.bottom + 1 }).length
      return { fully, rows: rowEls.length, titles, metas, listHeight: list.height }
    })
  const m1 = await measure()
  assert.ok(m1.fully >= 6, `1000×640、${totalTags} 个标签：整行可见的试卷至少 6 行，实际 ${m1.fully}（列表高 ${m1.listHeight}）`)
  for (const t of m1.titles) {
    assert.equal(t.title, t.text, '标题的全名放在 title 属性里')
    assert.ok(t.height <= t.line * 2 + 1, `标题最多两行：${t.text} 高 ${t.height}`)
  }
  assert.ok(m1.titles.some((t) => t.height > t.line * 1.5), '有标题被截成两行')
  assert.ok(m1.metas.every((h) => h <= 21), '分类与标签永远一行')
  const moreChips = rows().locator('[data-testid="paper-tag-more"]')
  assert.ok((await moreChips.count()) >= 3, '标签多的试卷收进「+N」')
  const moreTitle = (await moreChips.first().getAttribute('title')) ?? ''
  assert.ok(moreTitle.includes('、'), '「+N」悬停写出被收起的标签名')
  await shot(window, 'papers-22-many-tags-1000x640')
  // 展开：最多三行，再点收起
  await more.click()
  const expandedBtn = tagBar.getByRole('button', { name: '收起', exact: true })
  await expandedBtn.waitFor()
  assert.ok((await boxOf(tagBar)).height <= 130, `展开后最多三行：${(await boxOf(tagBar)).height}`)
  await shot(window, 'papers-23-many-tags-expanded-1000x640')
  // 选中最靠后的标签：收起后它排在最前，选中的不会被挤到看不见的地方
  await tagChip('标签030').scrollIntoViewIfNeeded()
  await tagChip('标签030').click()
  await expandedBtn.click()
  await more.waitFor()
  assert.equal((await firstRowChips())[0].text, '标签0301', '收起时选中的标签排在第一行最前')
  assert.ok(await tagBar.locator('.cf-clear').isVisible())
  assert.equal(await headCount(), `筛出 1 份，共 ${(await apiList()).length} 份`, '「标签030」只有一份试卷带')
  await tagBar.locator('.cf-clear').click()
  await resize(app, window, 1440, 900)
  await window.waitForTimeout(200)
  const m2 = await measure()
  await shot(window, 'papers-22-many-tags-1440x900')
  assert.ok(m2.fully >= 6, `1440×900：${m2.fully}`)
  // 收拾：删掉这批标签与试卷
  await window.evaluate(async ({ tagIds, paperIds }) => {
    for (const id of tagIds) await window.workbench.papers.deleteTag(id)
    for (const id of paperIds) await window.workbench.papers.remove(id)
  }, bigIds)
  await reloadList()
  ok(`S17：${totalTags} 个标签时标签条默认一行、「更多（共 ${totalTags} 个）」展开最多三行再「收起」，选中的标签收起时排最前；标题最多两行、全名在 title 里，分类与标签一行；1000×640 整行可见 ${m1.fully} 行、1440×900 ${m2.fully} 行`)

  // ================================================================== 分类很多：左栏自己滚动、移到分类的小框封顶
  await railButton('全部').click()
  await window.evaluate(async () => {
    for (let i = 1; i <= 40; i++) await window.workbench.papers.createCategory(`分类${String(i).padStart(2, '0')}`)
  })
  await reloadList()
  await resize(app, window, 1000, 640)
  await railRow('分类40').waitFor()
  const scroller = await rail.evaluate((el) => ({ scrollable: el.scrollHeight > el.clientHeight, overflowX: el.scrollWidth > el.clientWidth }))
  assert.equal(scroller.scrollable, true, '40 个分类：左栏内部滚动')
  assert.equal(scroller.overflowX, false, '左栏没有横向滚动')
  assert.equal(await window.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true, '页面本身不被撑长')
  await railRow('未分类').scrollIntoViewIfNeeded()
  const last = await railRow('未分类').boundingBox()
  assert.ok(last && last.y + last.height <= 640, '滚到底能看到「未分类」')
  await rail.evaluate((el) => (el.scrollTop = 0))
  await shot(window, 'papers-20-many-categories-1000x640')
  await rowMenu(T.draft, '移到分类…')
  const bigPop = window.getByRole('dialog', { name: '移到分类' })
  await bigPop.waitFor()
  const box = await bigPop.boundingBox()
  assert.ok(box && box.y >= 0 && box.y + box.height <= 640, `小框在窗口内：${JSON.stringify(box)}`)
  await shot(window, 'papers-21-many-categories-move-1000x640')
  await window.keyboard.press('Escape')
  await resize(app, window, 1440, 900)
  await window.evaluate(async () => {
    for (const c of await window.workbench.papers.listCategories()) if (/^分类\d\d$/.test(c.name)) await window.workbench.papers.deleteCategory(c.id)
  })
  await reloadList()
  ok('P1：40 个分类时左栏内部滚动、无横向滚动、能滚到「未分类」；「移到分类」小框封顶高度、不超出窗口')

  // ================================================================== 收尾：原有六份试卷的修改时间与版本状态始终没变
  const final = await stamp()
  for (const [id, value] of before) assert.equal(final.get(id), value, `试卷 ${id} 的修改时间与版本状态没变`)
  await railButton('全部').click()
  await clearToasts()
  await shots('papers-19-final')
  ok('P5：整个流程（建分类、移动、批量、打标签、改名合并、删分类删标签、另存）之后，原有六份试卷的修改时间与版本状态始终没变')
} finally {
  await app.close()
}

console.log(`试卷库分类与标签端到端测试通过：${steps} 项，截图在 ${evidence}`)
