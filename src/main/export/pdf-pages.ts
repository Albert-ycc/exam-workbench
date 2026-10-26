// 从 PDF 字节里数页数（不依赖 Electron）。Chromium 输出的页面对象是未压缩的 `/Type /Page` 字典，
// 页树节点是 `/Type /Pages`。认不出来时返回 null，界面不显示页数。
export function countPdfPages(pdf: Uint8Array): number | null {
  const text = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).toString('latin1')
  if (!text.startsWith('%PDF')) return null
  const pages = text.match(/\/Type\s*\/Page(?![A-Za-z])/g)
  return pages && pages.length > 0 ? pages.length : null
}
