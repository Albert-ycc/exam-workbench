/// <reference lib="dom" />
// 组卷网页面拆题脚本。extractInPage 在内置浏览器的页面里执行（通过 .toString() 注入），
// 因此函数必须自包含：不能引用本文件以外的任何标识符，也不能修改页面 DOM（只读克隆出来的节点）。
// 规则集中在这一个函数里：组卷网改版时只改这里，入库预览里的「拆出题数」会暴露失效。

export interface ExtractedQuestion {
  qid: string | null // 组卷网题目编号
  questionType: string // 题型标签，如「单选题」「解答题-计算题」
  sourceLabel: string // 题目来源标签
  sectionTitle: string // 所在大题标题，如「一、单选题」（单题页为空）
  order: number // 在页面中的顺序，从 0 开始
  numberCount: number
  stemHtml: string // 已清洗；图片地址为 ewb-pending:<下标>，下标对应 ExtractedPage.images
  stemText: string
  answerHtml: string | null
  start: number | null // 页面上这道题的起始题号（对账用，不入库）
}

export interface ExtractedPage {
  kind: 'paper' | 'question' | 'none'
  url: string // 页面当前地址
  title: string // 试卷标题；单题页为空
  origin: { url: string; title: string } | null // 单题页的原始出处卷
  declaredCount: number | null // 页面自己标明的题数（「试卷题型（共 23题）」），用来核对拆出的题数
  verification: boolean // 像是验证页
  questionCount: number
  images: string[] // 页面里出现的图片绝对地址
  questions: ExtractedQuestion[]
  diagnostics: string[]
}

