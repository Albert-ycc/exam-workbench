// 入库读取知识点与难度的端到端测试（离线，不访问组卷网）：
//   整页读不到知识点 / 读不到难度、只有几道读不到 → 预览提示后果与补救办法 → 确认入库
//   → 再入同一链接，预览「已在库，将补齐知识点与难度 N 道」、按钮「补齐知识点与难度」→ 确认 → 库里补齐、不新增题
//   → 没有可补的时确认置灰 → 入库完成后直接点「粘贴链接入库」能出粘贴框
// 用法：node test/e2e/import-classify.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { skipWithoutFixtures } from '../../scripts/fixtures.ts'
import { evidenceDir } from '../../scripts/temp-dir.ts'
import { ENGLISH_URL, FIXTURES, installIntercept, PAPER_URL, QUESTION_URL } from './library-intercept.e2e.ts'

const PHYSICS_URL = 'https://zujuan.xkw.com/4p9000002.html'
const evidence = evidenceDir(process.argv[2], 'ewb-import-classify-')
process.env.EWB_IMPORT_GAP_MS = '300'
skipWithoutFixtures('入库归类端到端')
buildTo('out-import3')
const { app, window } = await launchApp({ outDir: 'out-import3' })

let step = 0
const log = (text: string): void => console.log(`  ✓ ${++step}. ${text}`)
const button = (label: string) => window.getByRole('button', { name: label, exact: true })
const nav = (label: string) => window.locator('.app-nav').getByRole('button', { name: label, exact: true })
const squash = (text: string): string => text.replace(/\s+/g, '')

const resize = async (width: number, height: number): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const)
  await window.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const)
}
// 同一界面在两个尺寸各截一张：1440×900 与最小窗口 1000×640
async function shots(name: string): Promise<void> {
  for (const [w, h] of [[1440, 900], [1000, 640]] as const) {
    await resize(w, h)
    await window.screenshot({ path: join(evidence, `${name}-${w}x${h}.png`) })
  }
  await resize(1440, 900)
}

const summary = async (): Promise<string> => {
  const el = window.getByTestId('import-summary')
  await el.waitFor({ timeout: 120_000 })
  return squash(await el.innerText())
}
const result = async (): Promise<string> => {
  const el = window.getByTestId('import-result')
  await el.waitFor({ timeout: 30_000 })
  return squash(await el.innerText())
}
const texts = async (testId: string): Promise<string[]> => Promise.all((await window.getByTestId(testId).all()).map(async (el) => squash(await el.innerText())))
const tagCount = (text: string): Promise<number> => window.locator('.import-questions li .ui-tag--warn', { hasText: text }).count()

async function startPaste(urls: string[]): Promise<void> {
  await nav('采集').click()
  const open = button('粘贴链接入库')
  if (await open.isEnabled()) await open.click()
  await window.locator('.import-textarea').fill(urls.join('\n'))
  await button('开始入库').click()
}

type Stored = { id: number; zujuanQid: string | null; knowledge: { id: number; name: string; subject: string }[]; difficulty: number | null }
const library = async (): Promise<Stored[]> => (await window.evaluate(() => window.workbench.library.listQuestions({ limit: 1000 }))).items as unknown as Stored[]
const byQid = (items: Stored[], qid: string): Stored => {
  const found = items.find((q) => q.zujuanQid === qid)
  assert.ok(found, `库里没有题目 ${qid}`)
  return found
}

// 换掉离线拦截里某个页面的内容（拦截函数每次请求都从 __ewb.pages 里取）。几个 strip 可以叠加在同一页上，serveOriginal 还原
type Hook = { pages: Record<string, string>; verify: Set<string>; original?: Record<string, string> }
const KNOWLEDGE_BLOCK = '<div class="item knowlegde">[\\s\\S]*?</div>'
const DIFFICULTY_CELL = '<b class="gap">\\|</b>\\s*<span class="addi-info">\\s*<span class="info-cnt">\\s*[^<(（]*[（(]\\s*[\\d.]+\\s*[)）]\\s*</span>\\s*</span>'
const DIFFICULTY_ATTRS = '\\sqd(?:id|name|value)="[^"]*"'
const ITEM_CHUNK = '<div class="[^"]*tk-quest-item[^"]*"[\\s\\S]*?(?=<div class="[^"]*tk-quest-item|$)'

