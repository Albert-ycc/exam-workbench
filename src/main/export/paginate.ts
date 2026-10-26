/// <reference lib="dom" />
// 试卷 PDF 按页摊开作答空白：照手排试卷（教学材料/七年级上/试卷/第一单元测试源文件/print_pdf.py）的排法。
// 整段（一道题，连同它前面的大题标题、试卷抬头）不跨页；每页剩下的高度按各题作答空白的比例摊进去，
// 单题最多再加 1.6 倍的空白，页底不留白。planPages 是纯函数（单测在 scripts/test-export.ts），
// fillScript 把它序列化进生成 PDF 的隐藏窗口里：量各段高度、应用计划（改空白高度、在页首的段上加 break-before），然后才 printToPDF。
// Word 不走这一套：Word 自己重排，留白按固定高度（docx.ts）。

// 试卷 PDF 的页面几何（毫米）：printToPDF 的页边距、页内容宽高、隐藏窗口里的排版宽度都从这里取
export const PAPER_PAGE = { widthMm: 210, heightMm: 297, marginTopMm: 20, marginBottomMm: 20, marginXMm: 18 } as const
export const CONTENT_WIDTH_MM = PAPER_PAGE.widthMm - 2 * PAPER_PAGE.marginXMm
export const CONTENT_HEIGHT_MM = PAPER_PAGE.heightMm - PAPER_PAGE.marginTopMm - PAPER_PAGE.marginBottomMm

export const FILL = {
  safetyMm: 2, // 每页少用这么多，量出来的高度与打印排版的细微差别不至于把最后一段挤到下一页
  maxExtraRatio: 1.6, // 单题的空白最多再加基础空白的 1.6 倍（连同基础空白最多 2.6 倍）
  rounds: 6 // 摊余量的轮数：先到上限的题退出，余下的再摊给其他题
} as const

export interface FillUnit {
  height: number // 这一段的高度（已含基础空白），与 cap 同单位
  sp: number // 基础作答空白；0 表示这段不参与摊余量
}

export interface FillPage {
  start: number // 这一页从第几段起（含）
  end: number // 到第几段止（不含）
  used: number // 各段高度之和（不含摊进去的余量）
  spare: number // 摊完后仍剩的高度
  oversized: boolean // 这一段比一页还高，独占一页并让 Chromium 自行拆页
}

export interface FillPlan {
  pages: FillPage[]
  extra: number[] // 每段摊到的额外空白
  breakBefore: number[] // 要在这些段之前强制分页
}

// 纯函数，不引用任何外部变量：会以 toString() 注入页面，里面不能用 import 的东西
export function planPages(units: FillUnit[], cap: number, maxExtraRatio: number, rounds: number): FillPlan {
  const extra = units.map(() => 0)
  const pages: FillPage[] = []
  const breakBefore: number[] = []
  let start = 0
  let used = 0
  const close = (end: number): void => {
    if (end <= start) return
    let left = cap - used
    let pool: number[] = []
    for (let i = start; i < end; i++) if (units[i].sp > 0) pool.push(i)
    for (let k = 0; k < rounds && left > 0.5 && pool.length > 0; k++) {
      const total = pool.reduce((sum, i) => sum + units[i].sp, 0)
      const next: number[] = []
      let given = 0
      for (const i of pool) {
        const room = units[i].sp * maxExtraRatio - extra[i]
        const add = Math.min(room, (left * units[i].sp) / total)
        extra[i] += add
        given += add
        if (room - add > 0.5) next.push(i)
      }
      left -= given
      pool = next
    }
    pages.push({ start, end, used, spare: left, oversized: false })
  }
  for (let i = 0; i < units.length; i++) {
    const height = units[i].height
    if (height > cap) {
      // 比一页还高的段（长阅读材料）：前面的页先收口，它自己从新一页开始由 Chromium 拆页，下一段也另起一页，后面的页才算得准
      close(i)
      if (i > 0) breakBefore.push(i)
      pages.push({ start: i, end: i + 1, used: height, spare: 0, oversized: true })
      start = i + 1
      used = 0
      if (i + 1 < units.length) breakBefore.push(i + 1)
      continue
    }
    if (i > start && used + height > cap) {
      close(i)
      breakBefore.push(i)
      start = i
      used = 0
    }
    used += height
  }
  close(units.length)
  return { pages, extra, breakBefore }
}

export interface FillReport {
  pages: number
  spareMm: number[] // 每页摊完后仍剩的高度（毫米）
  oversized: number // 比一页还高、交给 Chromium 拆页的段数
}

// 在隐藏窗口里跑：找出各段、量高度、应用计划。页面里没有作答空白（没勾「留作答区域」）时什么都不做，返回 null
function fillInPage(plan: typeof planPages, p: { capMm: number; ratio: number; rounds: number }): FillReport | null {
  const MM = 96 / 25.4
  if (!document.querySelector('.answer-space[data-sp]')) return null
  // 一段 = 一道题（.item）连同它前面还没归属的东西：试卷抬头、大题标题
  const units: { first: HTMLElement; item: HTMLElement; spacer: HTMLElement | null }[] = []
  let carry = Array.from(document.body.children).filter((e) => e.tagName !== 'SECTION') as HTMLElement[]
  for (const section of Array.from(document.querySelectorAll('section.section'))) {
    for (const child of Array.from(section.children) as HTMLElement[]) {
      if (child.classList.contains('item')) {
        units.push({ first: carry[0] ?? child, item: child, spacer: child.querySelector(':scope > .answer-space[data-sp]') })
        carry = []
      } else carry.push(child)
    }
  }
  if (units.length === 0) return null
  const top = (el: HTMLElement): number => el.getBoundingClientRect().top + window.scrollY
  const tops = units.map((u) => top(u.first))
  const last = units[units.length - 1].item
  const end = last.getBoundingClientRect().bottom + window.scrollY + parseFloat(getComputedStyle(last).marginBottom)
  const base = units.map((u) => (u.spacer ? Number(u.spacer.dataset.sp) * MM : 0))
  const result = plan(
    units.map((_u, i) => ({ height: (i + 1 < units.length ? tops[i + 1] : end) - tops[i], sp: base[i] })),
    p.capMm * MM,
    p.ratio,
    p.rounds
  )
  units.forEach((u, i) => {
    u.item.style.breakInside = 'avoid'
    if (u.spacer && result.extra[i] > 0) u.spacer.style.height = `${((base[i] + result.extra[i]) / MM).toFixed(2)}mm`
  })
  for (const i of result.breakBefore) units[i].first.style.breakBefore = 'page'
  return { pages: result.pages.length, spareMm: result.pages.map((pg) => Math.round(pg.spare / MM)), oversized: result.pages.filter((pg) => pg.oversized).length }
}

export function fillScript(): string {
  const params = { capMm: CONTENT_HEIGHT_MM - FILL.safetyMm, ratio: FILL.maxExtraRatio, rounds: FILL.rounds }
  return `(${fillInPage.toString()})(${planPages.toString()}, ${JSON.stringify(params)})`
}
