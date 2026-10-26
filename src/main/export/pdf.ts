// PDF 输出：把整页 HTML 放进隐藏窗口，用 printToPDF 输出 A4。
// 内容里的图片走 ewb-asset:// 协议（默认会话），页面的 CSP 不允许任何脚本与网络请求。
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fillScript, PAPER_PAGE, type FillReport } from './paginate.ts'

const MM = 1 / 25.4 // 毫米 → 英寸（printToPDF 的页边距单位）
const TIMEOUT_MS = 120_000

// 页脚「第1页（共8页）」，与 Word 的页脚一致（docx.ts 的 footers）
const FOOTER = `<div style="width:100%;text-align:center;font-size:9px;color:#444;font-family:'Times New Roman',serif;">第<span class="pageNumber"></span>页（共<span class="totalPages"></span>页）</div>`

// 在隐藏窗口里加载 HTML，图片都加载完才交给 print；坏图直接报错而不是印出一个空框。prepare 在打印前改页面（按页摊开作答空白）
async function withPrintWindow(html: string, print: (win: BrowserWindow) => Promise<Buffer>, prepare?: (win: BrowserWindow) => Promise<void>): Promise<Buffer> {
  const dir = mkdtempSync(join(app.getPath('temp'), 'ewb-pdf-'))
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  let timer: NodeJS.Timeout | undefined
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    const file = join(dir, 'paper.html')
    writeFileSync(file, html, 'utf8')
    const work = (async (): Promise<Buffer> => {
      await win.loadFile(file)
      // 脚本被页面 CSP 挡住，这里只读状态
      const broken = (await win.webContents.executeJavaScript(
        `Array.from(document.images).filter((i) => !i.complete || (i.naturalWidth === 0 && !/\\.svg$/i.test(i.src))).map((i) => i.src + ' complete=' + i.complete + ' w=' + i.naturalWidth)`
      )) as string[]
      if (broken.length > 0) throw new Error(`有 ${broken.length} 张图片没能加载，无法生成 PDF：${broken.join('；')}`)
      if (prepare) await prepare(win)
      return print(win)
    })()
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('生成 PDF 超时')), TIMEOUT_MS)
    })
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    win.destroy()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      // 临时目录清不掉不该盖掉已生成的结果
      console.warn('清理 PDF 临时目录失败：', error)
    }
  }
}

// 试卷：页边距与页脚由打印参数给出；勾了「留作答区域」的卷子先按页摊开作答空白（paginate.ts），再打印
export function renderPdf(html: string): Promise<Buffer> {
  return withPrintWindow(
    html,
    (win) =>
      win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: FOOTER,
        margins: { top: PAPER_PAGE.marginTopMm * MM, bottom: PAPER_PAGE.marginBottomMm * MM, left: PAPER_PAGE.marginXMm * MM, right: PAPER_PAGE.marginXMm * MM }
      }),
    async (win) => {
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
      const report = (await win.webContents.executeJavaScript(fillScript())) as FillReport | null
      if (report) console.log(`[pdf] 按页摊开作答空白：${report.pages} 页，各页余量 ${report.spareMm.join('/')}mm${report.oversized ? `，${report.oversized} 段超过一页交给 Chromium 拆页` : ''}`)
    }
  )
}

// 答题卡：页面尺寸、页边距、四角定位块、页脚都写在页面自己的 @page 里（Chromium 的页边距盒），打印参数不再另给页边距
export function renderPdfByCss(html: string): Promise<Buffer> {
  return withPrintWindow(html, (win) => win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true }))
}