// 去掉前 count 道题的知识点区块（count 超过题数即全部去掉）
async function stripKnowledge(path: string, count: number): Promise<void> {
  await app.evaluate(({}, { path, source, count }) => {
    const state = (globalThis as unknown as { __ewb: Hook }).__ewb
    state.original ??= {}
    state.original[path] ??= state.pages[path]
    let seen = 0
    state.pages[path] = state.pages[path].replace(new RegExp(source, 'g'), (block) => (seen++ < count ? '' : block))
  }, { path, source: KNOWLEDGE_BLOCK, count })
}
// 去掉前 count 道题的难度（页面文字与加入试题篮按钮上的属性一起去掉，否则会从属性里读到）
async function stripDifficulty(path: string, count: number): Promise<void> {
  await app.evaluate(({}, { path, chunk, cell, attrs, count }) => {
    const state = (globalThis as unknown as { __ewb: Hook }).__ewb
    state.original ??= {}
    state.original[path] ??= state.pages[path]
    let index = 0
    state.pages[path] = state.pages[path].replace(new RegExp(chunk, 'g'), (item) => (index++ < count ? item.replace(new RegExp(cell, 'g'), '').replace(new RegExp(attrs, 'g'), '') : item))
  }, { path, chunk: ITEM_CHUNK, cell: DIFFICULTY_CELL, attrs: DIFFICULTY_ATTRS, count })
}
async function serveOriginal(path: string): Promise<void> {
  await app.evaluate(({}, path) => {
    const state = (globalThis as unknown as { __ewb: Hook }).__ewb
    if (state.original?.[path]) state.pages[path] = state.original[path]
  }, path)
}
async function servePage(path: string, html: string): Promise<void> {
  await app.evaluate(({}, { path, html }) => {
    const state = (globalThis as unknown as { __ewb: Hook }).__ewb
    state.pages[path] = html
  }, { path, html })
}

