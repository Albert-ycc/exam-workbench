// 题目 HTML 在编辑器里的进出：载入时把小题号占位符显示成不可编辑的题号，保存时还原并按入库口径净化。
// 不用 sanitizeQuestionHtml 做存盘净化：它自定义的 ALLOWED_URI_REGEXP 会把 width / height / colspan / rowspan
// 这类普通属性值一并判成非法地址删掉，改一个字就会丢掉图片尺寸和合并单元格。
import DOMPurify from 'dompurify'

// 入库口径：标签与属性白名单，见 domain.ts 的题目内容约定
const STORED_TAGS = ['p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'ol', 'ul', 'li']
const STORED_ATTRS = ['src', 'width', 'height', 'alt', 'colspan', 'rowspan', 'data-ewb-qno', 'data-role']

const QNO_PLACEHOLDER = /<span data-ewb-qno="(\d+)"><\/span>/g

// 只认本地图片：src 以外的属性值只允许数字、字母、连字符、小数点和百分号
export function sanitizeStored(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.body.querySelectorAll('img').forEach((img) => {
    if (!img.getAttribute('src')?.startsWith('ewb-asset://')) img.remove()
  })
  return DOMPurify.sanitize(doc.body.innerHTML, {
    ALLOWED_TAGS: STORED_TAGS,
    ALLOWED_ATTR: STORED_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:ewb-asset:\/\/|[\w.%-]+$)/i
  })
}

// 载入编辑区：占位符显示为题号，且整体不可编辑、不可被删除
export function toEditableHtml(html: string, firstNo: number): string {
  return sanitizeStored(html).replace(QNO_PLACEHOLDER, (_m, k: string) => `<span data-ewb-qno="${k}" contenteditable="false">${firstNo + Number(k)}</span>`)
}

// 从编辑区取回内容：题号还原成空占位符，其余只留白名单内的标签和属性
export function fromEditable(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-ewb-qno]').forEach((node) => {
    const placeholder = document.createElement('span')
    placeholder.setAttribute('data-ewb-qno', node.getAttribute('data-ewb-qno') ?? '0')
    node.replaceWith(placeholder)
  })
  return sanitizeStored(clone.innerHTML)
}

// 内容里既没有文字也没有图片和表格：答案清空后存成 null
export function isBlankHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return !doc.body.textContent?.trim() && !doc.body.querySelector('img, table')
}

// 题干纯文本摘要，用于提示条与拖动浮标。DOMParser 解析出的文档是惰性的，不会去加载图片。
// 小题号占位换成「□」，公式图换成「[公式]」，否则公式整段消失，读起来只剩逗号或像缺字
export function plainText(html: string, max = 48, imageMark = '[公式]'): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('[data-ewb-qno]').forEach((n) => n.replaceWith('□'))
  doc.querySelectorAll('img').forEach((n) => n.replaceWith(imageMark))
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text || '（图片题）'
}
