// 应用外壳端到端测试（方向 C 顶部导航）：
//   S10 启动落点：从没用过时，题库为空进采集、否则进试卷库；用过之后回到上次的页面（重启验证）
//   S11 打开中的试卷切页面后保留：点「试卷库」标签回到正在编辑的试卷，编辑器里的「返回试卷库」才回列表；刷新仍保留，试卷已删则回列表
//   S16 窄窗口（< 1200px）导航收成紧凑样式
// 同时在 1440×900 与 1280×800 各截试卷库、采集两张外壳截图。
// 全程不访问外网：内置浏览器会话的 https 请求由本地桩页面应答，首次启动进采集的那一次用 DNS 屏蔽。
// 用法：node test/e2e/ui-shell.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { buildTo, launchApp, type LaunchedApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { sampleDraft } from '../../scripts/test-export-fixtures.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-ui-shell-'))
mkdirSync(evidence, { recursive: true })
buildTo('out-uibase')

const launch = (dataDir: string, userDataDir: string): Promise<LaunchedApp> => launchApp({ outDir: 'out-uibase', dataDir, userDataDir })

// 采集页的内置浏览器：用本地桩页面应答组卷网，页头不出现「打开失败」
async function stubCollect(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }) => {
    session.fromPartition('persist:zujuan').protocol.handle('https', () => new Response('<!doctype html><html><head><title>组卷网</title></head><body></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  })
}

const resize = async (app: ElectronApplication, window: Page, width: number, height: number): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const)
  await window.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const)
}

let steps = 0
const ok = (name: string): void => {
  steps++
  console.log('  ✓ ' + name)
}
const tab = (window: Page, label: string) => window.locator('.app-nav').getByRole('button', { name: label, exact: true })
const currentTab = (window: Page) => window.locator('.app-nav [aria-current="page"]')
const onList = (window: Page) => window.getByRole('button', { name: '新建试卷' }).first()
const onEditor = (window: Page) => window.getByLabel('试卷标题')
const storedPage = (window: Page): Promise<string | null> => window.evaluate(() => localStorage.getItem('ewb.ui.page'))

// ---------- S10：从没用过 ----------
const emptyData = mkdtempSync(join(tmpdir(), 'ewb-shell-empty-'))
const emptyUser = mkdtempSync(join(tmpdir(), 'ewb-shell-empty-user-'))
let session = await launch(emptyData, emptyUser)
try {
  const { app, window } = session
  assert.equal(await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1 }).then((p) => p.total)), 0)
  await currentTab(window).waitFor()
  assert.equal(await currentTab(window).innerText(), '采集', '题库为空：首次启动进采集')
  assert.equal(await storedPage(window), '"collect"')
  ok('S10：从没用过且题库为空 → 进采集')

  await tab(window, '设置').click()
  await window.getByText('试题库题目').waitFor()
  assert.equal(await storedPage(window), '"settings"')
  await app.close()
  session = await launch(emptyData, emptyUser)
  await session.window.getByText('试题库题目').waitFor()
  assert.equal(await currentTab(session.window).innerText(), '设置', '重启后回到上次的页面（设置）')
  ok('S10：用过之后重启回到上次所在的页面')
} finally {
  await session.app.close().catch(() => undefined)
}