try {
  await nav('采集').waitFor()
  await installIntercept(app)
  await servePage('/4p9000002.html', readFileSync(join(FIXTURES, 'zujuan-physics-8a.html'), 'utf8'))
  await window.waitForTimeout(500)
  await resize(1440, 900)

  // 1. 整页都没读到知识点：顶部说清后果与补救办法，不在每道题上重复标「无知识点」；题照常入库（难度照存）
  await stripKnowledge('/2p3543573.html', 1000)
  await startPaste([PAPER_URL])
  assert.equal(await summary(), '拆出23道、带答案1道、已在库0道（入库时跳过）')
  assert.deepEqual(await texts('import-no-knowledge'), ['这页23道都没读到知识点，入库后按知识点筛不到这些题；之后再入同一链接，读到的知识点会补上。'])
  assert.equal(await window.getByTestId('import-no-difficulty').count(), 0)
  assert.equal(await tagCount('无知识点'), 0, '整页都没读到时不逐题标「无知识点」')
  assert.match(await window.locator('.import-page > summary').innerText(), /23 道没取到知识点/)
  assert.equal(await button('确认入库').isEnabled(), true)
  await shots('1-preview-no-knowledge-whole-page')
  await button('确认入库').click()
  assert.equal(await result(), '新增23道，跳过0道（已在库）')
  let items = await library()
  assert.equal(items.length, 23)
  assert.ok(items.every((q) => q.knowledge.length === 0 && q.difficulty !== null), '没有知识点的题照常入库，难度照存')
  assert.equal(byQid(items, '17150767').difficulty, 0.65)
  log('整页没有知识点：顶部写「这页 23 道都没读到知识点，入库后按知识点筛不到这些题；之后再入同一链接，读到的知识点会补上。」，题行不标「无知识点」；23 道照常入库，难度已存')

  // 1b. 入库完成后直接点工具栏的「粘贴链接入库」：粘贴框出来，不必先点「关闭」；关闭粘贴框回到结果
  await button('粘贴链接入库').click()
  await window.locator('.import-textarea').waitFor({ timeout: 5000 })
  assert.equal(await window.getByTestId('import-result').count(), 0)
  await shots('1b-paste-from-done')
  await window.locator('.import-panel').getByRole('button', { name: '关闭', exact: true }).click()
  await window.getByTestId('import-result').waitFor({ timeout: 5000 })
  assert.equal(await result(), '新增23道，跳过0道（已在库）')
  await button('关闭').click()
  await window.locator('.import-panel').waitFor({ state: 'detached' })
  log('入库完成后点「粘贴链接入库」：直接出粘贴框；关闭粘贴框回到入库结果，再点「关闭」收起面板')

  // 2. 同一链接再入（这次页面有知识点与难度）：已在库的题将补齐，摘要不再写「入库时跳过」，按钮「补齐知识点与难度」，不新增题
  await serveOriginal('/2p3543573.html')
  await startPaste([QUESTION_URL, PAPER_URL])
  assert.equal(await summary(), '拆出24道、带答案1道、已在库24道（不重复入库）')
  assert.deepEqual(await texts('import-fill'), ['已在库，将补齐知识点与难度23道'], '单题页与试卷页里的同一道题只算一次')
  assert.equal(await window.getByTestId('import-no-knowledge').count(), 0)
  assert.equal(await window.getByTestId('import-no-difficulty').count(), 0)
  assert.equal(await window.getByTestId('import-nothing-new').count(), 0)
  assert.equal(await button('确认入库').count(), 0)
  assert.equal(await button('补齐知识点与难度').isEnabled(), true, '没有新题但有可补齐的题，按钮可点')
  assert.equal(await window.locator('.import-questions li .ui-tag--plain', { hasText: '将补齐' }).count(), 23)
  await shots('2-preview-fill')
  await button('补齐知识点与难度').click()
  assert.equal(await result(), '新增0道，跳过24道（已在库），补齐知识点与难度23道')
  assert.match(await window.locator('.import-done-note').innerText(), /没有新增题目，试题库里已有的 23 道题补齐了知识点与难度/)
  assert.equal(await button('去试题库看本次入库').count(), 0)
  await shots('3-done-fill')
  await button('关闭').click()
  items = await library()
  assert.equal(items.length, 23, '补齐不新增题')
  assert.ok(items.every((q) => q.knowledge.length >= 1 && q.knowledge.length <= 6 && q.difficulty !== null && q.difficulty >= 0 && q.difficulty <= 1))
  const first = byQid(items, '17150767')
  assert.deepEqual(first.knowledge, [
    { id: 4740, name: '倒数', subject: 'czsx' },
    { id: 4748, name: '两个有理数的乘法运算', subject: 'czsx' },
    { id: 4717, name: '绝对值的几何意义', subject: 'czsx' },
    { id: 4731, name: '有理数加法运算', subject: 'czsx' }
  ])
  assert.equal(first.difficulty, 0.65)
  assert.deepEqual(byQid(items, '28906491').knowledge.map((k) => k.id), [4740, 4755, 4713, 4731])
  assert.equal(byQid(items, '28906491').difficulty, 0.85)
  assert.equal(byQid(items, '35833446').knowledge.length, 6)
  assert.equal(byQid(items, '35833446').difficulty, 0.57)
  log('再入同一链接：摘要「已在库 24 道（不重复入库）」，预览「已在库，将补齐知识点与难度 23 道」，按钮「补齐知识点与难度」可点；结果写「补齐知识点与难度 23 道」，库里 23 道不变，知识点（页面顺序）与难度逐题补上')

  // 3. 再入一次：没有可补的，摘要仍写「入库时跳过」，确认置灰
  await startPaste([QUESTION_URL, PAPER_URL])
  assert.equal(await summary(), '拆出24道、带答案1道、已在库24道（入库时跳过）')
  assert.equal(await window.getByTestId('import-fill').count(), 0)
  assert.equal(await window.getByTestId('import-no-knowledge').count(), 0)
  assert.equal(await window.getByTestId('import-no-difficulty').count(), 0)
  assert.equal(await button('确认入库').isDisabled(), true)
  assert.match(await window.getByTestId('import-nothing-new').innerText(), /没有可入库的新题/)
  await shots('4-preview-nothing-new')
  await button('取消').click()
  await window.locator('.import-panel').waitFor({ state: 'detached' })
  log('补齐之后再入一次：没有可补的，无任何知识点或难度提示，摘要仍写「入库时跳过」，「确认入库」置灰并说明没有新题（S18 不变）')

  // 4. 删一道再入：新题带着知识点与难度入库，已在库的不动
  const gone = byQid(await library(), '35833446')
  await window.evaluate((id) => window.workbench.library.deleteQuestion(id), gone.id)
  await startPaste([PAPER_URL])
  assert.equal(await summary(), '拆出23道、带答案1道、已在库22道（入库时跳过）')
  assert.equal(await window.getByTestId('import-fill').count(), 0)
  assert.equal(await window.getByTestId('import-no-knowledge').count(), 0)
  assert.equal(await window.getByTestId('import-no-difficulty').count(), 0)
  await button('确认入库').click()
  assert.equal(await result(), '新增1道，跳过22道（已在库）')
  await button('关闭').click()
  items = await library()
  assert.equal(items.length, 23)
  const back = byQid(items, '35833446')
  assert.notEqual(back.id, gone.id)
  assert.deepEqual({ knowledge: back.knowledge, difficulty: back.difficulty }, { knowledge: gone.knowledge, difficulty: gone.difficulty }, '新入库的题带着 6 个知识点与难度 0.57')
  log('删一道再入：新增 1 道，它带着与页面一致的 6 个知识点与难度 0.57；已在库的 22 道不变；没有任何知识点或难度提示')

  // 5. 英语卷：3 道没取到知识点（只有几道）、整页都没读到难度，两条提示并列；只在「几道」的那项上逐题标记
  await app.evaluate(({}, path) => (globalThis as unknown as { __ewb: Hook }).__ewb.verify.delete(path), '/2p1111111.html')
  await stripKnowledge('/2p1111111.html', 3)
  await stripDifficulty('/2p1111111.html', 1000)
  const idsBefore5 = new Set(items.map((q) => q.id))
  await startPaste([ENGLISH_URL])
  assert.equal(await summary(), '拆出20道、带答案0道、已在库0道（入库时跳过）')
  assert.deepEqual(await texts('import-no-knowledge'), ['3道没取到知识点，这几道入库后按知识点筛不到。'])
  assert.deepEqual(await texts('import-no-difficulty'), ['这页20道都没读到难度，入库后按难度筛不到这些题；之后再入同一链接，读到的难度会补上。'])
  assert.equal(await tagCount('无知识点'), 3)
  assert.equal(await tagCount('无难度'), 0, '整页都没读到难度时不逐题标「无难度」')
  const title5 = await window.locator('.import-page > summary').innerText()
  assert.match(title5, /3 道没取到知识点/)
  assert.match(title5, /20 道没取到难度/)
  await shots('5-preview-partial-knowledge-whole-difficulty')
  await button('确认入库').click()
  assert.equal(await result(), '新增20道，跳过0道（已在库）')
  await button('关闭').click()
  items = await library()
  assert.equal(items.length, 43)
  const english = items.filter((q) => !idsBefore5.has(q.id))
  assert.equal(english.length, 20)
  assert.equal(english.filter((q) => q.knowledge.length === 0).length, 3)
  assert.ok(english.every((q) => q.difficulty === null))
  log('英语卷：「3 道没取到知识点，这几道入库后按知识点筛不到。」与「这页 20 道都没读到难度…」并列，只有 3 道标「无知识点」，不标「无难度」；入库后库里恰有 3 道无知识点、20 道都没有难度')

  // 6. 物理卷：只有 4 道没取到难度
  await stripDifficulty('/4p9000002.html', 4)
  const idsBefore6 = new Set(items.map((q) => q.id))
  await startPaste([PHYSICS_URL])
  assert.equal(await summary(), '拆出26道、带答案0道、已在库0道（入库时跳过）')
  assert.equal(await window.getByTestId('import-no-knowledge').count(), 0)
  assert.deepEqual(await texts('import-no-difficulty'), ['4道没取到难度，这几道入库后按难度筛不到。'])
  assert.equal(await tagCount('无难度'), 4)
  assert.equal(await tagCount('无知识点'), 0)
  assert.match(await window.locator('.import-page > summary').innerText(), /4 道没取到难度/)
  await shots('6-preview-partial-difficulty')
  await button('确认入库').click()
  assert.equal(await result(), '新增26道，跳过0道（已在库）')
  await button('关闭').click()
  items = await library()
  assert.equal(items.length, 69)
  const physics = items.filter((q) => !idsBefore6.has(q.id))
  assert.equal(physics.length, 26)
  assert.equal(physics.filter((q) => q.difficulty === null).length, 4)
  assert.ok(physics.every((q) => q.knowledge.length >= 1))
  log('物理卷：「4 道没取到难度，这几道入库后按难度筛不到。」，4 道标「无难度」；入库后库里恰有 4 道没有难度，知识点齐全')

  // 7. 再入物理卷原页面：库里只缺难度的 4 道将补齐（「知识点与难度」的文案同样适用于只缺难度）
  await serveOriginal('/4p9000002.html')
  await startPaste([PHYSICS_URL])
  assert.equal(await summary(), '拆出26道、带答案0道、已在库26道（不重复入库）')
  assert.deepEqual(await texts('import-fill'), ['已在库，将补齐知识点与难度4道'])
  assert.equal(await window.locator('.import-questions li .ui-tag--plain', { hasText: '将补齐' }).count(), 4)
  assert.equal(await button('补齐知识点与难度').isEnabled(), true)
  await shots('7-preview-fill-difficulty-only')
  const knowledgeBefore = new Map(physics.map((q) => [q.id, JSON.stringify(q.knowledge)]))
  await button('补齐知识点与难度').click()
  assert.equal(await result(), '新增0道，跳过26道（已在库），补齐知识点与难度4道')
  await button('关闭').click()
  items = await library()
  assert.equal(items.length, 69)
  const physicsAfter = items.filter((q) => knowledgeBefore.has(q.id))
  assert.equal(physicsAfter.length, 26)
  assert.ok(physicsAfter.every((q) => q.difficulty !== null))
  assert.ok(physicsAfter.every((q) => JSON.stringify(q.knowledge) === knowledgeBefore.get(q.id)), '补齐难度时已有的知识点不动')
  log('再入物理卷原页面：摘要「已在库 26 道（不重复入库）」，「已在库，将补齐知识点与难度 4 道」，4 道标「将补齐」；补齐后 26 道都有难度，知识点不变，库里仍是 69 道')

  // 拦截函数接住了内置浏览器会话里的全部 https 请求（页面自带的站点资源也在内）；这里只记录试卷 / 单题页的加载次数
  const served = await app.evaluate(() => (globalThis as unknown as { __ewb: { served: string[] } }).__ewb.served)
  console.log(`  拦截日志：试卷/单题页请求 ${served.filter((u) => /zujuan\.xkw\.com\/\d+[pq]\d+\.html/.test(u)).length} 次`)
  console.log(`入库归类端到端测试通过：${step} 项，证据在 ${evidence}`)
} catch (error) {
  await window.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
}
