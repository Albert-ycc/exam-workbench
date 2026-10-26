// 试题库归类端到端测试（第三轮 L4–L9、L11）：章节目录与归到章节、标签、四项筛选、题目行显示。
// 数据：样例 6 题（前 5 题带真实知识点与难度）+ 本测试补的 40 道「第一单元」题（跨分页），章节与标签在测试里建。
// 一、左栏顺序与四项筛选的题数；二、章节管理（新建章与节、30 字、超长、重名、改名、调顺序）；三、勾选与「全选筛出的 N 道」跨分页归到章节、移出章节；
// 四、标签（单题、批量、半选、去标签、20 字、超长、全角空格、HTML 名称）；五、四项筛选组合、chip 与无结果条件、清除筛选、换条件清空勾选；
// 六、删除正在使用的章节与标签（筛选里残留的条件一并去掉）；七、题目行显示与中性样式；八、旧筛选记录升级、几百个标签；九、三种窗口尺寸截图。
// 用法：node test/e2e/library-classify.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator } from 'playwright'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'
import { openDatabase } from '../../src/main/db.ts'
import { saveQuestionMeta } from '../../src/main/library/classify.ts'

const OUT = 'out-lib3'
const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-library-classify-'))
mkdirSync(evidence, { recursive: true })

// ---------- 数据：样例 6 题 + 40 道第一单元题 ----------
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-lib-classify-data-'))
const seed = seedDataDir(dataDir)
const UNIT_TITLE = '样例中学2026-2027学年七年级上学期第一单元测试数学试题'
const FILLER = 40
const k = (id: number, name: string) => ({ id, name, subject: 'czsx' })
const DAO_SHU = k(4740, '倒数')
const ADD = k(4731, '有理数加法运算')
const MUL = k(4748, '两个有理数的乘法运算')
// 第 i 题：难度每四题一轮 容易 0.9 / 适中 0.7 / 适中 0.6 / 困难 0.45；i%5==0 带「倒数」，第 0 题带三个知识点
const fillerDifficulty = (i: number): number => [0.9, 0.7, 0.6, 0.45][i % 4]
const LONG_KNOWLEDGE = k(4999, '含有多个符号的有理数混合运算与绝对值化简综合应用')
const fillerKnowledge = (i: number) => (i === 0 ? [DAO_SHU, ADD, MUL] : i === 1 ? [LONG_KNOWLEDGE] : i % 5 === 0 ? [DAO_SHU] : [])
// 前 30 道单选题，后 10 道各一种题型：全库共 16 个题型大类，题型块默认列 8 个
const EXTRA_TYPES = ['多选题', '判断题', '阅读理解', '实验题', '作图题', '应用题', '综合题', '问答题', '语音题', '七选五']
const fillerType = (i: number): string => (i < 30 ? '单选题' : EXTRA_TYPES[i - 30])
const fillerIds: number[] = []
{
  const db = openDatabase(dataDir)
  const now = new Date().toISOString()
  const paperId = Number(db.prepare('INSERT INTO source_papers (url, title, fetched_at) VALUES (?, ?, ?)').run('https://zujuan.xkw.com/2p1000003.html', UNIT_TITLE, now).lastInsertRowid)
  const insert = db.prepare(
    `INSERT INTO questions (zujuan_qid, source_paper_id, source_label, source_order, question_type, number_count, stem_html, answer_html, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (let i = 0; i < FILLER; i++) {
    const id = Number(insert.run(`91${String(i).padStart(4, '0')}`, paperId, '26-27七年级上·样例市·第一单元', i, fillerType(i), 1, `<p>第一单元练习 ${i + 1}：计算 ${i + 1} + (−${i + 2})</p>`, null, `filler-${i}`, now).lastInsertRowid)
    saveQuestionMeta(db, id, { knowledge: fillerKnowledge(i), difficulty: fillerDifficulty(i) })
    fillerIds.push(id)
  }
  db.close()
}
const TOTAL = 6 + FILLER
const UNIT_OPTION = `${UNIT_TITLE}（${FILLER} 题）`

buildTo(OUT)
const { app, window } = await launchApp({ outDir: OUT, dataDir })
const problems: string[] = []
window.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
window.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`))

let passed = 0
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    await window.screenshot({ path: join(evidence, `failure-${passed + 1}.png`) }).catch(() => undefined)
    console.error(`  ✗ ${name}`)
    throw error
  }
  passed++
  console.log(`  ✓ ${name}`)
}

// ---------- 小工具 ----------
const SIZES = [
  [1440, 900],
  [1280, 800],
  [1000, 640]
] as const
async function resize(w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h])
  await window.waitForTimeout(300)
}
// 三种窗口各截一张，并检查没有横向滚动、左栏内容不被横向裁切
async function shots(name: string): Promise<void> {
  for (const [w, h] of SIZES) {
    await resize(w, h)
    const overflow = await window.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('.lb-filter')
      return { page: document.documentElement.scrollWidth - window.innerWidth, rail: rail ? rail.scrollWidth - rail.clientWidth : 0 }
    })
    assert.ok(overflow.page <= 0, `${name} ${w}×${h} 页面横向溢出 ${overflow.page}px`)
    assert.ok(overflow.rail <= 0, `${name} ${w}×${h} 左栏横向溢出 ${overflow.rail}px`)
    await window.screenshot({ path: join(evidence, `${name}-${w}x${h}.png`) })
  }
  await resize(1440, 900)
}

const rail = window.locator('.lb-filter')
const cards = window.getByTestId('question-card')
const total = window.getByTestId('library-total')
const toast = (text: string): Locator => window.getByTestId('toast').filter({ hasText: text })
const lib = <T,>(fn: (library: Window['workbench']['library']) => Promise<T>): Promise<T> => window.evaluate(`(${fn.toString()})(window.workbench.library)`) as Promise<T>
const totalText = async (): Promise<string> => (await total.innerText()).replace(/\s+/g, '')
const chips = async (): Promise<string[]> => (await window.locator('.lb-chip-label').allInnerTexts()).map((t) => t.trim())
const block = (title: string): Locator => rail.locator('section.cf-block').filter({ has: window.locator('.cf-title', { hasText: new RegExp(`^${title}$`) }) })
const bar = window.getByRole('toolbar', { name: '批量操作' })
const headBox = window.getByLabel('选择已显示的全部题目')
const modal = (name: string): Locator => window.getByRole('dialog', { name })
const closeModal = (name: string): Promise<void> => modal(name).locator('.ui-modal-foot').getByRole('button', { name: '关闭', exact: true }).click()
const chapters = () => lib((l) => l.listChapters())
const chapterByName = async (name: string) => {
  const found = (await chapters()).find((c) => c.name === name)
  assert.ok(found, `没有章节「${name}」`)
  return found
}
const clearFilter = async (): Promise<void> => {
  const clear = rail.getByRole('button', { name: '清除筛选', exact: true })
  if (await clear.count()) await clear.click()
  await window.getByText(`共 ${TOTAL} 道题`).waitFor()
}
const pickUnitPaper = async (): Promise<void> => {
  await rail.locator('select').selectOption({ label: UNIT_OPTION })
  await window.getByText(`筛出 ${FILLER} 道，全库 ${TOTAL} 道`).waitFor()
}
const withClass = (n: number): string => `筛出 ${n} 道，全库 ${TOTAL} 道`
const row = (index: number): Locator => cards.nth(index - 1)
// 章节块里把某章的节展开（已经展开就不动）
const expandChapter = async (name: string): Promise<void> => {
  const open = block('章节').getByRole('button', { name: `展开${name}` })
  if (await open.count()) await open.click()
  await block('章节').getByRole('button', { name: `收起${name}` }).waitFor()
}

