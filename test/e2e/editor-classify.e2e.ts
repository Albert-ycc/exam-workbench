// 编辑器题库栏「更多筛选」端到端测试（第三轮 L10）：章节、难度、知识点、标签四项筛选与组合、各选项题数、弹层外的条件小条与逐项清除、
// 无结果时的条件说明、换条件回到顶部、按试卷记住（含升级前只有旧四项的记录、字段损坏、章节标签已被删除）、筛选后拖拽 / 勾选 / 加入试卷、
// 三种窗口尺寸下弹层不出屏不横向滚动、方向 C 中性样式。
// 用法：node test/e2e/editor-classify.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { openDatabase } from '../../src/main/db.ts'
import { saveQuestionMeta } from '../../src/main/library/classify.ts'
import { classCount, classFilter, classKey, describeClassFilters, isStoredFilters, NO_FILTERS, normalizeFilters, pruneMissing, withoutCondition, type Filters } from '../../src/renderer/src/components/editor/libraryFilters.ts'
import { center, dragBetween, makeTempDirs, openEditor, saved, watchErrors } from './editor-support.e2e.ts'

const dirs = makeTempDirs('pane3')
const evidence = process.argv[2] ?? dirs.evidence
mkdirSync(evidence, { recursive: true })

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// ---------- 一、纯函数：旧记录升级 ----------
await step('旧记录升级（纯函数）：只有旧四项的记录有效并补默认值，损坏的新字段只丢那一项，旧四项损坏才整份作废', async () => {
  const old = { questionType: '解答题', sourcePaperId: '3', keyword: '绝对值', hideAdded: true }
  assert.equal(isStoredFilters(old), true, '升级前写下的记录必须被接受')
  assert.deepEqual(normalizeFilters(old), { ...old, chapterIds: [], knowledgeIds: [], difficulties: [], tagIds: [] })
  // 新字段各自校验：坏的那一项按没设，其余照用
  const mixed = normalizeFilters({ ...old, chapterIds: [1, 2.5, 'x', 1, 0], knowledgeIds: 'oops', difficulties: ['easy', 'nope', 'easy'], tagIds: [7] })
  assert.deepEqual(mixed, { ...old, chapterIds: [1, 0], knowledgeIds: [], difficulties: ['easy'], tagIds: [7] })
  // 旧四项本身坏了才作废
  for (const broken of [null, 'x', 1, [], {}, { ...old, keyword: 5 }, { ...old, hideAdded: 'yes' }, { questionType: '', sourcePaperId: 3, keyword: '', hideAdded: false }]) {
    assert.equal(isStoredFilters(broken), false, `应被拒绝：${JSON.stringify(broken)}`)
  }
  // 往接口传的条件：空的一项不传；组合键只随四项变
  assert.deepEqual(classFilter(NO_FILTERS), { chapterIds: undefined, knowledgeIds: undefined, difficulties: undefined, tagIds: undefined })
  const f: Filters = { ...NO_FILTERS, tagIds: [3], difficulties: ['hard'] }
  assert.deepEqual(classFilter(f), { chapterIds: undefined, knowledgeIds: undefined, difficulties: ['hard'], tagIds: [3] })
  assert.equal(classCount(f), 2)
  assert.equal(classKey({ ...f, keyword: '换了关键词', hideAdded: true }), classKey(f))
  assert.notEqual(classKey({ ...f, tagIds: [3, 4] }), classKey(f))
  // 说明与逐项去掉
  const chapters = [
    { id: 10, parentId: null, name: '第一章', position: 0, count: 0 },
    { id: 11, parentId: 10, name: '1.1 节', position: 0, count: 0 }
  ]
  const tags = [{ id: 3, name: '易错', count: 0 }]
  const named: Filters = { ...NO_FILTERS, chapterIds: [0, 11], difficulties: ['hard'], knowledgeIds: [5], tagIds: [3] }
  const conds = describeClassFilters(named, { chapters, tags, knowledgeNames: new Map([[5, '倒数']]) })
  assert.deepEqual(conds.map((c) => `${c.kindLabel}:${c.label}`), ['章节:未归章节', '章节:第一章 › 1.1 节', '难度:困难', '知识点:倒数', '标签:易错'])
  assert.deepEqual(withoutCondition(named, conds[1]).chapterIds, [0])
  assert.deepEqual(withoutCondition(named, conds[2]).difficulties, [])
  // 别处删除了的章节、标签从条件里去掉；「未归章节」保留；目录没读到时不动
  const pruned = pruneMissing({ ...NO_FILTERS, chapterIds: [0, 11, 99], tagIds: [3, 98] }, chapters, tags)
  assert.deepEqual([pruned.chapterIds, pruned.tagIds], [[0, 11], [3]])
  const same = { ...NO_FILTERS, chapterIds: [0, 11], tagIds: [3] }
  assert.equal(pruneMissing(same, chapters, tags), same, '没有要去掉的就返回原对象（不触发写回）')
  assert.equal(pruneMissing({ ...NO_FILTERS, tagIds: [98] }, null, null).tagIds[0], 98)
})

