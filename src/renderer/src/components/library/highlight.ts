// 关键词命中高亮：在题干 HTML 的文字节点里把命中的词包上 <mark>。
// 只在文字里找，不碰标签与属性；净化（QuestionHtml）保留 <mark>，样式在 library.css。
// 跨标签的命中（词被 <b> 劈开）高亮不到，但筛选仍然命中，这类题只是没有标记。
export function highlightHtml(html: string, keyword: string): string {
  const needle = keyword.trim()
  if (!needle) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const lower = needle.toLowerCase()
  const texts: Text[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
  let hit = false
  for (const text of texts) {
    const value = text.data
    // 个别字符转小写后长度会变（如 İ），按小写串算出的位置对不上原文，这个节点不高亮
    if (value.toLowerCase().length !== value.length) continue
    const at = value.toLowerCase().indexOf(lower)
    if (at === -1) continue
    hit = true
    const fragment = doc.createDocumentFragment()
    let from = 0
    for (let i = at; i !== -1; i = value.toLowerCase().indexOf(lower, from)) {
      if (i > from) fragment.append(value.slice(from, i))
      const mark = doc.createElement('mark')
      mark.textContent = value.slice(i, i + lower.length)
      fragment.append(mark)
      from = i + lower.length
    }
    if (from < value.length) fragment.append(value.slice(from))
    text.replaceWith(fragment)
  }
  return hit ? doc.body.innerHTML : html
}