try {
  await window.getByRole('button', { name: '试题库', exact: true }).click()
  await cards.first().waitFor()
  await resize(1440, 900)
  await window.getByText(`共 ${TOTAL} 道题`).waitFor()

  // ================= 一、左栏顺序与题数 =================
  await step('左栏筛选顺序：关键词、章节、题型、难度、知识点、标签、来源卷；没有章节与标签时各有提示与入口', async () => {
    const titles = await rail.locator('.lb-label, .cf-title').allInnerTexts()
    assert.deepEqual(titles.map((t) => t.trim()), ['关键词', '章节', '题型', '难度', '知识点', '标签', '来源卷'])
    assert.match(await block('章节').innerText(), /还没有章节/)
    assert.match(await block('标签').innerText(), /还没有标签/)
    await block('章节').getByRole('button', { name: '管理章节' }).waitFor()
    await block('标签').getByRole('button', { name: '管理标签' }).waitFor()
    // 左栏内容变长时自己滚动：左栏高度固定，内容比它高
    const scroll = await rail.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }))
    assert.ok(scroll.scroll > scroll.client && /auto|scroll/.test(scroll.overflowY), `左栏应能自己滚动：${JSON.stringify(scroll)}`)
  })

  await step('难度只列库里出现的档位，题数 12 / 22 / 11（样例 5 题 + 40 道的难度分布）；知识点题多的在前', async () => {
    const tiles = await block('难度').locator('.cf-chip').allInnerTexts()
    assert.deepEqual(tiles.map((t) => t.replace(/\s+/g, '')), ['容易12', '适中22', '困难11'])
    const first = await block('知识点').locator('.cf-row').first().innerText()
    assert.match(first.replace(/\s+/g, ''), /^倒数8$/)
  })

  // ================= 二、章节管理 =================
  await step('管理章节：新建章与节、连续新建、30 字名称可建、31 字提示并禁用、同级重名报中文原因、Esc 只收起输入不关弹窗', async () => {
    await block('章节').getByRole('button', { name: '管理章节' }).click()
    const dlg = modal('管理章节')
    await dlg.waitFor()
    await shots('chapter-manager-empty')
    const input = dlg.getByLabel('新章的名称')
    await input.fill('第一章 有理数')
    await input.press('Enter')
    await dlg.getByText('第一章 有理数', { exact: true }).waitFor()
    // 在章下连续新建两个节
    await dlg.getByRole('button', { name: '在「第一章 有理数」下新建节' }).click()
    const sectionInput = dlg.getByLabel('「第一章 有理数」下新节的名称')
    await sectionInput.fill('1.1 正数和负数')
    await sectionInput.press('Enter')
    await dlg.getByText('1.1 正数和负数', { exact: true }).waitFor()
    await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '「第一章 有理数」下新节的名称') // 连续新建：焦点留在输入框
    await sectionInput.fill('1.2 数轴')
    await sectionInput.press('Enter')
    await dlg.getByText('1.2 数轴', { exact: true }).waitFor()
    await sectionInput.press('Escape')
    assert.equal(await sectionInput.count(), 0, 'Esc 收起新建节的输入')
    await dlg.waitFor() // 弹窗还在
    // 同级重名
    await input.fill('第一章 有理数')
    await input.press('Enter')
    const dup = dlg.getByRole('alert').filter({ hasText: '同一级已有「第一章 有理数」' })
    await dup.waitFor()
    assert.equal(await input.getAttribute('aria-invalid'), 'true', '重名：输入框标红')
    assert.equal(await dup.evaluate((el) => getComputedStyle(el).color), 'rgb(195, 50, 43)', '重名：红字')
    assert.equal(await input.evaluate((el) => getComputedStyle(el.parentElement!).borderTopColor), 'rgb(195, 50, 43)', '重名：红框')
    assert.equal(await window.getByTestId('toast').filter({ hasText: '同一级已有' }).count(), 0, '错误不再弹 toast')
    await shots('chapter-manager-error')
    assert.ok(!(await dlg.innerText()).includes('Error invoking'), '错误提示不带 IPC 前缀')
    await input.fill('')
    assert.equal(await dlg.getByRole('alert').count(), 0, '改动输入后提示消失')
    // 空名：回车后提示，不调接口
    await input.press('Enter')
    await dlg.getByRole('alert').filter({ hasText: '章节名不能为空' }).waitFor()
    await input.fill('　　')
    assert.equal(await dlg.getByRole('button', { name: '新建章', exact: true }).isDisabled(), true)
    await input.fill('')
    // 同名的节可以出现在别的章下，同章下不行
    await dlg.getByRole('button', { name: '在「第一章 有理数」下新建节' }).click()
    await sectionInput.fill('1.2 数轴')
    await sectionInput.press('Enter')
    await dlg.getByRole('alert').filter({ hasText: '同一级已有「1.2 数轴」' }).waitFor()
    await sectionInput.press('Escape')
    assert.equal(await dlg.getByRole('alert').count(), 0, '收起输入后提示一并消失')
    // 30 字可建，31 字提示且保存不可用
    const long30 = Array.from('第四章 一元一次方程在行程问题工程问题销售问题中的应用综合训练专题').slice(0, 30).join('')
    assert.equal(Array.from(long30).length, 30)
    await input.fill(long30 + '题')
    assert.match(await dlg.getByRole('alert').innerText(), /章节名最多 30 字/)
    assert.equal(await dlg.getByRole('alert').evaluate((el) => getComputedStyle(el).color), 'rgb(195, 50, 43)', '超长提示是红色')
    assert.equal(await dlg.getByRole('button', { name: '新建章', exact: true }).isDisabled(), true)
    await input.fill(long30)
    await input.press('Enter')
    await dlg.getByText(long30, { exact: true }).waitFor()
    await input.fill('第二章 整式的加减')
    await input.press('Enter')
    await dlg.getByText('第二章 整式的加减', { exact: true }).waitFor()
    await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '新章的名称')
    const list = await chapters()
    assert.deepEqual(list.map((c) => [c.name, c.parentId === null ? '章' : '节']), [
      ['第一章 有理数', '章'],
      ['1.1 正数和负数', '节'],
      ['1.2 数轴', '节'],
      [long30, '章'],
      ['第二章 整式的加减', '章']
    ])
    await shots('chapter-manager-filled')
  })

  await step('管理章节：行内改名、同级上移下移（章与节各自在同级内）、改成同级已有名称报错、第一项不能上移最后一项不能下移', async () => {
    const dlg = modal('管理章节')
    await dlg.getByRole('button', { name: '改名：第二章 整式的加减' }).click()
    const edit = dlg.getByLabel('「第二章 整式的加减」的新名称')
    await edit.fill('第二章 整式')
    await edit.press('Enter')
    await dlg.getByText('第二章 整式', { exact: true }).waitFor()
    // 改成同级已有的名字：报错，仍在编辑
    await dlg.getByRole('button', { name: '改名：第二章 整式' }).click()
    await dlg.getByLabel('「第二章 整式」的新名称').fill('第一章 有理数')
    await dlg.getByLabel('「第二章 整式」的新名称').press('Enter')
    await dlg.getByRole('alert').filter({ hasText: '同一级已有「第一章 有理数」' }).waitFor()
    await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '「第二章 整式」的新名称') // 出错后焦点回到输入框
    await dlg.getByLabel('「第二章 整式」的新名称').press('Escape')
    await dlg.waitFor()
    // 边界按钮
    assert.equal(await dlg.getByRole('button', { name: '上移：第一章 有理数' }).isDisabled(), true)
    assert.equal(await dlg.getByRole('button', { name: '下移：第二章 整式' }).isDisabled(), true)
    // 第二章上移一位：排到 30 字章前面
    await dlg.getByRole('button', { name: '上移：第二章 整式' }).click()
    await window.waitForFunction(async () => (await window.workbench.library.listChapters()).filter((c) => c.parentId === null)[1]?.name === '第二章 整式')
    // 节：1.2 上移到 1.1 前面
    await dlg.getByRole('button', { name: '上移：1.2 数轴' }).click()
    await window.waitForFunction(async () => (await window.workbench.library.listChapters()).filter((c) => c.parentId !== null)[0]?.name === '1.2 数轴')
    await dlg.getByRole('button', { name: '下移：1.2 数轴' }).click()
    await window.waitForFunction(async () => (await window.workbench.library.listChapters()).filter((c) => c.parentId !== null)[0]?.name === '1.1 正数和负数')
    // 第二章回到最后（再下移两次到末尾）
    await dlg.getByRole('button', { name: '下移：第二章 整式' }).click()
    await window.waitForFunction(async () => (await window.workbench.library.listChapters()).filter((c) => c.parentId === null).at(-1)?.name === '第二章 整式')
    const tops = (await chapters()).filter((c) => c.parentId === null).map((c) => c.name)
    assert.equal(tops.at(-1), '第二章 整式')
    assert.equal(tops[0], '第一章 有理数')
    // 数量显示：新建的章节还没有题
    assert.match(await dlg.locator('.lb-cm-row--top').first().innerText(), /0 道题/)
    // 临时的 30 字章用不到，删除它（没有题，确认框写明没有题目归在这里）
    await dlg.getByRole('button', { name: new RegExp(`^删除：${tops[1]}$`) }).click()
    assert.match(await modal(`删除章节「${tops[1]}」`).innerText(), /没有题目归在这里，其他章节不受影响。/)
    await modal(`删除章节「${tops[1]}」`).getByRole('button', { name: '删除', exact: true }).click()
    await window.waitForFunction(async (n) => (await window.workbench.library.listChapters()).every((c) => c.name !== n), tops[1])
    await closeModal('管理章节')
    // 章节筛选块列出新建的章，节随章展开
    await block('章节').locator('.cf-row').first().waitFor()
    const names = (await block('章节').locator('.cf-item span').allInnerTexts()).map((t) => t.trim())
    assert.deepEqual(names.slice(0, 3), ['未归章节', '第一章 有理数', '第二章 整式'])
  })

  // ================= 三、勾选与归到章节 =================
  await step('勾选：表头勾选已显示的 30 道，出现「全选筛出的 40 道」，点后改按条件操作（已选 40 道，跨分页）', async () => {
    await pickUnitPaper()
    assert.equal(await cards.count(), 30)
    await headBox.click()
    assert.equal((await bar.getByTestId('bulk-count').innerText()).trim(), '已选 30 道')
    assert.equal(await cards.locator('.lb-sel input:checked').count(), 30)
    await bar.getByRole('button', { name: `全选筛出的 ${FILLER} 道` }).click()
    assert.equal((await bar.getByTestId('bulk-count').innerText()).replace(/\s+/g, ''), `已选${FILLER}道（筛出的全部）`)
    assert.equal(await bar.getByRole('button', { name: /全选筛出的/ }).count(), 0)
    await shots('selection-bar-all')
    // 取消一道：改成具体的 39 道，「全选筛出的 40 道」重新出现
    await row(3).getByLabel('选择第 3 题').click()
    await bar.getByText('已选 39 道', { exact: true }).waitFor()
    await bar.getByRole('button', { name: `全选筛出的 ${FILLER} 道` }).waitFor()
    await bar.getByRole('button', { name: `全选筛出的 ${FILLER} 道` }).click()
    await bar.getByText(`已选 ${FILLER} 道（筛出的全部）`).waitFor()
  })

  await step('全选筛出的 40 道归到「1.2 数轴」：库里 40 道都归到这个节（不是只有第一页 30 道），勾选清空，toast 写结果，题目行显示章节', async () => {
    await bar.getByRole('button', { name: '归到章节' }).click()
    const picker = window.getByRole('dialog', { name: '归到章节', exact: true })
    await picker.waitFor()
    // 章在前、节缩进在其下，最后是「移出章节」
    const labels = (await picker.locator('.lb-cp-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
    assert.deepEqual(labels, ['第一章 有理数 0', '1.1 正数和负数 0', '1.2 数轴 0', '第二章 整式 0', '移出章节（回到「未归章节」）'])
    await shots('chapter-picker')
    await picker.locator('.lb-cp-row--sub').filter({ hasText: '1.2 数轴' }).click()
    await toast(`已把 ${FILLER} 道题归到「第一章 有理数 › 1.2 数轴」`).waitFor()
    const node = await chapterByName('1.2 数轴')
    const assigned = await lib((l) => l.listQuestions({ limit: 1000 }))
    const inNode = assigned.items.filter((q) => q.chapterId === node.id).map((q) => q.id).sort((a, b) => a - b)
    assert.deepEqual(inNode, [...fillerIds].sort((a, b) => a - b), '40 道都应归到 1.2 数轴')
    assert.ok(assigned.items.filter((q) => !fillerIds.includes(q.id)).every((q) => q.chapterId === null), '其余题不受影响')
    assert.equal(await bar.count(), 0, '操作后清空勾选')
    // 题目行显示「章节 第一章 有理数 › 1.2 数轴」
    const chapterMeta = row(1).getByTestId('meta-chapter')
    assert.equal((await chapterMeta.innerText()).replace(/\s+/g, ''), '章节第一章有理数›1.2数轴')
    // 章节管理里的题数：章包含其下各节
    const list = await chapters()
    assert.equal(list.find((c) => c.name === '第一章 有理数')?.count, FILLER)
    assert.equal(list.find((c) => c.name === '1.2 数轴')?.count, FILLER)
    assert.equal(list.find((c) => c.name === '1.1 正数和负数')?.count, 0)
  })

  await step('章节筛选：选章含其下各节、未归章节、章与未归章节并集、题数随其他条件变；展开节后选节；chip 用名称', async () => {
    await clearFilter()
    const chapterBlock = block('章节')
    const counts = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {}
      for (const text of await chapterBlock.locator('.cf-item').allInnerTexts()) {
        const m = text.trim().split(/\s*\n\s*/)
        out[m[0]] = m[1]
      }
      return out
    }
    assert.deepEqual(await counts(), { 未归章节: '6', '第一章 有理数': '40', '第二章 整式': '0' })
    await chapterBlock.getByRole('button', { name: /^第一章 有理数/ }).click()
    await window.getByText(withClass(FILLER)).waitFor()
    assert.deepEqual(await chips(), ['章节：第一章 有理数'])
  })

  await step('章节筛选（续）：展开章后选节，章与「未归章节」并集 46 道，清除本项', async () => {
    const chapterBlock = block('章节')
    await clearFilter()
    await expandChapter('第一章 有理数')
    const node = chapterBlock.locator('.cf-row--sub').filter({ hasText: '1.2 数轴' })
    await node.locator('.cf-item').click()
    await window.getByText(withClass(FILLER)).waitFor()
    assert.deepEqual(await chips(), ['章节：第一章 有理数 › 1.2 数轴'])
    // 选「未归章节」并上：并集
    await chapterBlock.locator('.cf-row').filter({ hasText: '未归章节' }).locator('.cf-item').click()
    await window.getByText(withClass(TOTAL)).waitFor()
    assert.deepEqual(await chips(), ['章节：第一章 有理数 › 1.2 数轴 等 2 个'])
    assert.equal(await window.locator('.lb-chip-label').first().getAttribute('title'), '章节：第一章 有理数 › 1.2 数轴、未归章节')
    await chapterBlock.getByRole('button', { name: '清除章节的选择' }).click()
    await window.getByText(`共 ${TOTAL} 道题`).waitFor()
    assert.deepEqual(await chips(), [])
  })

  await step('归到章节：勾选具体几道归到章，再归一次即移动（一题只属于一个章节）；移出章节回到未归章节', async () => {
    await clearFilter()
    // 只看第二章下没有的：用未归章节（6 道）筛选，勾第 1、2 道归到「第二章 整式」
    const chapterBlock = block('章节')
    await chapterBlock.locator('.cf-row').filter({ hasText: '未归章节' }).locator('.cf-item').click()
    await window.getByText(withClass(6)).waitFor()
    const picked = await Promise.all([1, 2].map(async (i) => Number(await row(i).locator('.lb-idx').innerText())))
    assert.deepEqual(picked, [1, 2])
    await row(1).getByLabel('选择第 1 题').click()
    await row(2).getByLabel('选择第 2 题').click()
    await bar.getByText('已选 2 道', { exact: true }).waitFor()
    await bar.getByRole('button', { name: '归到章节' }).click()
    await window.getByRole('dialog', { name: '归到章节', exact: true }).locator('.lb-cp-row').filter({ hasText: '第二章 整式' }).click()
    await toast('已把 2 道题归到「第二章 整式」').waitFor()
    await window.getByText(withClass(4)).waitFor() // 离开了「未归章节」，题数少 2
    const second = await chapterByName('第二章 整式')
    assert.equal(second.count, 2)
    // 再归一次即移动：把这 2 道移到「1.1 正数和负数」
    await clearFilter()
    await chapterBlock.getByRole('button', { name: /^第二章 整式/ }).click()
    await window.getByText(withClass(2)).waitFor()
    await headBox.click()
    await bar.getByRole('button', { name: '归到章节' }).click()
    await window.getByRole('dialog', { name: '归到章节', exact: true }).locator('.lb-cp-row--sub').filter({ hasText: '1.1 正数和负数' }).click()
    // 这 2 道已在「第二章 整式」：归到别的章节等于移动，先确认
    const ask = modal('归到章节「第一章 有理数 › 1.1 正数和负数」')
    assert.match((await ask.locator('.ui-confirm-body').innerText()).trim(), /^所选 2 道题里，其中 2 道已在别的章节，将移到「第一章 有理数 › 1\.1 正数和负数」；其余 0 道直接归入。未选中的题不受影响。$/)
    await ask.getByRole('button', { name: '移动', exact: true }).click()
    await toast('已把 2 道题归到「第一章 有理数 › 1.1 正数和负数」').waitFor()
    // 当前条件是第二章：这 2 道已离开，列表为空，写出当前条件
    await window.getByText('没有符合条件的题目').waitFor()
    assert.match(await window.locator('.lb-empty').innerText(), /当前条件：章节「第二章 整式」/)
    await shots('empty-chapter')
    assert.equal((await chapterByName('第二章 整式')).count, 0)
    assert.equal((await chapterByName('第一章 有理数')).count, FILLER + 2)
    // 移出章节：选第一章，勾 1.1 里的那 2 道，移出
    await clearFilter()
    await expandChapter('第一章 有理数')
    await chapterBlock.locator('.cf-row--sub').filter({ hasText: '1.1 正数和负数' }).locator('.cf-item').click()
    await window.getByText(withClass(2)).waitFor()
    await headBox.click()
    await bar.getByRole('button', { name: '归到章节' }).click()
    await window.getByRole('dialog', { name: '归到章节', exact: true }).getByRole('button', { name: /^移出章节/ }).click()
    await toast('已把 2 道题移出章节').waitFor()
    await window.getByText('没有符合条件的题目').waitFor()
    assert.equal((await chapterByName('第一章 有理数')).count, FILLER)
    await clearFilter()
    assert.equal((await lib((l) => l.listQuestions({ limit: 1000 }))).items.filter((q) => q.chapterId === null).length, 6)
  })

  // ================= 四、标签 =================
  await step('单题打标签：输入新建回车、行上出现标签、toast、20 字可建、21 字提示且不新建、全角空格同名不新建、HTML 名称按文字显示', async () => {
    await clearFilter()
    await row(1).getByRole('button', { name: '给第 1 题打标签' }).click()
    const picker = window.getByRole('dialog', { name: '打标签', exact: true })
    const search = picker.getByRole('combobox', { name: '搜索或新建标签' })
    await search.fill('易错')
    await search.press('Enter')
    await picker.getByRole('option', { name: /^易错\s/ }).waitFor()
    assert.equal(await picker.getByRole('option', { name: /^易错\s/ }).getAttribute('aria-selected'), 'true')
    // 全角空格、大小写：同名视为同一个，回车只勾不新建
    const before = (await lib((l) => l.listTags())).length
    await search.fill('　易错　')
    await search.press('Enter')
    assert.equal((await lib((l) => l.listTags())).length, before, '全角空格包着的同名不新建')
    // 20 字可建
    const tag20 = Array.from('七年级上册第一单元月考易错题整理汇总再加一点').slice(0, 20).join('')
    await search.fill(tag20)
    await picker.getByRole('option', { name: /新建/ }).click()
    await picker.getByRole('option', { name: new RegExp(`^${tag20}`) }).waitFor()
    // 21 字：提示，不出现新建
    await search.fill(tag20 + '多')
    assert.match(await picker.getByRole('alert').innerText(), /标签名最多 20 字/)
    assert.equal(await picker.getByRole('alert').evaluate((el) => getComputedStyle(el).color), 'rgb(195, 50, 43)', '阻止保存的超长提示是红色')
    assert.equal(await picker.getByRole('option', { name: /新建/ }).count(), 0)
    // HTML 名称：按文字显示，不解析成标签
    const html = '<img src=x onload=1>'
    await search.fill(html)
    await picker.getByRole('option', { name: /新建/ }).click()
    await picker.getByRole('option', { name: new RegExp(`^${html.replace(/[<>=]/g, '.')}`) }).waitFor()
    await shots('row-tag-picker')
    // 选择框开着时每勾一次不弹提示；关闭时汇总成一条
    assert.equal(await window.getByTestId('toast').filter({ hasText: '已给这道题' }).count(), 0, '选择框开着时不弹提示')
    await window.keyboard.press('Escape')
    await picker.waitFor({ state: 'detached' })
    await toast(`已给这道题打上「易错」、「${tag20}」、「${html}」`).waitFor()
    assert.equal(await window.getByTestId('toast').filter({ hasText: '已给这道题' }).count(), 1, '三次勾选只有一条汇总')
    // 行上显示：三个标签，HTML 名称是文字
    const chipsText = (await row(1).getByTestId('meta-tag').allInnerTexts()).map((t) => t.trim())
    assert.equal(chipsText.length, 3)
    assert.ok(chipsText.includes(html) && chipsText.includes('易错') && chipsText.includes(tag20), chipsText.join(' | '))
    assert.equal(await row(1).locator('.lb-meta img').count(), 0, '标签名里的 HTML 不能被解析')
    const tagChipWidth = await row(1).getByTestId('meta-tag').filter({ hasText: tag20 }).evaluate((el) => el.getBoundingClientRect().width)
    assert.ok(tagChipWidth <= 161, `20 字标签在行内截断，宽 ${tagChipWidth}`)
    // 左栏标签块：易错 1、20 字名称带省略号不撑宽
    assert.match((await block('标签').innerText()).replace(/\s+/g, ' '), /易错 1/)
  })

  await step('批量打标签：半选显示、点一下全选、toast 写题数；去标签只列所选题带着的标签；管理标签入口', async () => {
    // 先让「易错」只在第 1 道（已有），所选 3 道里它是半选
    await row(1).getByLabel('选择第 1 题').click()
    await row(2).getByLabel('选择第 2 题').click()
    await row(3).getByLabel('选择第 3 题').click()
    await bar.getByText('已选 3 道', { exact: true }).waitFor()
    await bar.getByRole('button', { name: '打标签' }).click()
    const picker = window.getByRole('dialog', { name: '给所选题目打标签' })
    const easy = picker.getByRole('option', { name: /^易错\s/ })
    await easy.waitFor()
    assert.equal(await easy.getAttribute('aria-checked'), 'mixed', '只有第 1 道带「易错」：半选')
    await shots('bulk-tag-picker-mixed')
    await easy.click()
    await picker.locator('[role=option][aria-checked="true"]').filter({ hasText: /^易错/ }).waitFor()
    assert.equal(await window.getByTestId('toast').filter({ hasText: '已给 3 道题' }).count(), 0, '选择框开着时不弹提示')
    const tagged = (await lib((l) => l.listQuestions({ limit: 1000 }))).items.filter((q) => q.tags.some((t) => t.name === '易错'))
    assert.equal(tagged.length, 3)
    await window.keyboard.press('Escape')
    await toast('已给 3 道题打上「易错」').waitFor()
    // 勾选保持，去标签：只列这 3 道带着的标签
    await bar.getByText('已选 3 道', { exact: true }).waitFor()
    await bar.getByRole('button', { name: '去标签' }).click()
    const remover = window.getByRole('dialog', { name: '去掉所选题目的标签' })
    await remover.getByRole('option', { name: /^易错\s/ }).waitFor()
    const listed = (await remover.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
    assert.ok(listed.some((t) => t.startsWith('易错')) && listed.some((t) => t.startsWith('七年级上册')) && listed.some((t) => t.startsWith('<img')), listed.join(' | '))
    assert.equal(listed.length, 3, '去标签只列所选题带着的标签（易错、20 字标签、HTML 名称）')
    await shots('bulk-untag-picker')
    // 去标签的框只在已有标签里搜索：没有「新建」行，回车不新建
    const before = (await lib((l) => l.listTags())).length
    await remover.getByRole('combobox').fill('不存在的标签')
    await remover.getByText('没有匹配的标签', { exact: true }).waitFor()
    assert.equal(await remover.getByText(/新建/).count(), 0)
    await remover.getByRole('combobox').press('Enter')
    assert.equal((await lib((l) => l.listTags())).length, before)
    await remover.getByRole('combobox').fill('')
    await remover.getByRole('option', { name: /^易错\s/ }).click()
    assert.equal((await lib((l) => l.listQuestions({ limit: 1000 }))).items.filter((q) => q.tags.some((t) => t.name === '易错')).length, 0)
    await remover.getByRole('option', { name: /^易错\s/ }).waitFor({ state: 'detached' }) // 去掉后这一行消失
    await window.keyboard.press('Escape')
    await toast('已从 3 道题去掉「易错」').waitFor()
    await bar.getByRole('button', { name: '取消选择' }).click()
    assert.equal(await bar.count(), 0)
  })

  // ================= 五、四项筛选、chip、无结果、清除 =================
  // 经接口改过数据后，重新进入试题库让界面重读章节与标签
  const remount = async (): Promise<void> => {
    await window.getByRole('button', { name: '试卷库', exact: true }).click()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await cards.first().waitFor()
  }

  await step('四项筛选：同项并集、跨项交集、题数随其他条件变（难度 适中+困难 ∩ 知识点 倒数 = 6 道；难度各档按其他条件重算）', async () => {
    // 前 12 道（第一单元第 0–11 题）打上「易错」，后面组合筛选要用
    const tagId = (await lib((l) => l.createTag('易错'))).id
    await window.evaluate(([ids, id]) => window.workbench.library.changeQuestionTags({ ids: ids as number[] }, { add: [id as number] }), [fillerIds.slice(0, 12), tagId])
    await remount()
    await clearFilter()
    await pickUnitPaper()
    // 难度：适中 + 困难 = 20 + 10
    await block('难度').locator('.cf-chip').filter({ hasText: '适中' }).click()
    await window.getByText(withClass(20)).waitFor()
    await block('难度').locator('.cf-chip').filter({ hasText: '困难' }).click()
    await window.getByText(withClass(30)).waitFor()
    assert.deepEqual(await chips(), ['来源卷：' + UNIT_TITLE, '难度：适中、困难'])
    // 知识点：倒数（来源卷内 8 道）；与难度取交集 = 6
    const knowledge = block('知识点')
    await knowledge.locator('.cf-row').filter({ hasText: '倒数' }).first().locator('.cf-item').click()
    await window.getByText(withClass(6)).waitFor()
    assert.equal(await cards.count(), 6)
    const chipText = await chips()
    assert.deepEqual(chipText.slice(1), ['难度：适中、困难', '知识点：倒数'])
    // 难度各档的题数按「其他条件」算、本项不参与：来源卷 + 倒数 内 容易 2、适中 4、困难 2
    const tiles = (await block('难度').locator('.cf-chip').allInnerTexts()).map((t) => t.replace(/\s+/g, ''))
    assert.deepEqual(tiles, ['容易2', '适中4', '困难2'])
    // 与接口一致
    const viaApi = await lib((l) => l.listQuestions({ difficulties: ['medium', 'hard'], knowledgeIds: [4740], limit: 1000 }))
    assert.equal(viaApi.total, 6)
    await shots('filters-combined')
    // 再加标签：易错只在第一单元前 12 道里；与上面交集：i in {5,10}（倒数且适中/困难且 <12），i=0 是容易
    const tagBlock = block('标签')
    await tagBlock.locator('.cf-chip').filter({ hasText: /^易错\d+$/ }).click()
    await window.getByText(withClass(2)).waitFor()
    assert.deepEqual((await chips()).slice(1), ['难度：适中、困难', '知识点：倒数', '标签：易错'])
    // 点 chip 的 × 只清掉知识点；剩下 来源卷 ∩ 适中困难 ∩ 易错（前 12 道里不是「容易」的）自己数一遍
    await window.getByRole('button', { name: '清除筛选：知识点：倒数' }).click()
    const expected = Array.from({ length: FILLER }, (_, i) => i).filter((i) => i < 12 && fillerDifficulty(i) < 0.8).length
    assert.equal(expected, 9)
    await window.getByText(withClass(expected)).waitFor()
    assert.equal(await cards.count(), expected)
  })

  await step('无结果时写出当前条件（章节、难度、知识点、标签都写名称）、清除筛选一键回到全部、换条件清空勾选', async () => {
    await clearFilter()
    await block('难度').locator('.cf-chip').filter({ hasText: '困难' }).click()
    // 知识点：困难题里的「正负数的实际应用」（样例第 4 题）；用搜索框找，列表默认只列 10 行
    await block('知识点').getByRole('textbox', { name: '搜索知识点' }).fill('正负数的实际应用')
    await block('知识点').locator('.cf-row').filter({ hasText: '正负数的实际应用' }).first().locator('.cf-item').click()
    // 标签「易错」在这个条件下 0 道：变淡但仍可选，选上后结果为空
    await block('标签').locator('.cf-chip').filter({ hasText: /^易错\d+$/ }).click()
    await window.getByText('没有符合条件的题目').waitFor()
    const text = (await window.locator('.lb-empty').innerText()).replace(/\s+/g, '')
    assert.match(text, /当前条件：难度「困难」，知识点「正负数的实际应用」，标签「易错」/)
    assert.ok(!/\b\d{3,}\b/.test(text.replace(/^.*当前条件：/, '')), '条件里不出现编号')
    await shots('empty-filters')
    await window.locator('.lb-empty').getByRole('button', { name: '清除筛选', exact: true }).click()
    await window.getByText(`共 ${TOTAL} 道题`).waitFor()
    assert.deepEqual(await chips(), [])
    assert.equal(await rail.getByRole('button', { name: '清除筛选', exact: true }).count(), 0)
    // 换筛选条件清空勾选
    await headBox.click()
    await bar.getByText('已选 30 道', { exact: true }).waitFor()
    await block('难度').locator('.cf-chip').filter({ hasText: '容易' }).click()
    await window.getByText(withClass(12)).waitFor()
    assert.equal(await bar.count(), 0, '换条件后勾选清空')
    assert.equal(await cards.locator('.lb-sel input:checked').count(), 0)
    // 同样，切到别的页面再回来条件还在
    await window.getByRole('button', { name: '试卷库', exact: true }).click()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await window.getByText(withClass(12)).waitFor()
    assert.deepEqual(await chips(), ['难度：容易'])
    await clearFilter()
  })

  await step('知识点多选「等 N 个」chip 与悬停全名；章节 chip 名称；全部条件的 chip 都能逐个清除', async () => {
    const knowledge = block('知识点')
    await knowledge.locator('.cf-row').filter({ hasText: '倒数' }).first().locator('.cf-item').click()
    await knowledge.locator('.cf-row.is-on').first().waitFor()
    await knowledge.locator('.cf-row').filter({ hasText: '有理数加法运算' }).first().locator('.cf-item').click()
    assert.deepEqual(await chips(), ['知识点：倒数 等 2 个'])
    assert.equal(await window.locator('.lb-chip-label').first().getAttribute('title'), '知识点：倒数、有理数加法运算')
    await window.getByRole('button', { name: '清除筛选：知识点：倒数、有理数加法运算' }).click()
    assert.deepEqual(await chips(), [])
  })

  // ================= 六、删除正在使用的章节与标签 =================
  await step('删除正在使用的章节：确认框写明及其下 2 个节与 40 道题回到未归章节；筛选里选着它时条件一并去掉，列表回到全部', async () => {
    assert.equal((await chapterByName('第一章 有理数')).count, FILLER)
    // 筛选里选着「第一章 有理数」
    const chapterBlock = block('章节')
    await chapterBlock.getByRole('button', { name: /^第一章 有理数/ }).click()
    await window.getByText(withClass(FILLER)).waitFor()
    await chapterBlock.getByRole('button', { name: '管理章节' }).click()
    const dlg = modal('管理章节')
    await dlg.getByRole('button', { name: '删除：第一章 有理数' }).click()
    const confirm = modal('删除章节「第一章 有理数」')
    assert.equal((await confirm.locator('.ui-confirm-body').innerText()).trim(), '其下 2 个节一并删除，40 道题回到「未归章节」，题目本身不会删除。')
    await shots('chapter-delete-confirm')
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    assert.ok(await chapterByName('第一章 有理数'), '取消后章节仍在')
    await dlg.getByRole('button', { name: '删除：第一章 有理数' }).click()
    await confirm.getByRole('button', { name: '删除', exact: true }).click()
    await toast('已删除「第一章 有理数」，40 道题回到「未归章节」').waitFor()
    await closeModal('管理章节')
    assert.ok(!(await chapters()).some((c) => c.name.startsWith('第一章') || c.name === '1.2 数轴'))
    assert.deepEqual(await chips(), [], '选着已删除章节的筛选条件应一并去掉')
    await window.getByText(`共 ${TOTAL} 道题`).waitFor()
    const after = await lib((l) => l.listQuestions({ limit: 1000 }))
    assert.ok(after.items.every((q) => q.chapterId === null), '题回到未归章节')
    assert.equal(after.total, TOTAL, '删除章节不删题')
  })

  await step('管理标签：列表带题数、改名合并确认、删除正在使用的标签写明题数；筛选里选着它时条件一并去掉', async () => {
    const tag = (await lib((l) => l.listTags())).find((t) => t.name === '易错')!
    assert.equal(tag.count, 12)
    await block('标签').locator('.cf-chip').filter({ hasText: /^易错\d+$/ }).click()
    await window.getByText(withClass(12)).waitFor()
    assert.deepEqual(await chips(), ['标签：易错'])
    await block('标签').getByRole('button', { name: '管理标签' }).click()
    const dlg = modal('管理标签')
    await dlg.getByText('12 道题').waitFor()
    await shots('tag-manager')
    await dlg.getByRole('button', { name: '删除：易错' }).click()
    const confirm = modal('删除标签「易错」')
    assert.equal((await confirm.locator('.ui-confirm-body').innerText()).trim(), '12 道题会去掉这个标签，题目本身不受影响。')
    await confirm.getByRole('button', { name: '删除', exact: true }).click()
    await dlg.getByRole('button', { name: '删除：易错' }).waitFor({ state: 'detached' })
    await closeModal('管理标签')
    assert.deepEqual(await chips(), [], '选着已删除标签的筛选条件应一并去掉')
    await window.getByText(`共 ${TOTAL} 道题`).waitFor()
    assert.ok(!(await lib((l) => l.listTags())).some((t) => t.name === '易错'))
    assert.ok((await lib((l) => l.listQuestions({ limit: 1000 }))).total === TOTAL)
  })

  // ================= 七、题目行显示与中性样式 =================
  await step('题目行：章节、难度档位名、前两个知识点加 +N（悬停列全部）、标签；没有的项不占位；困难不标红、容易不标绿', async () => {
    await clearFilter()
    // 第 1 行是第一单元第 0 题：容易 0.9、三个知识点
    const r1 = row(1)
    assert.equal((await r1.getByTestId('meta-difficulty').innerText()).replace(/\s+/g, ''), '难度容易')
    const knowledge = r1.getByTestId('meta-knowledge')
    assert.equal((await knowledge.innerText()).replace(/\s+/g, ''), '知识点倒数、有理数加法运算+1')
    assert.equal(await knowledge.getAttribute('title'), '倒数、有理数加法运算、两个有理数的乘法运算')
    assert.equal(await r1.getByTestId('meta-chapter').count(), 0, '未归章节不占位')
    // 第 4 行：困难 0.45，样式与容易一致（都是中性字色），也不带边框与底色
    const style = async (loc: Locator) => loc.evaluate((el) => {
      const s = getComputedStyle(el)
      return { color: s.color, bg: s.backgroundColor, border: s.borderTopColor + s.borderTopWidth }
    })
    const hard = row(4).getByTestId('meta-difficulty')
    assert.equal((await hard.innerText()).replace(/\s+/g, ''), '难度困难')
    assert.deepEqual(await style(hard), await style(r1.getByTestId('meta-difficulty')))
    const { color } = await style(hard)
    const [r, g, b] = color.match(/\d+/g)!.map(Number)
    assert.ok(Math.abs(r - g) < 40 && Math.abs(g - b) < 40, `难度字色应是中性灰黑：${color}`)
    // 整个归类区（题目行的信息、左栏四个筛选块）没有红色或绿色的字、边、底：红只用于删除确认与错误，绿只用于「有答案」
    const tinted = await window.evaluate(() => {
      const bad = ['rgb(195, 50, 43)', 'rgb(46, 107, 69)', 'rgb(252, 239, 236)', 'rgb(234, 243, 236)']
      const hits: string[] = []
      for (const el of document.querySelectorAll('.lb-meta, .lb-meta *, .lb-filter .cf-block, .lb-filter .cf-block *')) {
        const s = getComputedStyle(el)
        for (const v of [s.color, s.backgroundColor, s.borderTopColor, s.borderBottomColor]) if (bad.includes(v)) hits.push(`${(el as HTMLElement).className}:${v}`)
      }
      return hits
    })
    assert.deepEqual(tinted, [], '归类区不能出现红绿色')
    // 难度悬停带系数
    assert.equal(await hard.getAttribute('title'), '难度系数 0.45')
  })

  await step('没有知识点与难度的题不出归类信息行（样例第 6 题）', async () => {
    await window.getByRole('button', { name: /加载更多/ }).click()
    await window.waitForFunction((n) => document.querySelectorAll('[data-testid="question-card"]').length === n, TOTAL)
    const noMeta = cards.filter({ hasText: '假如你是李华' })
    await noMeta.waitFor()
    assert.equal(await noMeta.getByTestId('question-meta').count(), 0)
    // 有知识点的样例题只显示 1 个知识点时没有 +N
    const withOne = cards.filter({ hasText: '如图，数轴上点 A' })
    assert.equal((await withOne.getByTestId('meta-knowledge').innerText()).replace(/\s+/g, ''), '知识点用数轴上的点表示有理数')
  })

  // ================= 八、旧筛选记录、几百个标签 =================
  await step('升级前记下的筛选条件（没有归类四项）仍有效；归类四项里有损坏的只丢那一项', async () => {
    await window.evaluate(() => window.sessionStorage.setItem('ewb.library.filter', JSON.stringify({ type: '单选题', paperId: null, keyword: '', batch: null })))
    await window.reload()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await window.getByText('筛出', { exact: false }).waitFor()
    assert.deepEqual(await chips(), ['题型：单选题'])
    await window.evaluate(() => window.sessionStorage.setItem('ewb.library.filter', JSON.stringify({ type: '', paperId: null, keyword: '', batch: null, chapterIds: 'x', knowledgeIds: [1.5, 'a'], difficulties: ['nope', 'easy'], tagIds: null })))
    await window.reload()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await window.getByText('筛出', { exact: false }).waitFor()
    assert.deepEqual(await chips(), ['难度：容易'])
    await clearFilter()
  })

  await step('几百个标签：200 个标签下左栏标签块内部滚动、批量打标签的框能打开并搜索、不卡死', async () => {
    await window.evaluate(async () => {
      for (let i = 0; i < 200; i++) await window.workbench.library.createTag(`标签${String(i).padStart(3, '0')}`)
    })
    await window.getByRole('button', { name: '试卷库', exact: true }).click()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await block('标签').locator('.cf-chip').nth(199).waitFor()
    // 左栏里的标签区不设内部滚动框：200 个标签撑开左栏，由左栏整体滚
    assert.equal(await block('标签').locator('.cf-scroll').count(), 0)
    const railBox = await rail.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    assert.ok(railBox.scroll > railBox.client * 2, `200 个标签把左栏撑得很长，左栏自己滚：${JSON.stringify(railBox)}`)
    await block('标签').getByRole('textbox', { name: '搜索标签' }).waitFor() // 多于 12 个标签带搜索框
    await headBox.click()
    await bar.getByRole('button', { name: '打标签' }).click()
    const picker = window.getByRole('dialog', { name: '给所选题目打标签' })
    const started = Date.now()
    await picker.getByRole('option').first().waitFor({ timeout: 5000 })
    assert.ok(Date.now() - started < 3000, '读 200 个标签的状态应在 3 秒内')
    await picker.getByRole('combobox').fill('标签199')
    assert.equal(await picker.getByRole('option').count(), 1)
    await shots('bulk-tag-picker-200')
    await window.keyboard.press('Escape')
    await bar.getByRole('button', { name: '取消选择' }).click()
    // 清理：删光这些标签
    await window.evaluate(async () => {
      for (const tag of await window.workbench.library.listTags()) await window.workbench.library.deleteTag(tag.id)
    })
  })

  // ================= 九、既有功能不受影响 =================
  // ================= 返工一轮：评审意见逐条 =================
  // 经接口造数据后让界面重读；用完的章节与标签都在步骤结尾删掉，后面的步骤看到的仍是「没有章节、没有标签」
  const dismissToasts = async (): Promise<void> => {
    for (const close of await window.getByRole('button', { name: '关闭提示' }).all()) await close.click().catch(() => undefined)
  }
  const dropAll = async (): Promise<void> => {
    await window.evaluate(async () => {
      const l = window.workbench.library
      for (const c of (await l.listChapters()).filter((c) => c.parentId === null)) await l.deleteChapter(c.id)
      for (const t of await l.listTags()) await l.deleteTag(t.id)
    })
  }
  const createChapterApi = (name: string, parent: number | null = null) => window.evaluate(([n, p]) => window.workbench.library.createChapter(n as string, p as number | null), [name, parent])
  const tagApi = (name: string, ids: number[]) =>
    window.evaluate(async ([n, list]) => {
      const tag = await window.workbench.library.createTag(n as string)
      if ((list as number[]).length) await window.workbench.library.changeQuestionTags({ ids: list as number[] }, { add: [tag.id] })
      return tag
    }, [name, ids])

  await step('「全选全部 N 道」：没有任何筛选条件时不写「筛出的」；筛空后难度与知识点写「当前条件下没有可选的…」而不是「暂无」', async () => {
    await clearFilter()
    await headBox.click()
    await bar.getByText('已选 30 道', { exact: true }).waitFor()
    assert.equal(await bar.getByRole('button', { name: /筛出的/ }).count(), 0)
    await bar.getByRole('button', { name: `全选全部 ${TOTAL} 道` }).click()
    assert.equal((await bar.getByTestId('bulk-count').innerText()).replace(/\s+/g, ''), `已选${TOTAL}道（全部）`)
    await bar.getByRole('button', { name: '取消选择' }).click()
    // 有条件时仍写「筛出的」
    await pickUnitPaper()
    await headBox.click()
    await bar.getByRole('button', { name: `全选筛出的 ${FILLER} 道` }).waitFor()
    await bar.getByRole('button', { name: '取消选择' }).click()
    await clearFilter()
    // 关键词筛空：难度与知识点没有选项，但原因是「被筛空」，不是「库里没有」
    await window.getByPlaceholder('题干中的文字').fill('这个词题干里没有')
    await window.getByText('没有符合条件的题目').waitFor()
    assert.match(await block('难度').innerText(), /当前条件下没有可选的难度/)
    assert.match(await block('知识点').innerText(), /当前条件下没有可选的知识点/)
    assert.ok(!/暂无/.test((await block('难度').innerText()) + (await block('知识点').innerText())), '筛空时不能说「暂无…信息」')
    await window.getByPlaceholder('题干中的文字').fill('')
    await window.getByText(`共 ${TOTAL} 道题`).waitFor()
  })

  await step('题型块默认只列前 8 个大类并带「展开全部（共 16 个）」，选中的大类始终可见', async () => {
    const items = rail.locator('.lb-types > li')
    assert.equal(await items.count(), 1 + 8, '全部题型 + 8 个大类')
    const expand = rail.getByRole('button', { name: '展开全部（共 16 个）' })
    await expand.click()
    assert.equal(await items.count(), 1 + 16)
    await rail.evaluate((el) => el.scrollTo({ top: 0 }))
    await shots('rail-types-expanded')
    const last = items.last().locator('button').first()
    const lastName = (await last.locator('span').innerText()).trim()
    await last.click()
    await window.getByText(withClass(1)).waitFor()
    await rail.getByRole('button', { name: '收起', exact: true }).click()
    assert.equal(await items.count(), 1 + 8 + 1, '收起后选中的大类仍在列表里')
    assert.equal(await rail.locator('.lb-types').getByRole('button', { name: new RegExp(`^${lastName}\\s*\\d+$`) }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await chips(), [`题型：${lastName}`])
    await clearFilter()
    assert.equal(await items.count(), 1 + 8)
  })

  await step('批量归到章节：已在别的章节的先确认并写明几道（按勾选 / 按条件 / 目标是章或节都算对），取消不改，同一章节内不弹确认', async () => {
    const chapter = await createChapterApi('第一章 有理数')
    const s11 = await createChapterApi('1.1 正数和负数', chapter.id)
    const s12 = await createChapterApi('1.2 数轴', chapter.id)
    await remount()
    await pickUnitPaper()
    const chapterIdsOf = async (): Promise<(number | null)[]> => {
      const all = await lib((l) => l.listQuestions({ limit: 1000 }))
      return fillerIds.map((id) => all.items.find((q) => q.id === id)!.chapterId)
    }
    const assignVia = async (target: string): Promise<void> => {
      await bar.getByRole('button', { name: '归到章节' }).click()
      await window.getByRole('dialog', { name: '归到章节', exact: true }).locator('.lb-cp-row', { hasText: target }).first().click()
    }
    // 前 3 道归到 1.2：都还没有章节，直接归入、没有确认框
    for (const i of [1, 2, 3]) await row(i).getByLabel(`选择第 ${i} 题`).click()
    await assignVia('1.2 数轴')
    await toast('已把 3 道题归到「第一章 有理数 › 1.2 数轴」').waitFor()
    assert.equal(await window.getByRole('dialog').count(), 0, '没有已在别的章节的题，不弹确认')
    // 前 5 道（3 道在 1.2、2 道未归）归到「第一章 有理数」：3 道要从节移到章，先确认
    for (const i of [1, 2, 3, 4, 5]) await row(i).getByLabel(`选择第 ${i} 题`).click()
    await assignVia('第一章 有理数')
    const ask = modal('归到章节「第一章 有理数」')
    await ask.waitFor()
    assert.equal((await ask.locator('.ui-confirm-body').innerText()).trim(), '所选 5 道题里，其中 3 道已在别的章节，将移到「第一章 有理数」；其余 2 道直接归入。未选中的题不受影响。')
    await shots('assign-confirm')
    await ask.getByRole('button', { name: '取消', exact: true }).click()
    assert.deepEqual((await chapterIdsOf()).slice(0, 5), [s12.id, s12.id, s12.id, null, null], '取消后一道都没动')
    await bar.getByText('已选 5 道', { exact: true }).waitFor()
    await assignVia('第一章 有理数')
    await ask.getByRole('button', { name: '移动', exact: true }).click()
    await toast('已把 5 道题归到「第一章 有理数」').waitFor()
    assert.deepEqual((await chapterIdsOf()).slice(0, 5), Array(5).fill(chapter.id))
    // 已经都在这一章里：不弹确认
    for (const i of [1, 2]) await row(i).getByLabel(`选择第 ${i} 题`).click()
    await assignVia('第一章 有理数')
    await toast('已把 2 道题归到「第一章 有理数」').waitFor()
    assert.equal(await window.getByRole('dialog').count(), 0)
    // 全选筛出的 40 道（按条件）归到 1.1：前 5 道在章里要移动，其余 35 道未归
    await headBox.click()
    await bar.getByRole('button', { name: `全选筛出的 ${FILLER} 道` }).click()
    await assignVia('1.1 正数和负数')
    const ask2 = modal('归到章节「第一章 有理数 › 1.1 正数和负数」')
    assert.equal((await ask2.locator('.ui-confirm-body').innerText()).trim(), `所选 ${FILLER} 道题里，其中 5 道已在别的章节，将移到「第一章 有理数 › 1.1 正数和负数」；其余 ${FILLER - 5} 道直接归入。未选中的题不受影响。`)
    await ask2.getByRole('button', { name: '移动', exact: true }).click()
    await toast(`已把 ${FILLER} 道题归到「第一章 有理数 › 1.1 正数和负数」`).waitFor()
    assert.deepEqual(await chapterIdsOf(), Array(FILLER).fill(s11.id))
    await dropAll()
    await clearFilter()
  })

  await step('题目行：1000×640 下章节与难度同一行，章节路径过长末尾省略并带全称；标签最多 3 个加「+N」；左栏没有嵌套的内部滚动框', async () => {
    const long30 = '第四章 一元一次方程在行程问题工程问题销售问题中的应用综合训练专题'.slice(0, 30)
    const longSection = Array.from('4.1 行程问题与工程问题与销售问题中的一元一次方程应用举例').slice(0, 30).join('')
    const chapter = await createChapterApi(long30)
    const section = await createChapterApi(longSection, chapter.id)
    await window.evaluate(([id, ids]) => window.workbench.library.assignChapter({ ids: ids as number[] }, id as number), [section.id, [fillerIds[3]]])
    const five = ['易错', '压轴', '期中复习', '培优', '月考']
    for (const name of five) await tagApi(name, [fillerIds[4]])
    // 再造一批章节让左栏的章节树很长
    for (let i = 1; i <= 8; i++) {
      const c = await createChapterApi(`第${i}单元 综合`)
      for (let j = 1; j <= 3; j++) await createChapterApi(`${i}.${j} 小节`, c.id)
    }
    await remount()
    await resize(1000, 640)
    const r4 = row(4)
    const chapterMeta = r4.getByTestId('meta-chapter')
    const difficultyMeta = r4.getByTestId('meta-difficulty')
    const [a, b] = await Promise.all([chapterMeta.boundingBox(), difficultyMeta.boundingBox()])
    assert.ok(a && b && Math.abs(a.y - b.y) < 4, `章节与难度同一行：${JSON.stringify([a?.y, b?.y])}`)
    const text = chapterMeta.locator('.lb-meta-text')
    const over = await text.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: getComputedStyle(el).textOverflow, ws: getComputedStyle(el).whiteSpace }))
    assert.ok(over.scroll > over.client && over.overflow === 'ellipsis' && over.ws === 'nowrap', `章节路径过长：末尾省略号、不折行：${JSON.stringify(over)}`)
    assert.equal(await chapterMeta.getAttribute('title'), `${long30} › ${longSection}`, 'title 给全称')
    assert.equal((await difficultyMeta.innerText()).replace(/\s+/g, ''), '难度困难', '难度完整显示，不被挤掉')
    // 标签：最多 3 个，其余折成 +N，悬停列全部
    const r5 = row(5)
    assert.equal(await r5.getByTestId('meta-tag').count(), 3)
    const more = r5.getByTestId('meta-tags-more')
    assert.equal((await more.innerText()).trim(), '+2')
    const all = ((await more.getAttribute('title')) ?? '').split('、').sort()
    assert.deepEqual(all, [...five].sort())
    await shots('row-meta-long')
    // 左栏：章节树、标签区没有内部滚动框；展开后的章节树与整个左栏一起滚
    const nested = await rail.evaluate((el) => {
      const hits: string[] = []
      for (const node of el.querySelectorAll<HTMLElement>('*')) {
        const s = getComputedStyle(node)
        if (/auto|scroll/.test(s.overflowY) && node.scrollHeight > node.clientHeight + 1) hits.push(node.className)
      }
      return hits
    })
    assert.deepEqual(nested, [], '左栏里不能再有会滚动的内部框')
    assert.equal(await rail.locator('.cf-scroll--tree').count(), 0)
    for (const name of ['第1单元 综合', '第2单元 综合', '第3单元 综合']) await block('章节').getByRole('button', { name: `展开${name}` }).click()
    const tree = block('章节').locator('ul.cf-list').first()
    const dims = await tree.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, parentOverflow: getComputedStyle(el.parentElement!).overflowY }))
    assert.ok(dims.client === dims.scroll && !/auto|scroll/.test(dims.parentOverflow) && dims.client > 330, `章节树完整展开、不设框：${JSON.stringify(dims)}`)
    await shots('rail-chapter-tree')
    await resize(1440, 900)
    await dropAll()
  })

  await step('标签块：有题的在前（题多的在前）、0 题的在后；多于 12 个带搜索框，选中的不受搜索影响', async () => {
    // 14 个标签：第 n 个用在 n%5 道题上 → 题数 1,2,3,4,0,1,2,3,4,0,1,2,3,4
    for (let n = 1; n <= 14; n++) await tagApi(`排序${String(n).padStart(2, '0')}`, fillerIds.slice(10, 10 + (n % 5)))
    await remount()
    const chipsOf = async (): Promise<[string, number][]> =>
      (await block('标签').locator('.cf-chip').allInnerTexts()).map((t) => {
        const [name, n] = t.trim().split(/\s*\n\s*/)
        return [name, Number(n)]
      })
    const list = await chipsOf()
    assert.equal(list.length, 14)
    const counts = list.map(([, n]) => n)
    assert.deepEqual(counts, [...counts].sort((x, y) => y - x), '题多的在前')
    assert.deepEqual(counts.slice(-2), [0, 0], '0 题的排在最后')
    assert.deepEqual(list.slice(0, 4).map(([name]) => name), ['排序04', '排序09', '排序14', '排序03'], '同题数按名称顺序')
    await block('标签').scrollIntoViewIfNeeded()
    await shots('rail-tags-sorted')
    const search = block('标签').getByRole('textbox', { name: '搜索标签' })
    await search.fill('排序07')
    assert.deepEqual((await chipsOf()).map(([name]) => name), ['排序07'])
    // 选中一个：搜索别的时它仍在
    await block('标签').locator('.cf-chip').first().click()
    await window.getByText(withClass(2)).waitFor()
    await search.fill('排序12')
    assert.deepEqual((await chipsOf()).map(([name]) => name).sort(), ['排序07', '排序12'])
    await search.fill('没有这个')
    assert.match(await block('标签').innerText(), /没有匹配的标签/)
    assert.equal(await block('标签').locator('.cf-chip.is-on').count(), 1, '选中的标签搜索不到时仍保留')
    await clearFilter()
    // 标签不多于 12 个时没有搜索框
    await window.evaluate(async () => {
      const l = window.workbench.library
      for (const t of (await l.listTags()).slice(0, 5)) await l.deleteTag(t.id)
    })
    await remount()
    assert.equal(await block('标签').getByRole('textbox', { name: '搜索标签' }).count(), 0)
    await dropAll()
  })

  await step('知识点名称在左栏最多两行换行，不用省略号截掉后缀', async () => {
    await block('知识点').getByRole('textbox', { name: '搜索知识点' }).fill('含有多个符号')
    const item = block('知识点').locator('.cf-item').filter({ hasText: '含有多个符号' })
    await item.waitFor()
    const info = await item.evaluate((el) => {
      const span = el.querySelector('span')!
      return { h: el.getBoundingClientRect().height, text: span.textContent, fits: span.scrollHeight <= span.clientHeight + 1, overflow: getComputedStyle(span).textOverflow }
    })
    assert.equal(info.text, LONG_KNOWLEDGE.name)
    assert.ok(info.h > 36 && info.h < 70, `两行高：${info.h}`)
    assert.ok(info.fits && info.overflow !== 'ellipsis', '24 个字两行放得下，不被截掉')
    await item.scrollIntoViewIfNeeded()
    await shots('rail-knowledge-wrap')
    await block('知识点').getByRole('textbox', { name: '搜索知识点' }).fill('')
  })

  await step('批量标签框：行上数字是所选的题里有几道（不是全库数）；半选是空心横杠、与全选一眼分得开；关闭时汇总一条提示，来回勾回原样不提示', async () => {
    const z = await tagApi('Z部分', [fillerIds[0]]) // 所选 3 道里只有 1 道
    const y = await tagApi('Y全有', fillerIds.slice(0, 3))
    await tagApi('W别处', fillerIds.slice(10, 12)) // 全库 2 道，所选里 0 道
    await tagApi('V单题', [fillerIds[4]])
    await remount()
    for (const i of [1, 2, 3]) await row(i).getByLabel(`选择第 ${i} 题`).click()
    await bar.getByRole('button', { name: '打标签' }).click()
    const picker = window.getByRole('dialog', { name: '给所选题目打标签' })
    const rowOf = (name: string): Locator => picker.getByRole('option', { name: new RegExp(`^${name}\\s`) })
    await rowOf('Z部分').waitFor()
    const countOf = async (name: string): Promise<string> => (await rowOf(name).locator('em').innerText()).trim()
    assert.deepEqual([await countOf('Z部分'), await countOf('Y全有'), await countOf('W别处')], ['1', '3', '0'])
    // 半选：空心（白底）+ 蓝黑横杠；全选：实心蓝黑
    const box = async (name: string) => rowOf(name).locator('input').evaluate((el: HTMLInputElement) => ({ bg: getComputedStyle(el).backgroundColor, indeterminate: el.indeterminate, checked: el.checked }))
    const mixed = await box('Z部分')
    const full = await box('Y全有')
    assert.deepEqual([mixed.indeterminate, full.checked], [true, true])
    assert.equal(mixed.bg, 'rgb(255, 255, 255)', '半选是空心')
    assert.equal(full.bg, 'rgb(31, 58, 104)', '全选是实心蓝黑')
    await shots('bulk-mixed-hollow')
    // 一次打开里：Z 部分→全部（打上）、Y 全有→没有（去掉）、W 勾上又取消（回到原样）
    await dismissToasts()
    await rowOf('Z部分').click()
    await rowOf('Y全有').click()
    await rowOf('W别处').click()
    await picker.locator('[role=option][aria-checked="true"]').filter({ hasText: /^W别处/ }).waitFor()
    await rowOf('W别处').click()
    assert.equal(await window.getByTestId('toast').filter({ hasText: '已给' }).count(), 0, '选择框开着时不弹提示')
    assert.equal(await countOf('Z部分'), '3', '勾选后行上数字跟着变成所选的 3 道')
    await window.keyboard.press('Escape')
    await toast('已给 3 道题打上「Z部分」，去掉「Y全有」').waitFor()
    assert.equal(await window.getByTestId('toast').filter({ hasText: 'W别处' }).count(), 0, '勾上又取消的不进汇总')
    // 只勾上又取消：没有任何改动，不弹提示
    await dismissToasts()
    await bar.getByRole('button', { name: '打标签' }).click()
    await rowOf('W别处').click()
    await rowOf('W别处').click()
    await window.keyboard.press('Escape')
    await window.waitForTimeout(600)
    assert.equal(await window.getByTestId('toast').count(), 0, '勾回原样：没有提示')
    await bar.getByRole('button', { name: '取消选择' }).click()
    // 单题：同一次打开里打上 W、去掉 V，关闭时汇总一条
    await row(5).getByRole('button', { name: '给第 5 题打标签' }).click()
    const single = window.getByRole('dialog', { name: '打标签', exact: true })
    await single.getByRole('option', { name: /^V单题/ }).click()
    await single.getByRole('option', { name: /^W别处/ }).click()
    assert.equal(await window.getByTestId('toast').count(), 0, '单题选择框开着时也不弹提示')
    await window.keyboard.press('Escape')
    await toast('已给这道题打上「W别处」，去掉「V单题」').waitFor()
    const after = await lib((l) => l.listQuestions({ limit: 1000 }))
    assert.deepEqual(after.items.find((q) => q.id === fillerIds[4])!.tags.map((t) => t.name), ['W别处'])
    assert.equal(after.items.filter((q) => q.tags.some((t) => t.id === z.id)).length, 3)
    assert.equal(after.items.filter((q) => q.tags.some((t) => t.id === y.id)).length, 0)
  })

  await step('管理标签：并入前确认写明「X 随后删除」；超长提示是红色并标红输入框；确认框标题＝动作＋对象、正文以句号结尾', async () => {
    await block('标签').getByRole('button', { name: '管理标签' }).click()
    const dlg = modal('管理标签')
    await dlg.getByRole('button', { name: '改名：W别处' }).click()
    const input = dlg.getByLabel('标签「W别处」的新名称')
    await input.fill('V单题')
    await input.press('Enter')
    const merge = modal('并入标签「V单题」')
    assert.equal((await merge.locator('.ui-confirm-body').innerText()).trim(), '「W别处」将并入「V单题」，原来带「W别处」的 3 道题都会带上「V单题」，「W别处」随后删除。')
    await merge.getByRole('button', { name: '取消', exact: true }).click()
    // 超长：红色提示 + 红框，保存不可用
    await input.fill('一二三四五六七八九十一二三四五六七八九十一')
    const warn = dlg.getByRole('alert')
    assert.match(await warn.innerText(), /标签名最多 20 字/)
    assert.equal(await warn.evaluate((el) => getComputedStyle(el).color), 'rgb(195, 50, 43)')
    assert.equal(await input.getAttribute('aria-invalid'), 'true')
    assert.equal(await dlg.getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
    await input.press('Escape')
    await dlg.getByRole('button', { name: '删除：Z部分' }).click()
    const del = modal('删除标签「Z部分」')
    assert.equal((await del.locator('.ui-confirm-body').innerText()).trim(), '3 道题会去掉这个标签，题目本身不受影响。')
    await del.getByRole('button', { name: '取消', exact: true }).click()
    await closeModal('管理标签')
  })

  await step('管理章节：行内操作与管理标签一致用「图标＋文字」，「新建节」是常规字重', async () => {
    await createChapterApi('第一章 有理数')
    await remount()
    await block('章节').getByRole('button', { name: '管理章节' }).click()
    const dlg = modal('管理章节')
    for (const [label, text] of [['上移：第一章 有理数', '上移'], ['下移：第一章 有理数', '下移'], ['改名：第一章 有理数', '改名'], ['删除：第一章 有理数', '删除'], ['在「第一章 有理数」下新建节', '新建节']] as const) {
      const button = dlg.getByRole('button', { name: label })
      assert.equal((await button.innerText()).trim(), text, `${label} 显示文字「${text}」`)
      assert.equal(await button.locator('svg').count(), 1, `${label} 有图标`)
    }
    const weights = await dlg.evaluate((el) => ({ add: getComputedStyle(el.querySelector('[data-cm^="add-"]')!).fontWeight, name: getComputedStyle(el.querySelector('.lb-cm-name')!).fontWeight }))
    assert.equal(weights.add, '400', '新建节常规字重')
    assert.equal(weights.name, '700', '章名粗体')
    await shots('chapter-manager-actions')
    await closeModal('管理章节')
    await dropAll()
  })

  await step('筛选条件里残留的编号：来源卷、章节、标签对象都不存在时自动去掉，chip 与无结果说明任何时候都不显示内部编号', async () => {
    await window.evaluate(() => window.sessionStorage.setItem('ewb.library.filter', JSON.stringify({ type: '', paperId: 99999, keyword: '', batch: null, chapterIds: [99998], knowledgeIds: [88888], difficulties: [], tagIds: [99997] })))
    await window.reload()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await window.getByText('筛出', { exact: false }).or(window.getByText('共', { exact: false })).first().waitFor()
    await window.waitForTimeout(500)
    const pageText = await window.locator('.lb-page').innerText()
    for (const id of ['99999', '99998', '99997', '88888']) assert.ok(!pageText.includes(id), `页面上不能出现内部编号 ${id}`)
    assert.deepEqual((await chips()).filter((c) => /\d{4,}/.test(c)), [])
    const stored = await window.evaluate(() => JSON.parse(window.sessionStorage.getItem('ewb.library.filter') ?? '{}'))
    assert.equal(stored.paperId, null, '不存在的来源卷条件被去掉')
    assert.deepEqual([stored.chapterIds, stored.tagIds], [[], []], '不存在的章节与标签条件被去掉')
    await clearFilter()
  })

  await step('既有功能：加入试卷菜单、已用于 N 份试卷、展开答案、删除二次确认、关键词高亮仍可用', async () => {
    await window.reload()
    await window.getByRole('button', { name: '试题库', exact: true }).click()
    await cards.first().waitFor()
    await clearFilter()
    assert.ok(await row(1).getByRole('button', { name: '加入试卷' }).isVisible())
    await window.getByPlaceholder('题干中的文字').fill('数轴')
    await window.getByText(withClass(1)).waitFor()
    assert.equal(await window.locator('.lb-stem mark').count(), 1, '关键词命中处仍高亮')
    // 这一道（样例第 2 题）带答案：展开 / 收起答案，删除要二次确认
    const card = cards.first()
    await card.getByRole('button', { name: '查看答案', exact: true }).click()
    await card.getByTestId('question-answer').waitFor()
    await card.getByRole('button', { name: '收起答案', exact: true }).click()
    await card.getByRole('button', { name: '删除', exact: true }).click()
    await card.getByRole('button', { name: '确认删除', exact: true }).waitFor()
    await card.getByRole('button', { name: '取消', exact: true }).click()
    await card.getByRole('button', { name: '删除', exact: true }).waitFor()
    await window.getByPlaceholder('题干中的文字').fill('')
    await window.getByText(`共 ${TOTAL} 道题`).waitFor()
    assert.equal((await lib((l) => l.listQuestions({ limit: 1 }))).total, TOTAL)
  })

  await step('来源卷下的题被删光后，选着这份来源卷的筛选条件自动去掉，列表回到全部，chip 不留编号', async () => {
    await clearFilter()
    await rail.locator('select').selectOption({ label: '样例中学2026-2027学年七年级上学期阶段检测英语试题（2 题）' })
    await window.getByText(`筛出 2 道，全库 ${TOTAL} 道`).waitFor()
    assert.equal((await chips()).length, 1)
    for (let left = 2; left >= 1; left--) {
      await cards.first().getByRole('button', { name: '删除', exact: true }).click()
      await cards.first().getByRole('button', { name: '确认删除', exact: true }).click()
      if (left === 2) await window.getByText(`筛出 1 道，全库 ${TOTAL - 1} 道`).waitFor()
    }
    await window.getByText(`共 ${TOTAL - 2} 道题`).waitFor()
    assert.deepEqual(await chips(), [], '来源卷没了，条件跟着去掉')
    assert.equal(await rail.locator('select').inputValue(), '0', '来源卷下拉回到「全部来源卷」')
    assert.ok(!(await window.locator('.lb-head').innerText()).match(/来源卷：\d+/), '没有「来源卷：编号」')
  })

  assert.deepEqual(problems, [], `页面不应有未捕获的错误：\n${problems.join('\n')}`)
  console.log(`试题库归类端到端测试通过：${passed} 项，证据在 ${evidence}`)
} catch (error) {
  await window.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
  if (problems.length) console.error('页面错误：\n' + problems.join('\n'))
  throw error
} finally {
  await app.close()
}