// ---------- 素材：6 道样例题 + 12 道填空题（适中，各带一个独有的知识点，让列表能滚动、知识点超过 10 个） ----------
const { questionIds } = seedDataDir(dirs.dataDir)
const [q1, q2, q3, q4, q5, q6] = questionIds
const extraIds: number[] = []
{
  const db = openDatabase(dirs.dataDir)
  const paperId = (db.prepare('SELECT id FROM source_papers ORDER BY id').get() as { id: number }).id
  const insert = db.prepare(
    `INSERT INTO questions (zujuan_qid, source_paper_id, source_label, source_order, question_type, number_count, stem_html, answer_html, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const now = new Date().toISOString()
  for (let i = 1; i <= 12; i++) {
    const id = Number(insert.run(`92${String(i).padStart(4, '0')}`, paperId, '补充题库', 100 + i, '填空题', 1, `<p>补充填空题第 ${i} 号：计算 ${i} + ${i} = <u>　　　　</u>。</p>`, null, `extra-${i}`, now).lastInsertRowid)
    saveQuestionMeta(db, id, { knowledge: [{ id: 9000 + i, name: `补充知识点${i}`, subject: 'czsx' }], difficulty: 0.6 })
    extraIds.push(id)
  }
  db.close()
}
const ALL = [...questionIds, ...extraIds] // 18 道

buildTo('out-pane3')
const launched = await launchApp({ outDir: 'out-pane3', dataDir: dirs.dataDir, userDataDir: dirs.userDataDir })
const page = launched.window
const errors: string[] = []
watchErrors(page, errors)
await page.setViewportSize({ width: 1440, height: 900 })

// ---------- 操作封装 ----------
const moreButton = page.getByRole('button', { name: /^更多筛选/ })
const pop = page.getByTestId('more-filters')
const libCard = (id: number) => page.locator(`[data-testid="lib-card"][data-question-id="${id}"]`)
const total = (): Promise<string> => page.getByTestId('lib-total').innerText().then((t) => t.trim())
const sortIds = (ids: number[]): number[] => [...ids].sort((a, b) => a - b)

// 列表等于这几道题（与顺序无关）。总数先对上再比，避免读到换条件前的旧列表
async function shows(ids: number[]): Promise<void> {
  const want = sortIds(ids)
  await page.waitForFunction(
    ([n, list]) => {
      const text = document.querySelector('[data-testid="lib-total"]')?.textContent?.trim()
      if (text !== `共 ${n} 道题`) return false
      const got = [...document.querySelectorAll('[data-testid="lib-card"]')].map((el) => Number((el as HTMLElement).dataset.questionId)).sort((a, b) => a - b)
      return JSON.stringify(got) === JSON.stringify(list)
    },
    [want.length, want] as const,
    { timeout: 8000 }
  )
}

async function openMore(): Promise<void> {
  if (!(await pop.isVisible())) await moreButton.click()
  await pop.waitFor()
  await page.waitForSelector('.ed-more .cf-title') // 题数读到了才有四个块
}
async function closeMore(): Promise<void> {
  if (await pop.isVisible()) await page.keyboard.press('Escape')
  await pop.waitFor({ state: 'detached' })
}
const row = (title: string) => pop.locator(`.cf-item[title="${title}"]`)
const diffChip = (label: string) => pop.locator('.cf-chips--tiles .cf-chip', { hasText: label })
const tagChip = (name: string) => pop.locator(`.cf-chip[title="${name}"]`)
const chips = (): Promise<string[]> =>
  page.locator('.ed-lib-cond').evaluateAll((els) => els.map((el) => `${el.querySelector('.ed-lib-cond-kind')?.textContent} ${el.querySelector('.ed-lib-cond-name')?.textContent}`))
const badge = async (): Promise<string | null> => ((await page.getByTestId('more-count').count()) ? (await page.getByTestId('more-count').innerText()).trim() : null)
// 块里各选项的题数：名称 → 数字
async function counts(selector: string): Promise<Record<string, number>> {
  return pop.locator(selector).evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute('title') ?? (el.querySelector('span')?.textContent ?? ''), Number(el.querySelector('em')?.textContent)])))
}
// 条件小条里的「清除全部」（弹层里还有一个同名按钮，要分开取）
const stripClear = () => page.locator('.ed-lib-active').getByRole('button', { name: '清除全部', exact: true })
const storageKey = (paperId: number): string => `ewb.editor.filters.${paperId}`
const readStored = (paperId: number): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), storageKey(paperId))

// 离开编辑器再回来（编辑器重新挂载，条件从 localStorage 读）；离开期间可以改存储
async function remount(paperId: number, between?: () => Promise<void>): Promise<void> {
  await page.locator('.app-nav .nav-item', { hasText: '设置' }).click()
  await page.getByLabel('试卷标题').waitFor({ state: 'detached' })
  await between?.()
  await page.locator('.app-nav .nav-item', { hasText: '试卷库' }).click()
  await page.getByLabel('试卷标题').waitFor()
  await page.getByTestId('lib-total').waitFor()
  void paperId
}

const SIZES: [number, number][] = [
  [1440, 900],
  [1280, 800],
  [1000, 640]
]
const SIZES_TWO: [number, number][] = [
  [1440, 900],
  [1000, 640]
]
async function shotAll(name: string, check?: () => Promise<void>, sizes: [number, number][] = SIZES): Promise<void> {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(350)
    await check?.()
    await page.screenshot({ path: join(evidence, `${name}-${w}x${h}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(250)
}

// 弹层不出屏、自己不滚、没有横向滚动，页面也没有横向滚动
async function assertPopoverFits(label: string): Promise<void> {
  const r = await page.evaluate(() => {
    const el = document.querySelector('.ui-popover') as HTMLElement
    const body = document.querySelector('.ed-more-body') as HTMLElement
    const box = el.getBoundingClientRect()
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      box: { l: box.left, t: box.top, r: box.right, b: box.bottom },
      popX: el.scrollWidth - el.clientWidth,
      popY: el.scrollHeight - el.clientHeight,
      bodyX: body.scrollWidth - body.clientWidth,
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      docX: document.documentElement.scrollWidth - window.innerWidth,
      libX: (document.querySelector('.ed-lib-inner') as HTMLElement).scrollWidth - (document.querySelector('.ed-lib-inner') as HTMLElement).clientWidth
    }
  })
  const tag = `${label} ${r.vw}×${r.vh}`
  assert.ok(r.box.l >= 0 && r.box.t >= 0 && r.box.r <= r.vw && r.box.b <= r.vh, `${tag}：弹层应完整在窗口内 ${JSON.stringify(r.box)}`)
  assert.ok(r.popX <= 0 && r.bodyX <= 0, `${tag}：弹层不应有横向滚动（弹层 ${r.popX}，内容 ${r.bodyX}）`)
  assert.ok(r.popY <= 1, `${tag}：弹层自己不滚，滚的是里面那一块（多出 ${r.popY}px）`)
  assert.ok(r.docX <= 0 && r.libX <= 0, `${tag}：页面与左栏不应有横向滚动（页面 ${r.docX}，左栏 ${r.libX}）`)
  console.log(`    ${tag}：弹层 ${Math.round(r.box.r - r.box.l)}×${Math.round(r.box.b - r.box.t)}，内容${r.bodyScrolls ? '在弹层内滚动' : '一屏放下'}`)
}