// ---------- 有题库的数据 ----------
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-shell-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'ewb-shell-user-'))
seedDataDir(dataDir)
session = await launch(dataDir, userDataDir)
try {
  const { app, window } = session
  await currentTab(window).waitFor()
  assert.equal(await currentTab(window).innerText(), '试卷库', '题库有题、从没用过：首次启动进试卷库')
  await onList(window).waitFor()
  assert.ok((await window.locator('.app-nav [aria-current="page"]').count()) === 1)
  ok('S10：从没用过且题库有题 → 进试卷库')

  // 造几份试卷，让截图有内容
  const questions = (await window.evaluate(() => window.workbench.library.listQuestions({}))).items.sort((a, b) => a.id - b.id)
  const titles = ['七年级数学第一单元测试', '七年级数学期中模拟', '空白试卷']
  const ids: number[] = []
  for (const title of titles) ids.push(await window.evaluate((t) => window.workbench.papers.create(t), title))
  for (const id of ids.slice(0, 2)) await window.evaluate(([i, d]) => window.workbench.papers.saveDraft(i as number, d as never), [id, sampleDraft(questions)] as const)
  await window.reload()
  await onList(window).waitFor()
  await window.locator('[data-testid="paper-row"]').first().waitFor()

  // ---------- 外壳截图 ----------
  await stubCollect(app)
  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    await resize(app, window, w, h)
    await tab(window, '试卷库').click()
    await onList(window).waitFor()
    await window.waitForTimeout(250)
    await window.screenshot({ path: join(evidence, `shell-papers-${w}x${h}.png`) })
    await tab(window, '采集').click()
    await window.locator('.browser-host').waitFor()
    await window.waitForTimeout(600)
    await window.screenshot({ path: join(evidence, `shell-collect-${w}x${h}.png`) })
  }
  ok('外壳截图：1440×900 与 1280×800 各一张试卷库、一张采集')

  // ---------- S11：打开中的试卷切页面后保留 ----------
  await resize(app, window, 1280, 800)
  await tab(window, '试卷库').click()
  await window.locator('[data-testid="paper-row"]').first().getByRole('button', { name: '打开', exact: true }).click()
  await onEditor(window).waitFor()
  const title = await onEditor(window).inputValue()
  assert.ok(titles.includes(title))
  await window.screenshot({ path: join(evidence, 'shell-editor-1280x800.png') })
  for (const other of ['采集', '试题库', '设置']) {
    await tab(window, other).click()
    assert.equal(await onEditor(window).count(), 0, `在「${other}」页看不到编辑器`)
    await tab(window, '试卷库').click()
    await onEditor(window).waitFor()
    assert.equal(await onEditor(window).inputValue(), title, `从「${other}」回来是同一张试卷`)
  }
  assert.equal(await onList(window).count(), 0, '点「试卷库」标签回到的是编辑器，不是列表')
  await tab(window, '试卷库').click()
  assert.equal(await onEditor(window).inputValue(), title, '正在编辑时再点「试卷库」标签不会被带回列表')
  ok('S11：切到采集 / 试题库 / 设置再点「试卷库」标签，回到正在编辑的同一张试卷')

  await window.reload()
  await onEditor(window).waitFor()
  assert.equal(await onEditor(window).inputValue(), title, '刷新后仍在这张试卷')
  await window.evaluate(() => sessionStorage.setItem('ewb.ui.openPaperId', '99999'))
  await window.reload()
  await onList(window).waitFor()
  assert.equal(await window.evaluate(() => sessionStorage.getItem('ewb.ui.openPaperId')), 'null', '记录的试卷已不存在：回到列表并清掉记录')
  ok('S11：刷新后仍在编辑；记录的试卷已被删除时回到列表')

  await window.locator('[data-testid="paper-row"]').first().getByRole('button', { name: '打开', exact: true }).click()
  await onEditor(window).waitFor()
  await window.locator('main.content').getByRole('button', { name: /^(返回)?试卷库$/ }).click() // 编辑器顶栏的返回按钮
  await onList(window).waitFor()
  await tab(window, '设置').click()
  await tab(window, '试卷库').click()
  await onList(window).waitFor()
  assert.equal(await onEditor(window).count(), 0)
  ok('S11：编辑器里的「返回试卷库」回到列表，之后点标签停在列表')

  // 重启：试卷列表（只在本次运行内记住打开的试卷），页面仍是试卷库
  await window.locator('[data-testid="paper-row"]').first().getByRole('button', { name: '打开', exact: true }).click()
  await onEditor(window).waitFor()
  await app.close()
  session = await launch(dataDir, userDataDir)
  await onList(session.window).waitFor()
  assert.equal(await currentTab(session.window).innerText(), '试卷库')
  ok('S10/S11：重启后回到上次页面（试卷库），打开的试卷只在本次运行内记住，重启回到列表')

  // ---------- S16：窄窗口导航收紧 ----------
  const { app: app2, window: window2 } = session
  await resize(app2, window2, 1280, 800)
  const metrics = () =>
    window2.evaluate(() => {
      const nav = document.querySelector('.app-nav') as HTMLElement
      const icon = document.querySelector('.app-nav .nav-item svg') as SVGElement | null
      return { height: nav.getBoundingClientRect().height, iconShown: icon ? getComputedStyle(icon).display !== 'none' : false, gap: getComputedStyle(nav).columnGap }
    })
  const wide = await metrics()
  assert.deepEqual({ height: wide.height, iconShown: wide.iconShown, gap: wide.gap }, { height: 50, iconShown: true, gap: '30px' }, '≥1200px：完整导航')
  await resize(app2, window2, 1100, 760)
  const narrow = await metrics()
  assert.deepEqual({ height: narrow.height, iconShown: narrow.iconShown, gap: narrow.gap }, { height: 42, iconShown: false, gap: '18px' }, '<1200px：紧凑导航（矮一截、去图标、间距收小）')
  for (const label of ['采集', '试题库', '试卷库', '设置']) assert.ok(await tab(window2, label).isVisible(), `窄窗口下「${label}」仍可见可点`)
  await window2.waitForTimeout(250)
  await window2.screenshot({ path: join(evidence, 'shell-papers-1100x760-compact.png') })
  // 窄窗口下导航不横向溢出
  assert.equal(await window2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  ok('S16：窗口 < 1200px 时导航收成紧凑样式，四个标签仍可见，无横向溢出')

  console.log(`\n外壳测试通过（${steps} 项），截图在 ${evidence}`)
} finally {
  await session.app.close().catch(() => undefined)
}
