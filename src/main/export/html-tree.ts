// 题目内容（白名单 HTML）的轻量解析与序列化。不依赖 DOM，主进程与 node 测试都能直接用。
// 入库后的内容只含 p br span b strong i em u sub sup img table thead tbody tr td th div ol ul li，
// 属性只含 src width height alt colspan rowspan data-ewb-qno data-role（输出时 data-ewb-qno 不再保留）；这里按同一份白名单输出，
// 其余标签只保留子内容、其余属性丢弃，作为导出前的最后一道净化。

export interface TextNode {
  type: 'text'
  text: string
}
export interface ElementNode {
  type: 'el'
  tag: string
  attrs: Record<string, string>
  children: HNode[]
}
export type HNode = TextNode | ElementNode

// XML 1.0 不允许的字符：除 Tab、换行、回车之外的 C0 控制字符，U+FFFE、U+FFFF，以及不成对的代理项。
// 它们出现在 Word 的 document.xml 里会让整个文件打不开，所以进入导出内容的所有文字（标题、大题名、来源、题干、答案）先清掉
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '')
}

export const text = (value: string): TextNode => ({ type: 'text', text: stripInvalidXmlChars(value) })
export const el = (tag: string, attrs: Record<string, string> = {}, children: HNode[] = []): ElementNode => ({ type: 'el', tag, attrs, children })

const OUT_TAGS = new Set(['p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'ol', 'ul', 'li'])
// 输出时不带 data-ewb-qno：真正的占位元素在这之前已被 fillQuestionNumbers 换成了题号，剩下的都是普通 span
const OUT_ATTRS = new Set(['src', 'width', 'height', 'alt', 'colspan', 'rowspan', 'data-role'])
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'wbr'])
// 嵌套超过这个深度的元素不再入栈（内容并入当前层），避免后面递归遍历时栈溢出
const MAX_DEPTH = 200
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'noscript', 'template'])
// 块级标签：出现在行内内容中间时会截断段落
export const BLOCK_TAGS = new Set(['p', 'div', 'table', 'thead', 'tbody', 'tr', 'ol', 'ul', 'li'])
// 遇到这些开始标签时，先关闭栈顶同类的未闭合元素
const AUTO_CLOSE: Record<string, string[]> = { p: ['p'], li: ['li'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'] }

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  divide: '÷',
  middot: '·',
  deg: '°',
  plusmn: '±'
}

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/y
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase()
    if (name === '/') continue
    attrs[name] = stripInvalidXmlChars(decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''))
  }
  return attrs
}

export function parseHtml(rawHtml: string): HNode[] {
  const html = stripInvalidXmlChars(rawHtml)
  const root = el('#root')
  const stack: ElementNode[] = [root]
  const top = (): ElementNode => stack[stack.length - 1]
  const pushText = (raw: string): void => {
    if (!raw) return
    const value = stripInvalidXmlChars(decodeEntities(raw)) // 数字字符引用（&#1;）解出来的控制字符同样要清
    const last = top().children[top().children.length - 1]
    if (last?.type === 'text') last.text += value
    else top().children.push(text(value))
  }

  let i = 0
  // 下一个 '>' 的位置（-1 表示后面再没有）：「有 < 无 >」的文本不必每个 < 都扫到结尾去试匹配
  let nextGt = html.indexOf('>')
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      pushText(html.slice(i))
      break
    }
    if (lt > i) pushText(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end === -1 ? html.length : end + 3
      continue
    }
    if (nextGt !== -1 && nextGt < lt) nextGt = html.indexOf('>', lt)
    TAG_RE.lastIndex = lt
    const m = nextGt === -1 ? null : TAG_RE.exec(html)
    if (!m) {
      pushText('<')
      i = lt + 1
      continue
    }
    i = lt + m[0].length
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k
          break
        }
      }
      continue
    }
    if (DROP_CONTENT_TAGS.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i)
      const close = end === -1 ? -1 : html.indexOf('>', end)
      i = close === -1 ? html.length : close + 1
      continue
    }
    const closes = AUTO_CLOSE[tag]
    if (closes) while (stack.length > 1 && closes.includes(top().tag)) stack.pop()
    const node = el(tag, parseAttrs(m[3]))
    top().children.push(node)
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[3]) && stack.length <= MAX_DEPTH) stack.push(node)
  }
  return root.children
}

// ---------- 序列化 ----------

export function escapeText(value: string): string {
  return stripInvalidXmlChars(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(value: string): string {
  return stripInvalidXmlChars(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function serializeNodes(nodes: HNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeText(node.text)
      continue
    }
    if (!OUT_TAGS.has(node.tag)) {
      out += serializeNodes(node.children)
      continue
    }
    if (node.tag === 'span' && node.children.length === 0 && !node.attrs['data-role']) continue // 空 span（含不是真占位符的占位元素）丢弃
    let attrs = ''
    for (const [name, value] of Object.entries(node.attrs)) {
      if (OUT_ATTRS.has(name)) attrs += ` ${name}="${escapeAttr(value)}"`
    }
    out += node.tag === 'br' || node.tag === 'img' ? `<${node.tag}${attrs}>` : `<${node.tag}${attrs}>${serializeNodes(node.children)}</${node.tag}>`
  }
  return out
}

// ---------- 通用查询 ----------

export function walk(nodes: HNode[], visit: (node: ElementNode) => void): void {
  for (const node of nodes) {
    if (node.type !== 'el') continue
    visit(node)
    walk(node.children, visit)
  }
}

export function collectImages(nodes: HNode[]): ElementNode[] {
  const found: ElementNode[] = []
  walk(nodes, (node) => {
    if (node.tag === 'img') found.push(node)
  })
  return found
}

export function textContent(nodes: HNode[]): string {
  let out = ''
  for (const node of nodes) out += node.type === 'text' ? node.text : textContent(node.children)
  return out
}

// 排版上有东西要输出：非空白文字、图片、表格或带下划线的空格（填空横线）。nbsp 与全角空格不算（它们常被用来撑空段落）。
// 这是「这段要不要排出来」的判断；「题目有没有答案」走 shared/numbering.ts 的 hasVisibleContent，与自检同一口径
export function hasRenderableContent(nodes: HNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.text.replace(/[\s 　]/g, '') !== '') return true
    } else if (node.tag === 'img' || node.tag === 'table') {
      return true
    } else if (node.tag === 'u' && textContent(node.children) !== '') {
      return true // 带下划线的空格是填空横线
    } else if (hasRenderableContent(node.children)) {
      return true
    }
  }
  return false
}

// 把散落的行内内容包进段落，保证每一层都是「块级节点列表」；div 逐层处理，空白间隔丢弃
export function blockify(nodes: HNode[]): HNode[] {
  const out: HNode[] = []
  let run: HNode[] = []
  const flush = (): void => {
    if (hasRenderableContent(run)) out.push(el('p', {}, run))
    run = []
  }
  for (const node of nodes) {
    if (node.type === 'el' && BLOCK_TAGS.has(node.tag)) {
      flush()
      if (node.tag === 'div') node.children = blockify(node.children)
      out.push(node)
    } else if (node.type === 'el' && !OUT_TAGS.has(node.tag)) {
      // 白名单之外的标签当作透明容器
      const inner = blockify(node.children)
      if (inner.length === 1 && inner[0].type === 'el' && inner[0].tag === 'p') run.push(...inner[0].children)
      else {
        flush()
        out.push(...inner)
      }
    } else {
      run.push(node)
    }
  }
  flush()
  return out
}