// 颜色取自 computed style：归类的条件与选项不能出现红（红笔）和绿（有答案 / 最新）
async function assertNeutralColors(selector: string, label: string): Promise<void> {
  const styles = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el)
      return { color: s.color, bg: s.backgroundColor, border: s.borderTopColor, radius: parseFloat(s.borderTopLeftRadius) }
    })
  )
  assert.ok(styles.length > 0, `${label}：没找到 ${selector}`)
  const RED = 'rgb(195, 50, 43)'
  const GREEN = 'rgb(46, 107, 69)'
  for (const s of styles) {
    for (const value of [s.color, s.bg, s.border]) assert.ok(value !== RED && value !== GREEN, `${label}不应出现红 / 绿：${JSON.stringify(s)}`)
    assert.ok(s.radius <= 3, `${label}圆角不超过 3px：${s.radius}`)
  }
}

try {
  // ---------- 建章节、标签、归类 ----------
  const setup = await page.evaluate(
    async ([ids, extras]) => {
      const lib = window.workbench.library
      const c1 = await lib.createChapter('第一章 有理数')
      const s11 = await lib.createChapter('1.1 正数与负数', c1.id)
      const s12 = await lib.createChapter('1.2 绝对值', c1.id)
      const c2 = await lib.createChapter('第二章 整式的加减')
      await lib.assignChapter({ ids: [ids[0]] }, s11.id)
      await lib.assignChapter({ ids: [ids[1]] }, s12.id)
      await lib.assignChapter({ ids: [ids[2]] }, c2.id)
      const wrong = await lib.createTag('易错')
      const hard = await lib.createTag('压轴')
      await lib.createTag('培优') // 没有题用到：变淡但可选
      await lib.changeQuestionTags({ ids: [ids[0], ids[3]] }, { add: [wrong.id] })
      await lib.changeQuestionTags({ ids: [ids[3], ids[4]] }, { add: [hard.id] })
      const paperId = (await window.workbench.papers.create('筛选测试卷')) as number
      return { c1: c1.id, s11: s11.id, s12: s12.id, c2: c2.id, wrong: wrong.id, hard: hard.id, paperId, extras: extras.length }
    },
    [questionIds, extraIds] as const
  )
  const paperId = setup.paperId
  await openEditor(page, paperId)
  await page.getByTestId('lib-card').first().waitFor()

  // ================= 入口与弹层 =================
  await step('题库栏：现有筛选旁有「更多筛选」，没条件时不带数字；四块按章节、难度、知识点、标签排，没有管理入口', async () => {
    await shows(ALL)
    assert.equal(await total(), '共 18 道题')
    assert.equal(await badge(), null)
    assert.equal(await page.locator('.ed-lib-active').count(), 0, '没条件时不出现条件小条')
    const box = (await moreButton.boundingBox())!
    const kw = (await page.getByLabel('题干关键词').boundingBox())!
    assert.ok(Math.abs(box.y + box.height / 2 - (kw.y + kw.height / 2)) < 3, '按钮与关键词输入框同一行')
    await openMore()
    assert.deepEqual(await pop.locator('.cf-title').allInnerTexts(), ['章节', '难度', '知识点', '标签'])
    assert.equal(await pop.getByText('管理章节').count(), 0, '只筛选：不显示「管理章节」')
    assert.equal(await pop.getByText('管理标签').count(), 0, '只筛选：不显示「管理标签」')
    assert.equal(await page.getByTestId('more-total').innerText(), '共 18 道题')
    // 各块的初始题数
    assert.deepEqual(await counts('.cf-item[title="未归章节"], .cf-item[title="第一章 有理数"], .cf-item[title="第二章 整式的加减"]'), { 未归章节: 15, '第一章 有理数': 2, '第二章 整式的加减': 1 })
    assert.deepEqual(await counts('.cf-chips--tiles .cf-chip'), { 容易: 2, 适中: 14, 困难: 1 })
    assert.deepEqual(await counts('.cf-chip[title="易错"], .cf-chip[title="压轴"], .cf-chip[title="培优"]'), { 易错: 2, 压轴: 2, 培优: 0 })
    assert.equal(await tagChip('培优').getAttribute('class').then((c) => c?.includes('is-zero')), true, '没有题用到的标签变淡')
  })

  await step('章节：选章包含其下各节，可再选「未归章节」；节单独可选', async () => {
    await row('第一章 有理数').click()
    await shows([q1, q2])
    assert.equal(await badge(), '1')
    assert.equal(await page.getByTestId('more-total').innerText(), '共 2 道题', '弹层底部随选随看')
    await pop.getByRole('button', { name: '展开第一章 有理数' }).click()
    await row('未归章节').click()
    await shows([q1, q2, q4, q5, q6, ...extraIds])
    assert.equal(await badge(), '2')
    await row('未归章节').click()
    await row('第一章 有理数').click()
    await row('1.1 正数与负数').click()
    await shows([q1])
    await row('1.1 正数与负数').click()
    await row('第二章 整式的加减').click()
    await shows([q3])
    await row('第二章 整式的加减').click()
    await shows(ALL)
    assert.equal(await badge(), null)
  })

  await step('难度：按档位并集；各档题数按其他条件算、本项不参与', async () => {
    await diffChip('容易').click()
    await shows([q2, q5])
    await diffChip('困难').click()
    await shows([q2, q4, q5])
    assert.equal(await badge(), '2')
    assert.deepEqual(await counts('.cf-chips--tiles .cf-chip'), { 容易: 2, 适中: 14, 困难: 1 }, '难度块自己的题数不受自己的选择影响')
    await diffChip('容易').click()
    await diffChip('困难').click()
    await shows(ALL)
  })

  await step('知识点：多于 10 个时先列 10 个，「展开全部」后全列；搜索；选中的固定在最前；同一项内取并集', async () => {
    assert.equal(await pop.locator('.cf-item').filter({ hasText: /补充知识点|绝对值|倒数|有理数加法运算/ }).count() > 0, true)
    await pop.getByRole('button', { name: /展开全部/ }).click()
    await pop.getByRole('button', { name: '收起', exact: true }).waitFor()
    await pop.getByPlaceholder('搜索知识点').fill('加法')
    await row('有理数加法运算').click()
    await shows([q3, q4])
    assert.equal(await pop.locator('.cf-pinned .cf-item').count(), 1)
    await pop.getByPlaceholder('搜索知识点').fill('')
    await row('绝对值的几何意义').click()
    await shows([q1, q3, q4])
    assert.equal(await badge(), '2')
    await row('绝对值的几何意义').click()
    await row('有理数加法运算').click()
    await shows(ALL)
  })

  await step('标签：并集；题数按其他条件算', async () => {
    await tagChip('易错').click()
    await shows([q1, q4])
    await tagChip('压轴').click()
    await shows([q1, q4, q5])
    assert.equal(await badge(), '2')
    await tagChip('压轴').click()
    await tagChip('易错').click()
    await shows(ALL)
  })

  await step('组合：不同项之间取交集，各块题数随其他条件变化，为 0 的不再列出', async () => {
    await diffChip('适中').click()
    await tagChip('易错').click()
    await shows([q1])
    assert.equal(await badge(), '2')
    // 难度块按「其他条件」（易错）计数：适中 1、困难 1；容易 0 不列
    assert.deepEqual(await counts('.cf-chips--tiles .cf-chip'), { 适中: 1, 困难: 1 })
    // 标签块按「适中」计数：易错 1，压轴 0（变淡）
    assert.deepEqual(await counts('.cf-chip[title="易错"], .cf-chip[title="压轴"]'), { 易错: 1, 压轴: 0 })
    await row('第一章 有理数').click()
    await shows([q1])
    await row('第一章 有理数').click()
    await diffChip('适中').click()
    await diffChip('困难').click()
    await row('有理数加法运算').click()
    await shows([q4])
    await tagChip('易错').click()
    await diffChip('困难').click()
    await row('有理数加法运算').click()
    await shows(ALL)
    assert.equal(await badge(), null)
  })

  // ================= 条件小条、清除、无结果 =================
  await step('弹层外：生效条件一项一块，点 × 只去掉这一项；条件小条与弹层里的「清除全部」都能清空', async () => {
    await row('第一章 有理数').click()
    await diffChip('适中').click()
    await tagChip('易错').click()
    await shows([q1])
    await closeMore()
    assert.deepEqual(await chips(), ['章节 第一章 有理数', '难度 适中', '标签 易错'])
    assert.equal(await badge(), '3')
    assert.match((await moreButton.getAttribute('aria-label')) ?? '', /已选 3 项/)
    await page.getByRole('button', { name: '清除难度「适中」' }).click()
    await shows([q1]) // 第一章 ∩ 易错
    assert.deepEqual(await chips(), ['章节 第一章 有理数', '标签 易错'])
    assert.equal(await badge(), '2')
    await page.getByRole('button', { name: '清除标签「易错」' }).click()
    await shows([q1, q2])
    assert.equal(await stripClear().count(), 0, '只剩一项时不出现「清除全部」')
    await page.getByRole('button', { name: '清除章节「第一章 有理数」' }).click()
    await shows(ALL)
    assert.equal(await page.locator('.ed-lib-active').count(), 0)
    // 弹层里的「清除全部」
    await openMore()
    await diffChip('困难').click()
    await tagChip('压轴').click()
    await shows([q4])
    await pop.getByRole('button', { name: '清除全部' }).click()
    await shows(ALL)
    assert.equal(await badge(), null)
    await closeMore()
    // 小条里的「清除全部」
    await openMore()
    await diffChip('容易').click()
    await tagChip('压轴').click()
    await shows([q5])
    await closeMore()
    await stripClear().click()
    await shows(ALL)
  })

  await step('无结果：写出包含新四项的条件，「清除筛选」全部清掉并保留「隐藏已加入」', async () => {
    await page.getByRole('checkbox', { name: '隐藏已加入' }).check()
    await openMore()
    await diffChip('困难').click() // 先选难度：选了第一章之后，没有困难题的「困难」档就不再列出
    await row('第一章 有理数').click()
    await shows([])
    await closeMore()
    const empty = page.getByText('没有符合条件的题目')
    await empty.waitFor()
    const text = await page.locator('.ed-lib-list').innerText()
    assert.match(text, /当前条件：.*章节「第一章 有理数」.*难度「困难」/)
    assert.equal(await total(), '共 0 道题')
    await shotAll('03-无结果', async () => {
      assert.equal(await page.locator('.ed-lib-inner').evaluate((el) => el.scrollWidth - el.clientWidth), 0)
    })
    await page.getByRole('button', { name: '清除筛选' }).click()
    await shows(ALL)
    assert.equal(await badge(), null)
    assert.equal(await page.getByRole('checkbox', { name: '隐藏已加入' }).isChecked(), true, '清除筛选不动「隐藏已加入」')
    await page.getByRole('checkbox', { name: '隐藏已加入' }).uncheck()
  })

  await step('M4 换更多筛选的条件后列表回到顶部，勾选清空', async () => {
    await openMore()
    await diffChip('适中').click()
    await shows([q1, q3, ...extraIds])
    await closeMore()
    const list = page.locator('.ed-lib-list')
    await libCard(q1).getByRole('checkbox').check({ force: true })
    await page.getByText('已选 1 道').waitFor()
    await list.evaluate((el) => (el.scrollTop = 600))
    assert.ok((await list.evaluate((el) => el.scrollTop)) > 100, '列表确实滚下去了')
    await openMore()
    await diffChip('容易').click() // 14 → 16 道，列表仍然很长：不回顶就会停在原位
    await shows([q1, q2, q3, q5, ...extraIds])
    await page.waitForFunction(() => (document.querySelector('.ed-lib-list') as HTMLElement).scrollTop === 0)
    assert.equal(await page.getByText(/已选 \d+ 道/).count(), 0, '换条件后勾选清空')
    await closeMore()
    await list.evaluate((el) => (el.scrollTop = 600))
    assert.ok((await list.evaluate((el) => el.scrollTop)) > 100)
    await openMore()
    await diffChip('容易').click()
    await diffChip('适中').click() // 回到没有条件
    await shows(ALL)
    await page.waitForFunction(() => (document.querySelector('.ed-lib-list') as HTMLElement).scrollTop === 0)
    await closeMore()
  })

  // ================= 按试卷记住 =================
  await step('S11 条件按试卷记住：切页回来，按钮数字、条件小条、列表都在；另一份试卷互不影响', async () => {
    await openMore()
    await diffChip('适中').click()
    await tagChip('易错').click()
    await shows([q1])
    await closeMore()
    await page.waitForTimeout(100)
    const saved1 = JSON.parse((await readStored(paperId))!)
    assert.deepEqual([saved1.difficulties, saved1.tagIds, saved1.questionType], [['medium'], [setup.wrong], ''], '写入的是完整的新形状')
    await remount(paperId)
    await shows([q1])
    assert.equal(await badge(), '2')
    assert.deepEqual(await chips(), ['难度 适中', '标签 易错'])
    // 另一份试卷没有这份的条件
    const otherId = (await page.evaluate(() => window.workbench.papers.create('另一份试卷'))) as number
    await openEditor(page, otherId)
    await shows(ALL)
    assert.equal(await badge(), null)
    await openEditor(page, paperId)
    await shows([q1])
    assert.equal(await badge(), '2')
  })

  await step('升级前已记住的旧条件继续有效：只有旧四项的记录读出来补默认值，不清空', async () => {
    // 旧记录：题型「解答题」（只有 q4）
    const old = JSON.stringify({ questionType: '解答题', sourcePaperId: '', keyword: '', hideAdded: false })
    await remount(paperId, () => page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey(paperId), old] as const))
    await shows([q4])
    await page.waitForFunction(() => (document.querySelector('select[aria-label="题型"]') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent === '解答题')
    assert.equal(await badge(), null)
    assert.equal(await readStored(paperId), old, '读旧记录不改写它')
    // 旧记录上再加新条件：旧的题型条件还在，存下来的是完整形状
    await openMore()
    await tagChip('易错').click()
    await shows([q4])
    await tagChip('压轴').click()
    await shows([q4])
    await tagChip('易错').click()
    await shows([q4]) // 解答题 ∩ 压轴
    await page.waitForTimeout(100)
    const upgraded = JSON.parse((await readStored(paperId))!)
    assert.equal(upgraded.questionType, '解答题')
    assert.deepEqual(upgraded.tagIds, [setup.hard])
    assert.deepEqual([upgraded.chapterIds, upgraded.knowledgeIds, upgraded.difficulties], [[], [], []])
    await closeMore()

    // 旧记录里的「隐藏已加入」「关键词」同样保留
    const old2 = JSON.stringify({ questionType: '', sourcePaperId: '', keyword: '绝对', hideAdded: true })
    await remount(paperId, () => page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey(paperId), old2] as const))
    await shows([])
    assert.equal(await page.getByRole('checkbox', { name: '隐藏已加入' }).isChecked(), true)
    assert.equal(await page.getByLabel('题干关键词').inputValue(), '绝对')
    await page.getByRole('checkbox', { name: '隐藏已加入' }).uncheck()
    await page.getByLabel('题干关键词').fill('')
    await shows(ALL)
  })

  await step('记录的某个新字段损坏只丢那一项；旧四项损坏才整份作废', async () => {
    const partial = JSON.stringify({ questionType: '', sourcePaperId: '', keyword: '', hideAdded: false, tagIds: 'bad', difficulties: ['easy', 'nope'], chapterIds: null })
    await remount(paperId, () => page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey(paperId), partial] as const))
    await shows([q2, q5])
    assert.equal(await badge(), '1', '坏的 tagIds 与 chapterIds 按没设，难度里能识别的「容易」还在')
    const broken = JSON.stringify({ questionType: 5, difficulties: ['hard'] })
    await remount(paperId, () => page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey(paperId), broken] as const))
    await shows(ALL)
    assert.equal(await badge(), null, '旧四项都不合格：整份作废，回到没有条件')
    await remount(paperId, () => page.evaluate((k) => localStorage.setItem(k, '{坏掉的 json'), storageKey(paperId)))
    await shows(ALL)
  })

  await step('别处已删除的章节与标签：从记住的条件里去掉，不会一直筛出 0 道；「未归章节」保留', async () => {
    const stale = JSON.stringify({ questionType: '', sourcePaperId: '', keyword: '', hideAdded: false, chapterIds: [0, 88888], tagIds: [99999], knowledgeIds: [], difficulties: [] })
    await remount(paperId, () => page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey(paperId), stale] as const))
    await shows([q4, q5, q6, ...extraIds])
    assert.deepEqual(await chips(), ['章节 未归章节'])
    await page.waitForTimeout(100)
    const now = JSON.parse((await readStored(paperId))!)
    assert.deepEqual([now.chapterIds, now.tagIds], [[0], []])
    // 条件还在时被别处删除：重新打开弹层时目录重读，已删除的从条件里去掉
    const temp = await page.evaluate(async (id) => {
      const tag = await window.workbench.library.createTag('临时')
      await window.workbench.library.changeQuestionTags({ ids: [id] }, { add: [tag.id] })
      return tag.id
    }, q6)
    await openMore()
    await row('未归章节').click()
    await shows(ALL)
    await tagChip('临时').click()
    await shows([q6])
    await closeMore()
    await page.evaluate(async (id) => window.workbench.library.deleteTag(id), temp)
    await openMore()
    await shows(ALL)
    assert.equal(await badge(), null, '标签被删后条件随之去掉')
    assert.equal(await tagChip('临时').count(), 0)
    // 建新标签后再打开弹层：看得到
    await closeMore()
    await page.evaluate(async () => window.workbench.library.createTag('新建的标签'))
    await openMore()
    await tagChip('新建的标签').waitFor()
    await closeMore()
  })

  // ================= 筛选后照常拖拽、勾选、加入 =================
  await step('筛选后拖拽加入试卷：题目落到匹配的大题，卡片标「已加入」', async () => {
    await openMore()
    await diffChip('困难').click()
    await shows([q4])
    await closeMore()
    const zone = page.getByTestId('new-section-zone')
    await zone.waitFor()
    await dragBetween(page, await center(libCard(q4)), await center(zone))
    await page.getByTestId('paper-item').first().waitFor()
    assert.equal(await page.getByTestId('section-name').first().inputValue(), '解答题')
    await libCard(q4).getByText('已加入').waitFor()
    await saved(page)
    assert.equal((await page.getByTestId('lib-added-count').innerText()).trim(), '· 已加入 1 道')
  })

  await step('筛选后勾选批量加入、单题「加入试卷」、隐藏已加入都照常', async () => {
    await openMore()
    await diffChip('困难').click()
    await diffChip('适中').click()
    await shows([q1, q3, ...extraIds])
    await closeMore()
    await libCard(q1).getByRole('checkbox').check({ force: true })
    await libCard(q3).getByRole('checkbox').check({ force: true })
    await page.getByText('已选 2 道').waitFor()
    await page.getByRole('button', { name: '加入试卷（2）' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 3)
    await libCard(q1).getByText('已加入').waitFor()
    await libCard(extraIds[0]).getByRole('button', { name: '加入试卷' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-item"]').length === 4)
    // 隐藏已加入：适中 14 道里去掉已加入的 3 道
    await page.getByRole('checkbox', { name: '隐藏已加入' }).check()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="lib-card"]').length === 11)
    assert.equal(await libCard(q1).count(), 0)
    assert.equal(await total(), '共 14 道题', '共 N 道题仍是筛出的总数，与隐藏已加入无关')
    await page.getByRole('checkbox', { name: '隐藏已加入' }).uncheck()
    await saved(page)
  })

  // ================= 返工：M1、M4、S11、S18 =================
  await step('M1 条件把难度、知识点筛空时写「当前条件下没有可选的…」（题型、关键词、更多筛选里的条件都算）', async () => {
    // 没条件：两块都有选项，不出现这句话（上一步留着「适中」，先取消）
    await openMore()
    await diffChip('适中').click()
    await shows(ALL)
    assert.equal(await pop.getByText(/当前条件下没有可选的/).count(), 0)
    await closeMore()
    const noteDifficulty = pop.getByText('当前条件下没有可选的难度')
    const noteKnowledge = pop.getByText('当前条件下没有可选的知识点')
    // 题型：书面表达只有 q6，它没有难度也没有知识点
    await page.getByLabel('题型').selectOption({ label: '书面表达' })
    await shows([q6])
    await openMore()
    await noteDifficulty.waitFor()
    await noteKnowledge.waitFor()
    assert.equal(await pop.getByText(/暂无(难度|知识点)信息/).count(), 0, '有条件时不写「暂无…信息」')
    await shotAll('06-没有可选-题型', () => assertPopoverFits('没有可选（题型）'), SIZES_TWO)
    await closeMore()
    await page.getByLabel('题型').selectOption({ label: '全部题型' })
    await shows(ALL)
    // 关键词
    await page.getByLabel('题干关键词').fill('李华')
    await shows([q6])
    await openMore()
    await noteDifficulty.waitFor()
    await noteKnowledge.waitFor()
    await closeMore()
    await page.getByLabel('题干关键词').fill('')
    await shows(ALL)
    // 更多筛选里的条件：给 q6 打一个标签，选中它
    await page.evaluate(
      async (id) => {
        const tag = await window.workbench.library.createTag('无信息')
        await window.workbench.library.changeQuestionTags({ ids: [id] }, { add: [tag.id] })
      },
      q6
    )
    await openMore()
    await tagChip('无信息').click()
    await shows([q6])
    await noteDifficulty.waitFor()
    await noteKnowledge.waitFor()
    await shotAll('06-没有可选-标签', () => assertPopoverFits('没有可选（标签）'), SIZES_TWO)
    // 取消条件后选项回来，提示消失
    await tagChip('无信息').click()
    await shows(ALL)
    await page.waitForFunction(() => !document.body.textContent?.includes('当前条件下没有可选的'))
    await closeMore()
  })

  await step('M4 同一个动作一个词：弹层头与条件小条都叫「清除全部」，「清除筛选」只留给无结果的按钮', async () => {
    await openMore()
    await diffChip('适中').click()
    await tagChip('易错').click()
    await shows([q1])
    assert.equal((await pop.locator('.ed-more-head .ui-btn').innerText()).trim(), '清除全部')
    assert.equal(await pop.getByRole('button', { name: '全部清除' }).count(), 0)
    assert.equal(await pop.getByRole('button', { name: '清除筛选' }).count(), 0)
    await closeMore()
    assert.equal((await stripClear().innerText()).trim(), '清除全部')
    assert.equal(await page.getByRole('button', { name: '全部清除' }).count(), 0, '页面上不再有「全部清除」')
    assert.equal(await page.getByRole('button', { name: '清除筛选', exact: true }).count(), 0, '列表有题时没有「清除筛选」')
    // 筛空：无结果的按钮叫「清除筛选」，条件小条仍叫「清除全部」
    await openMore()
    await tagChip('易错').click()
    await tagChip('压轴').click()
    await shows([])
    await closeMore()
    await page.getByRole('button', { name: '清除筛选', exact: true }).waitFor()
    assert.equal((await stripClear().innerText()).trim(), '清除全部')
    await shotAll('05-清除用词', undefined, SIZES_TWO)
    await stripClear().click()
    await shows(ALL)
  })

  await step('S11 章节在条件小条与无结果说明里写「章名 › 节名」，与试题库页同一写法', async () => {
    const label = '第一章 有理数 › 1.1 正数与负数'
    await openMore()
    await pop.getByRole('button', { name: '展开第一章 有理数' }).click()
    await row('1.1 正数与负数').click()
    await shows([q1])
    await closeMore()
    assert.deepEqual(await chips(), [`章节 ${label}`])
    assert.equal(await page.locator('.ed-lib-cond-name').getAttribute('title'), label, '被截断时悬停看到完整写法')
    assert.equal(await page.getByRole('button', { name: `清除章节「${label}」` }).count(), 1)
    await shotAll('04-章节小条-节', undefined, SIZES_TWO)
    // 章本身只写章名
    await openMore()
    await row('1.1 正数与负数').click()
    await row('第一章 有理数').click()
    await shows([q1, q2])
    await closeMore()
    assert.deepEqual(await chips(), ['章节 第一章 有理数'])
    // 无结果说明里同一写法
    await openMore()
    await row('第一章 有理数').click()
    await diffChip('困难').click() // 选了节之后困难档不再列出，所以先取消章、选困难，再选节
    await pop.getByRole('button', { name: '展开第一章 有理数' }).click()
    await row('1.1 正数与负数').click()
    await shows([])
    await closeMore()
    assert.match(await page.locator('.ed-lib-list').innerText(), new RegExp(`章节「${label}」`))
    // 试题库页里 q1 的章节就是这一写法
    await page.locator('.app-nav .nav-item', { hasText: '试题库' }).click()
    await page.getByText(label).first().waitFor()
    await page.locator('.app-nav .nav-item', { hasText: '试卷库' }).click()
    await page.getByLabel('试卷标题').waitFor()
    await page.getByTestId('lib-total').waitFor()
    await stripClear().click()
    await shows(ALL)
  })

  await step('S18 打开「更多筛选」时焦点落在弹层本身，回车不会清掉条件（鼠标、键盘两种打开方式）', async () => {
    // 先有条件，头上才有「清除全部」按钮
    await openMore()
    await diffChip('适中').click()
    await shows([q1, q3, ...extraIds])
    await closeMore()
    const focused = () =>
      page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        return { isPopover: !!a?.classList.contains('ui-popover'), inPopover: !!a?.closest('.ui-popover'), text: (a?.textContent ?? '').trim().slice(0, 12) }
      })
    for (const how of ['鼠标', '键盘'] as const) {
      if (how === '鼠标') await moreButton.click()
      else {
        await moreButton.focus()
        await page.keyboard.press('Enter')
      }
      await pop.waitFor()
      await page.waitForSelector('.ed-more .cf-title')
      await page.waitForTimeout(250)
      const f = await focused()
      assert.equal(f.isPopover, true, `${how}打开：焦点应在弹层本身，实际 ${JSON.stringify(f)}`)
      assert.equal(await pop.getByRole('button', { name: '清除全部' }).count(), 1, '头上有「清除全部」，但焦点不在它上面')
      if (how === '鼠标') await shotAll('07-打开时焦点', undefined, SIZES_TWO)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      assert.equal(await badge(), '1', `${how}打开后回车，条件还在`)
      assert.equal(await total(), `共 ${2 + extraIds.length} 道题`, '列表没变（适中：q1、q3 与 12 道补充题）')
      // Tab 才进入弹层里的第一个控件
      await page.keyboard.press('Tab')
      const t = await focused()
      assert.ok(t.inPopover && !t.isPopover, `Tab 进入弹层里的控件：${JSON.stringify(t)}`)
      await page.keyboard.press('Escape')
      await pop.waitFor({ state: 'detached' })
      assert.equal(await moreButton.evaluate((el) => el === document.activeElement), true, 'Esc 后焦点回到「更多筛选」按钮')
    }
    await openMore()
    await diffChip('适中').click()
    await shows(ALL)
    await closeMore()
  })

  // ================= 方向 C 与窗口尺寸 =================
  await step('方向 C：难度与标签用中性样式（困难不红、容易不绿），选中蓝黑；条件小条中性', async () => {
    await openMore()
    await shows(ALL)
    await assertNeutralColors('.ed-more .cf-chip', '未选中的难度与标签块')
    const style = (label: string) =>
      diffChip(label).evaluate((el) => {
        const s = getComputedStyle(el)
        return [s.color, s.backgroundColor, s.borderTopColor, s.borderTopWidth, s.fontWeight].join('|')
      })
    assert.equal(await style('容易'), await style('困难'), '容易与困难的样式完全相同')
    await diffChip('困难').click()
    await tagChip('易错').click()
    await shows([q4])
    await assertNeutralColors('.ed-more .cf-chip.is-on', '选中的块')
    assert.equal(await diffChip('困难').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(31, 58, 104)', '选中是蓝黑 #1F3A68')
    await closeMore()
    await assertNeutralColors('.ed-lib-cond', '条件小条')
    await assertNeutralColors('.ed-more-btn', '更多筛选按钮')
    assert.equal(await moreButton.evaluate((el) => getComputedStyle(el).borderTopColor), 'rgb(31, 58, 104)', '有条件生效时按钮是蓝黑')
    await openMore()
    await diffChip('困难').click()
    await tagChip('易错').click()
    await shows(ALL)
    await closeMore()
  })

  await step('三种窗口尺寸：弹层限高在窗口内、内部滚动，不出屏，无横向滚动；条件多时小条最多两行', async () => {
    await openMore()
    // 选几项：知识点要在其他条件之前选（条件一多，知识点就不足 10 个、没有「展开全部」）
    await pop.getByRole('button', { name: /展开全部/ }).click()
    await row('绝对值的几何意义').click()
    await row('用数轴上的点表示有理数').click()
    await row('补充知识点3').click()
    await diffChip('适中').click()
    await diffChip('容易').click()
    await row('第一章 有理数').click()
    await pop.getByRole('button', { name: '展开第一章 有理数' }).click()
    await row('1.2 绝对值').click()
    await row('未归章节').click()
    await tagChip('易错').click()
    await tagChip('压轴').click()
    await shows([q1])
    await page.waitForTimeout(400)
    await shotAll('01-更多筛选-展开', () => assertPopoverFits('更多筛选'))
    // 内容确实比弹层高：滚到底能看到标签块，页脚始终可见
    await page.setViewportSize({ width: 1000, height: 640 })
    await page.waitForTimeout(350)
    await pop.locator('.ed-more-body').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await pop.getByRole('button', { name: '完成' }).waitFor()
    assert.ok(await pop.getByRole('button', { name: '管理标签' }).count() === 0)
    assert.ok(await pop.locator('.cf-chip[title="新建的标签"]').isVisible(), '滚到底能看到标签块')
    await assertPopoverFits('滚到底')
    await page.screenshot({ path: join(evidence, '01-更多筛选-滚到底-1000x640.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(250)
    // 关掉弹层看条件小条：条件很多时最多两行再内部滚动，列表仍有足够高度
    await pop.getByRole('button', { name: '完成' }).click()
    await pop.waitFor({ state: 'detached' })
    const many = await chips()
    assert.ok(many.length >= 8, `条件小条应有 8 项以上：${many.join(' | ')}`)
    await shotAll('02-条件小条-多项', async () => {
      const r = await page.evaluate(() => {
        const bar = document.querySelector('.ed-lib-active') as HTMLElement
        const list = document.querySelector('.ed-lib-list') as HTMLElement
        const inner = document.querySelector('.ed-lib-inner') as HTMLElement
        return { bar: bar.getBoundingClientRect().height, list: list.getBoundingClientRect().height, x: inner.scrollWidth - inner.clientWidth, vh: window.innerHeight }
      })
      assert.ok(r.bar <= 57, `条件小条最多两行：${r.bar}`)
      // 条件再多，「清除全部」也不被滚动区挡住
      const clearBox = await stripClear().boundingBox()
      const barBox = await page.locator('.ed-lib-active').boundingBox()
      assert.ok(clearBox && barBox && clearBox.y >= barBox.y && clearBox.y + clearBox.height <= barBox.y + barBox.height + 0.5, '「清除全部」在条件小条可见范围内')
      assert.ok(r.x <= 0, '左栏无横向滚动')
      console.log(`    视口高 ${r.vh}：条件小条 ${Math.round(r.bar)}px，列表 ${Math.round(r.list)}px`)
      if (r.vh <= 640) assert.ok(r.list >= 150, `最小窗口下列表仍应有 150px 以上：${r.list}`)
    })
    await stripClear().click()
    await shows(ALL)
  })

  await step('入口截图：有条件与无条件的题库栏', async () => {
    await shotAll('00-题库栏-无条件')
    await openMore()
    await diffChip('适中').click()
    await tagChip('易错').click()
    await shows([q1])
    await closeMore()
    await shotAll('00-题库栏-有条件')
    await openMore()
    await diffChip('适中').click()
    await tagChip('易错').click()
    await closeMore()
    await shows(ALL)
  })

  assert.deepEqual(errors, [], `不应有页面错误：${errors.join('\n')}`)
  console.log(`\n全部通过（${passed} 项）→ ${evidence}`)
} catch (e) {
  await page.screenshot({ path: join(evidence, 'FAIL.png') }).catch(() => undefined)
  console.error(e)
  process.exitCode = 1
} finally {
  await launched.app.close()
}