export function extractInPage(options?: { probeOnly?: boolean }): ExtractedPage {
  const probeOnly = Boolean(options && options.probeOnly)
  const doc = document
  const diagnostics: string[] = []
  const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const textOf = (el: Element | null | undefined): string => (el ? collapse(el.textContent || '') : '')

  // ---------- 页面类型 ----------
  const detailRoot = doc.querySelector('.test-detail-page .quest-content .quesroot')
  function paperItems(): Element[] {
    const scope = doc.querySelector('.exam-cnt') || doc
    return Array.from(scope.querySelectorAll('.tk-quest-item')).filter(
      (el) => !el.closest('.rec-tests') && !(el.parentElement && el.parentElement.closest('.tk-quest-item'))
    )
  }
  const items = detailRoot ? [] : paperItems()
  const kind: 'paper' | 'question' | 'none' = detailRoot ? 'question' : items.length > 0 ? 'paper' : 'none'

  function looksLikeVerification(): boolean {
    if (kind !== 'none') return false
    const visible = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return false
      const style = getComputedStyle(el)
      return style.visibility !== 'hidden' && style.display !== 'none'
    }
    const selectors = [
      '#tcaptcha_iframe', '#tcaptcha_transform_dy', 'iframe[src*="captcha" i]', '[class*="captcha" i]', '[id*="captcha" i]',
      '.geetest_panel', '.geetest_holder', '#nc_1_wrapper', '.nc-container', '.verify-wrap', '.slider-verify'
    ]
    for (const selector of selectors) {
      const found = doc.querySelectorAll(selector)
      for (let i = 0; i < found.length; i++) if (visible(found[i])) return true
    }
    const body = doc.body
    const sample = (doc.title + ' ' + (body ? body.innerText.slice(0, 3000) : '')).slice(0, 3200)
    return /安全验证|人机验证|滑动验证|拖动.{0,8}滑块|访问.{0,6}频繁|请完成.{0,6}验证|验证.{0,4}(通过|后).{0,6}(继续|访问)|captcha/i.test(sample)
  }

  const empty = (): ExtractedPage => ({
    kind, url: location.href, title: '', origin: null, declaredCount: null, verification: looksLikeVerification(),
    questionCount: kind === 'question' ? 1 : items.length, images: [], questions: [], diagnostics
  })
  if (probeOnly || kind === 'none') return empty()

  // ---------- 输出文档与图片登记 ----------
  const outDoc = doc.implementation.createHTMLDocument('')
  const images: string[] = []
  const imageIndex = new Map<string, number>()
  function registerImage(raw: string): number | null {
    let abs: string
    try {
      abs = raw.startsWith('data:') ? raw : new URL(raw, doc.baseURI).href
    } catch {
      return null
    }
    const found = imageIndex.get(abs)
    if (found !== undefined) return found
    images.push(abs)
    imageIndex.set(abs, images.length - 1)
    return images.length - 1
  }

  // 占位符与选项表的号码格只认本脚本自己生成的节点（按节点身份，不看属性）：
  // 页面自带的 data-ewb-* 属性（题干、答案、任何位置）一律当普通元素处理
  const ownPlaceholders = new WeakSet<Element>()
  const ownLabelCells = new WeakSet<Element>()

  // ---------- 清洗：只留白名单标签与属性 ----------
  const DROP = new Set([
    'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'link', 'meta', 'button', 'input', 'select', 'textarea', 'form',
    'svg', 'canvas', 'audio', 'video', 'source', 'template', 'head', 'title', 'hr', 'colgroup', 'col', 'caption'
  ])
  const KEEP_INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'sub', 'sup'])
  const KEEP_BLOCK = new Set(['p', 'div', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th'])
  const ROLES = new Set(['options', 'option-label', 'bordered', 'dot', 'right-aligned', 'writing-lines'])
  const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE'])

  function setRole(el: Element, role: string): void {
    if (ROLES.has(role)) el.setAttribute('data-role', role)
  }
  function hasVisibleBorder(style: string): boolean {
    if (!/border(-style)?\s*:[^;]*\b(solid|double|dashed|dotted)\b/i.test(style)) return false
    const width = /border-width\s*:\s*([^;]+)/i.exec(style)
    return !width || /[1-9]/.test(width[1])
  }
  function tableIsBordered(table: Element): boolean {
    if (/^[1-9]/.test(table.getAttribute('border') || '')) return true
    if (hasVisibleBorder(table.getAttribute('style') || '')) return true
    const cells = table.querySelectorAll('td, th')
    for (let i = 0; i < cells.length && i < 8; i++) if (hasVisibleBorder(cells[i].getAttribute('style') || '')) return true
    return false
  }
  function alignedRight(el: Element): boolean {
    return /text-align\s*:\s*right/i.test(el.getAttribute('style') || '') || (el.getAttribute('align') || '').toLowerCase() === 'right'
  }
  function positiveInt(value: string | null): number | null {
    const n = parseInt(value || '', 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  function sanitizeInto(src: Node, dst: Node): void {
    for (let child = src.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        const text = (child as Text).data.replace(/[ \t\r\n\f]+/g, ' ')
        if (text) dst.appendChild(outDoc.createTextNode(text))
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child as Element
      const tag = el.localName
      if (DROP.has(tag) || el.hasAttribute('hidden') || /display\s*:\s*none/i.test(el.getAttribute('style') || '')) continue
      if (tag === 'br') {
        dst.appendChild(outDoc.createElement('br'))
      } else if (tag === 'img') {
        const raw = el.getAttribute('data-original') || el.getAttribute('data-src') || el.getAttribute('src') || ''
        const index = raw ? registerImage(raw) : null
        if (index === null) continue
        const img = outDoc.createElement('img')
        img.setAttribute('src', 'ewb-pending:' + index)
        const width = positiveInt(el.getAttribute('width'))
        const height = positiveInt(el.getAttribute('height'))
        if (width) img.setAttribute('width', String(width))
        if (height) img.setAttribute('height', String(height))
        const alt = collapse(el.getAttribute('alt') || '').replace(/[<>"&]/g, '')
        if (alt) img.setAttribute('alt', alt)
        dst.appendChild(img)
      } else if (ownPlaceholders.has(el)) {
        const span = outDoc.createElement('span')
        span.setAttribute('data-ewb-qno', el.getAttribute('data-ewb-qno') || '0')
        dst.appendChild(span)
      } else if (tag === 'dot') {
        const em = outDoc.createElement('em')
        setRole(em, 'dot')
        sanitizeInto(el, em)
        dst.appendChild(em)
      } else if (KEEP_INLINE.has(tag)) {
        const node = outDoc.createElement(tag)
        sanitizeInto(el, node)
        dst.appendChild(node)
      } else if (KEEP_BLOCK.has(tag) || tag === 'tfoot') {
        const node = outDoc.createElement(tag === 'tfoot' ? 'tbody' : tag)
        if (tag === 'p' || tag === 'div') {
          if (alignedRight(el)) setRole(node, 'right-aligned')
        } else if (tag === 'table') {
          if (el.getAttribute('name') === 'optionsTable') setRole(node, 'options')
          else if (tableIsBordered(el)) setRole(node, 'bordered')
        } else if (tag === 'td' || tag === 'th') {
          const colspan = positiveInt(el.getAttribute('colspan'))
          const rowspan = positiveInt(el.getAttribute('rowspan'))
          if (colspan && colspan > 1) node.setAttribute('colspan', String(colspan))
          if (rowspan && rowspan > 1) node.setAttribute('rowspan', String(rowspan))
          if (ownLabelCells.has(el)) setRole(node, 'option-label')
          else if (alignedRight(el)) setRole(node, 'right-aligned')
        }
        sanitizeInto(el, node)
        dst.appendChild(node)
      } else {
        sanitizeInto(el, dst) // 其他标签（a、bk、font、span 等）去掉标签保留内容
      }
    }
  }

  // 顶层散落的行内内容包进段落；<br> 在顶层即分段；去掉空段落与首尾空白
  function paragraphize(container: Element): void {
    const nodes = Array.from(container.childNodes)
    while (container.firstChild) container.removeChild(container.firstChild)
    let current: HTMLElement | null = null
    const flush = (): void => {
      if (current) container.appendChild(current)
      current = null
    }
    for (const node of nodes) {
      const isBlock = node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName)
      const isBr = node.nodeType === 1 && (node as Element).tagName === 'BR'
      if (isBlock) {
        flush()
        container.appendChild(node)
      } else if (isBr) {
        flush()
      } else {
        if (!current) current = outDoc.createElement('p')
        current.appendChild(node)
      }
    }
    flush()
    for (const child of Array.from(container.children)) {
      if (child.tagName === 'P') trimParagraph(child)
      const meaningful = (child.textContent || '').replace(/[\s ]+/g, '') !== '' || child.querySelector('img, table, [data-ewb-qno]')
      if (child.tagName === 'P' && !meaningful) container.removeChild(child)
    }
  }
  function trimParagraph(p: Element): void {
    let first = p.firstChild
    while (first && ((first.nodeType === 3 && !(first as Text).data.trim()) || (first.nodeType === 1 && (first as Element).tagName === 'BR'))) {
      p.removeChild(first)
      first = p.firstChild
    }
    if (first && first.nodeType === 3) (first as Text).data = (first as Text).data.replace(/^[ \t\r\n\f]+/, '')
    let last = p.lastChild
    while (last && ((last.nodeType === 3 && !(last as Text).data.trim()) || (last.nodeType === 1 && (last as Element).tagName === 'BR'))) {
      p.removeChild(last)
      last = p.lastChild
    }
    if (last && last.nodeType === 3) (last as Text).data = (last as Text).data.replace(/[ \t\r\n\f]+$/, '')
  }
  // 整段只有一长串下划线：书面表达的作答区，标成横线区（保留下划线文本，下载时转为横线行）
  function markWritingLines(container: Element): void {
    for (const child of Array.from(container.children)) {
      if (child.tagName !== 'P' || child.querySelector('img')) continue
      if (!/^[\s _＿]*_{30,}[\s _＿]*$/.test(child.textContent || '')) continue
      const div = outDoc.createElement('div')
      setRole(div, 'writing-lines')
      div.appendChild(outDoc.createTextNode((child.textContent || '').trim()))
      container.replaceChild(div, child)
    }
  }
  function render(node: Node, isStem: boolean): { html: string; text: string; hasMedia: boolean } {
    const container = outDoc.createElement('div')
    sanitizeInto(node, container)
    paragraphize(container)
    if (isStem) markWritingLines(container)
    // 纯文本里图片记为 [图]，预览和内容指纹都用它
    const textCopy = container.cloneNode(true) as Element
    textCopy.querySelectorAll('img').forEach((img) => img.replaceWith(outDoc.createTextNode('[图]')))
    return {
      html: container.innerHTML,
      text: collapse(textCopy.textContent || ''),
      hasMedia: Boolean(container.querySelector('img'))
    }
  }

  // ---------- 小题号识别 ----------
  // 强标记：组卷网专用的小题号节点（[name=subquesnub]）与填空横线里的纯数字（<bk>16</bk>）。
  // 弱标记：行首文本里的「31. 」。一个题目块含多道小题时，块内连续编号的标记全部换成占位符。
  interface Marker { kind: 'sub' | 'blank' | 'line'; no: number; node: Node; atStart: boolean }
  interface Plan { markers: Marker[]; base: number; count: number; leadingNo: number | null }

  function isLineStart(text: Text, root: Element): boolean {
    let node: Node = text
    for (;;) {
      let prev: Node | null = node.previousSibling
      while (prev && prev.nodeType === 3 && !(prev.textContent || '').trim()) prev = prev.previousSibling
      if (prev) {
        if (prev.nodeType === 1) return (prev as Element).tagName === 'BR' || BLOCK_TAGS.has((prev as Element).tagName)
        return false
      }
      const parent = node.parentNode as Element | null
      if (!parent || parent === root || BLOCK_TAGS.has(parent.tagName)) return true
      node = parent
    }
  }
  function isAtStart(node: Node, root: Element): boolean {
    const range = doc.createRange()
    range.setStart(root, 0)
    range.setEndBefore(node)
    const fragment = range.cloneContents()
    return !(fragment.textContent || '').trim() && !fragment.querySelector('img, table, bk')
  }
  function collectMarkers(root: Element): Marker[] {
    const markers: Marker[] = []
    root.querySelectorAll('[name="subquesnub"]').forEach((el) => {
      const m = /^[\s ]*(\d{1,3})[\s ]*[.．、]?[\s ]*$/.exec(el.textContent || '')
      if (m) markers.push({ kind: 'sub', no: Number(m[1]), node: el, atStart: false })
    })
    root.querySelectorAll('bk').forEach((el) => {
      const m = /^[\s ]*(\d{1,3})[\s ]*$/.exec(el.textContent || '')
      if (m) markers.push({ kind: 'blank', no: Number(m[1]), node: el, atStart: false })
    })
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      if (text.parentElement && text.parentElement.closest('[name="subquesnub"], bk, table')) continue
      const m = /^[\s ]*(\d{1,3})([.．、])(?!\d)/.exec(text.data)
      if (!m || !isLineStart(text, root)) continue
      markers.push({ kind: 'line', no: Number(m[1]), node: text, atStart: false })
    }
    for (const marker of markers) if (marker.kind === 'line') marker.atStart = isAtStart(marker.node, root)
    return markers
  }
  function analyze(markers: Marker[]): Plan {
    const leading = markers.find((m) => m.kind === 'line' && m.atStart) || null
    const strong = markers.filter((m) => m.kind !== 'line')
    let base = leading ? leading.no : markers.length ? Math.min(...markers.map((m) => m.no)) : 0
    if (strong.length) base = Math.min(...strong.map((m) => m.no))
    const nos = new Set(markers.map((m) => m.no))
    let count = 1
    while (nos.has(base + count)) count++
    // 题目自己带着行首题号，而强标记的数字不在它的连续区间里：数字是别的东西（如横线编号），按单题处理
    if (leading && (leading.no < base || leading.no > base + count - 1)) {
      base = leading.no
      count = 1
    }
    return { markers, base, count, leadingNo: leading ? leading.no : null }
  }

  function placeholder(k: number): HTMLElement {
    const span = doc.createElement('span')
    span.setAttribute('data-ewb-qno', String(k))
    ownPlaceholders.add(span)
    return span
  }
  // 把节点里第一处数字换成占位符（拆分文本节点）或删掉；stripLead 时连同后面的「.」和空白一起删（题目开头的题号）
  function replaceDigits(container: Node, k: number | null, stripLead: boolean): void {
    const texts: Text[] = []
    if (container.nodeType === 3) {
      texts.push(container as Text)
    } else {
      const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
    }
    for (const text of texts) {
      const m = (stripLead ? /^[\s\u00a0]*\d{1,3}[.．、]?[\s\u00a0]*/ : /\d{1,3}/).exec(text.data)
      if (!m) continue
      const before = text.data.slice(0, m.index)
      const after = text.data.slice(m.index + m[0].length)
      if (k === null) {
        text.data = before + after
      } else {
        text.data = before
        const span = placeholder(k)
        const parent = text.parentNode as Node
        parent.insertBefore(span, text.nextSibling)
        if (after) parent.insertBefore(doc.createTextNode(after), span.nextSibling)
      }
      return
    }
  }
  function applyPlan(plan: Plan): void {
    const { base, count } = plan
    const lineMarkers = plan.markers.filter((m) => m.kind === 'line')
    for (const marker of plan.markers) {
      if (marker.no < base || marker.no > base + count - 1) continue
      if (count > 1) {
        replaceDigits(marker.node, marker.no - base, false)
      } else if (marker.kind === 'line') {
        // 单题：题目开头的题号去掉；开头没有题号时（题干前有说明文字），唯一的一处行首题号也去掉
        if (marker.atStart || (plan.leadingNo === null && lineMarkers.length === 1)) replaceDigits(marker.node, null, true)
      } else if (marker.kind === 'blank') {
        replaceDigits(marker.node, null, false)
      } else {
        ;(marker.node as Element).textContent = '' // 单道小题的行标签不要
      }
    }
  }
  // 小题行：<span 表格行><span name=subquesnub>16. </span><table 选项/></span> 合并成「号码格 + 选项」一张表
  function restructureSubRows(root: Element): void {
    root.querySelectorAll('[name="subquesnub"]').forEach((label) => {
      const row = label.parentElement
      if (!row) return
      const table = Array.from(row.children).find((c) => c !== label && c.tagName === 'TABLE') || null
      const hasText = Boolean((label.textContent || '').trim()) || Array.from(label.querySelectorAll('span')).some((span) => ownPlaceholders.has(span))
      if (table && hasText) {
        const rows = table.querySelectorAll('tr')
        const cell = doc.createElement('td')
        ownLabelCells.add(cell)
        while (label.firstChild) cell.appendChild(label.firstChild)
        if (rows.length === 1) {
          rows[0].insertBefore(cell, rows[0].firstChild)
        } else {
          const p = doc.createElement('p')
          while (cell.firstChild) p.appendChild(cell.firstChild)
          row.insertBefore(p, table)
        }
      }
      if (hasText && !table) {
        while (label.firstChild) label.parentNode!.insertBefore(label.firstChild, label)
      }
      label.remove()
    })
  }

  // ---------- 逐题收集 ----------
  interface Source {
    qid: string | null
    stem: Element
    answer: Element | null
    type: string
    sourceLabel: string
    sectionTitle: string
  }
  const sources: Source[] = []
  let pageTitle = ''
  let declaredCount: number | null = null
  let origin: { url: string; title: string } | null = null

  if (kind === 'paper') {
    pageTitle = textOf(doc.querySelector('h2.exam-title .title-txt .txt')) || textOf(doc.querySelector('.exam-title .title-txt')) || collapse(doc.title.replace(/-组卷网\s*$/, ''))
    const declared = /共\s*(\d+)\s*题/.exec(textOf(doc.querySelector('.ques-type-count .sec-item__title')))
    declaredCount = declared ? Number(declared[1]) : null
    const sectionTitles = Array.from(doc.querySelectorAll('.sec-title'))
    items.forEach((item) => {
      let section = ''
      for (const title of sectionTitles) {
        if (title.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) {
          const span = title.querySelector('span')
          section = textOf(span || title).replace(/\s*添加题型下试题\s*$/, '')
        } else break
      }
      const addi = item.querySelector('.ques-additional .addi-info')
      const adder = item.querySelector('a.addques[qyname]')
      sources.push({
        qid: item.getAttribute('questionid'),
        stem: item.querySelector('.exam-item__cnt') || item,
        answer: item.querySelector('.exam-item__opt .item.answer'),
        type: textOf(addi) || (adder ? adder.getAttribute('qyname') || '' : ''),
        sourceLabel: textOf(item.querySelector('.ques-src')),
        sectionTitle: section
      })
    })
  } else if (detailRoot) {
    const infoItems = Array.from(detailRoot.querySelectorAll('.info-list .info-item')).map((el) => textOf(el))
    const typeItem = infoItems.find((t) => /^题型[：:]/.test(t))
    const idItem = infoItems.find((t) => /^题号[：:]/.test(t))
    const srcItem = detailRoot.querySelector('.src-box .src-item')
    const originTitle = srcItem ? (srcItem.getAttribute('title') || '').replace(/^原始出处[：:]\s*/, '') : ''
    if (originTitle) {
      const link = Array.from(detailRoot.querySelectorAll('.more-src-links a[href]')).find((a) => (a.getAttribute('title') || '') === originTitle)
      if (link) {
        try {
          origin = { url: new URL(link.getAttribute('href') || '', 'https://zujuan.xkw.com/').href, title: originTitle }
        } catch {
          origin = null
        }
      }
    }
    // 答案区：去掉知识点与未登录提示后，还有内容才算答案
    const answerBox = doc.querySelector('.test-detail-page .answer-box')
    let answer: Element | null = null
    if (answerBox) {
      const copy = answerBox.cloneNode(true) as Element
      copy.querySelectorAll('.knowledges, .need-login').forEach((el) => el.remove())
      if (collapse(copy.textContent || '') || copy.querySelector('img')) answer = copy
    }
    sources.push({
      qid: detailRoot.getAttribute('questionid') || (idItem ? idItem.replace(/^题号[：:]\s*/, '') : null),
      stem: detailRoot.querySelector('.quest-cnt') || detailRoot,
      answer,
      type: typeItem ? typeItem.replace(/^题型[：:]\s*/, '') : '',
      sourceLabel: textOf(srcItem),
      sectionTitle: ''
    })
  }

  // 阶段一：克隆题干、识别小题号
  const prepared = sources.map((source) => {
    const clone = source.stem.cloneNode(true) as Element
    return { source, clone, plan: analyze(collectMarkers(clone)) }
  })
  // 阶段二：用相邻题块的起始题号对账，小题数不能超过到下一块起始题号的间隔
  prepared.forEach((entry, i) => {
    const start = entry.plan.leadingNo ?? (entry.plan.markers.length ? entry.plan.base : null)
    const next = prepared[i + 1]
    const nextStart = next ? (next.plan.leadingNo ?? (next.plan.markers.length ? next.plan.base : null)) : null
    if (start === null || nextStart === null || nextStart <= start) return
    const gap = nextStart - start
    if (entry.plan.count > gap) {
      diagnostics.push(`第 ${i + 1} 题块识别出 ${entry.plan.count} 道小题，题号间隔只有 ${gap}，按 ${gap} 处理`)
      entry.plan.count = gap
    } else if (entry.plan.count < gap) {
      diagnostics.push(`第 ${i + 1} 题块识别出 ${entry.plan.count} 道小题，题号间隔为 ${gap}`)
    }
  })
  // 阶段三：替换占位符、清洗
  const questions: ExtractedQuestion[] = prepared.map((entry, order) => {
    applyPlan(entry.plan)
    restructureSubRows(entry.clone)
    const stem = render(entry.clone, true)
    let answerHtml: string | null = null
    if (entry.source.answer) {
      const rendered = render(entry.source.answer, false)
      if (rendered.hasMedia || rendered.text) answerHtml = rendered.html
    }
    const start = entry.plan.leadingNo ?? (entry.plan.markers.length ? entry.plan.base : null)
    return {
      qid: entry.source.qid && /^\d{1,20}$/.test(entry.source.qid.trim()) ? entry.source.qid.trim() : null,
      questionType: entry.source.type.replace(/\s*[（(][^）)]*[）)]\s*$/, ''),
      sourceLabel: entry.source.sourceLabel,
      sectionTitle: entry.source.sectionTitle,
      order,
      numberCount: Math.max(1, entry.plan.count),
      stemHtml: stem.html,
      stemText: stem.text,
      answerHtml,
      start
    }
  })

  return { kind, url: location.href, title: pageTitle, origin, declaredCount, verification: false, questionCount: questions.length, images, questions, diagnostics }
}

// 注入页面的脚本文本；走 Electron 隔离世界执行，不受页面脚本改写全局对象的影响
export function extractScript(probeOnly = false): string {
  return `(${extractInPage.toString()})(${JSON.stringify({ probeOnly })})`
}
