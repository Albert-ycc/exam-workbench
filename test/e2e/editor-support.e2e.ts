// editor-*.e2e.ts 共用的测试素材与操作（本文件自己不是测试，只导出函数）
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import type { DraftSection, PaperDraft, PaperItem } from '../../src/shared/domain.ts'

export type WB = Window['workbench']
export const call = <T>(page: Page, fn: (wb: WB) => Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.workbench)`) as Promise<T>

export function makeTempDirs(tag: string): { dataDir: string; userDataDir: string; evidence: string } {
  return {
    dataDir: mkdtempSync(join(tmpdir(), `ewb-${tag}-data-`)),
    userDataDir: mkdtempSync(join(tmpdir(), `ewb-${tag}-user-`)),
    evidence: mkdtempSync(join(tmpdir(), `ewb-${tag}-shots-`))
  }
}

export function makeItem(id: string, text: string, extra: Partial<PaperItem> = {}): PaperItem {
  return { id, originQuestionId: null, sourceLabel: '测试来源', questionType: '单选题', numberCount: 1, stemHtml: `<p>${text}</p>`, answerHtml: null, ...extra }
}

// 15 个空的完形填空题干：每个空一个小题号占位符
export const CLOZE_15 = `<p>阅读下面的短文，从方框中选出最佳答案。${Array.from({ length: 15 }, (_, k) => `<span data-ewb-qno="${k}"></span>____`).join(' ')}</p>`

// 四个大题：选择 4 题（每题 4 分）、完形填空 15 空（每空 1 分）、解答 3 题（8 分，第 3 题单独 10 分）、判断 2 题（未设分）
export function structureDraft(): PaperDraft {
  const sections: DraftSection[] = [
    {
      id: 's1',
      title: '选择题',
      defaultScore: 4,
      items: [
        makeItem('a1', '甲题一', { answerHtml: '<p>【答案】A</p>' }),
        makeItem('a2', '甲题二'),
        makeItem('a3', '甲题三'),
        makeItem('a4', '甲题四', { answerHtml: '<p>【答案】D</p>' })
      ]
    },
    { id: 's2', title: '完形填空', defaultScore: 1, items: [makeItem('b1', '完形', { questionType: '完形填空-15空', numberCount: 15, stemHtml: CLOZE_15 })] },
    {
      id: 's3',
      title: '解答题',
      defaultScore: 8,
      items: [makeItem('c1', '丙题一', { questionType: '解答题' }), makeItem('c2', '丙题二', { questionType: '解答题' }), makeItem('c3', '丙题三', { questionType: '解答题', score: 10 })]
    },
    { id: 's4', title: '判断题', items: [makeItem('d1', '丁题一', { questionType: '判断题' }), makeItem('d2', '丁题二', { questionType: '判断题' })] }
  ]
  return { sections }
}

export async function seedPaper(page: Page, title: string, draft: PaperDraft): Promise<number> {
  const id = (await page.evaluate((t) => window.workbench.papers.create(t), title)) as number
  await page.evaluate(([i, d]) => window.workbench.papers.saveDraft(i as number, d as never), [id, draft] as const)
  return id
}

// 用应用自己的跳转事件打开试卷（等价于在试卷库里点「打开」）
export async function openEditor(page: Page, paperId: number): Promise<void> {
  const title = (await page.evaluate((id) => window.workbench.papers.get(id), paperId)).title
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('ewb-navigate', { detail: { page: 'papers', paperId: id } })), paperId)
  // 已经在编辑别的试卷时，旧编辑器的标题框还在：等标题换成这份的，才说明新编辑器读完了试卷
  await page.waitForFunction((t) => (document.querySelector('input[aria-label="试卷标题"]') as HTMLInputElement | null)?.value === t, title)
  await page.getByTestId('save-state').waitFor()
}

export const itemOf = (page: Page, id: string): Locator => page.locator(`[data-testid="paper-item"][data-item-id="${id}"]`)
export const sectionAt = (page: Page, index: number): Locator => page.getByTestId('section').nth(index)
export const itemNos = (page: Page): Promise<string[]> => page.getByTestId('item-no').allInnerTexts()
export const sectionNames = (page: Page): Promise<string[]> => page.getByTestId('section-name').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))

export async function saved(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved', null, { timeout: 8000 })
}

// dnd-kit 的传感器需要分步移动的真实鼠标轨迹
export async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, whileHovering?: () => Promise<void>): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 24 })
  await whileHovering?.()
  await page.mouse.up()
}

export async function center(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded()
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// 元素是否整个落在卷面滚动区的可见范围内
export async function inDeskView(page: Page, locator: Locator): Promise<boolean> {
  const desk = (await page.locator('.ed-desk').boundingBox())!
  const box = await locator.boundingBox()
  if (!box) return false
  return box.y >= desk.y - 1 && box.y + Math.min(box.height, 40) <= desk.y + desk.height + 1
}

export async function addCustomSection(page: Page): Promise<void> {
  await page.getByTestId('add-section').click()
  await page.getByRole('menuitem', { name: '自定义名称…' }).click()
}

export function watchErrors(page: Page, sink: string[]): void {
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && sink.push(`console: ${m.text()}`))
}
