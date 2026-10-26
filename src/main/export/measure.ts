// Word 排版用的文字测宽（需要 Electron 的隐藏窗口）：在隐藏窗口里用画布按 Word 里实际用到的字体测量，
// 选项排几列、数据表列宽据此决定，不再靠按字符类别估算（圈码、全角符号、粗体原来都估得不准）。
// 字体栈与 docx.ts 的默认字体一致：西文 Times New Roman，中文宋体（Windows 上是 SimSun，macOS 上回落到 Songti SC）。
import { BrowserWindow } from 'electron'
import { estimateTextWidth, measureKey, type MeasureRequest, type TextMeasure } from './docx'

const PX_TWIPS = 15 // 96 dpi：1 像素 = 15 twips
const BODY_PX = 14 // 五号 10.5pt = 14px
const FONT_STACK = '"Times New Roman", "SimSun", "宋体", "Songti SC", serif'

// 在隐藏窗口里执行：逐条量宽，单位像素
const MEASURE_SCRIPT = (requests: MeasureRequest[]): string => `(() => {
  const g = document.createElement('canvas').getContext('2d')
  return ${JSON.stringify(requests)}.map((r) => {
    g.font = (r.bold ? 'bold ' : '') + '${BODY_PX}px ${FONT_STACK}'
    return g.measureText(r.text).width
  })
})()`

export async function measureTexts(requests: MeasureRequest[]): Promise<TextMeasure> {
  if (requests.length === 0) return estimateTextWidth
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  try {
    await win.loadURL('about:blank')
    const widths = (await win.webContents.executeJavaScript(MEASURE_SCRIPT(requests))) as number[]
    const table = new Map<string, number>()
    requests.forEach((r, i) => table.set(measureKey(r.text, r.bold), Math.ceil(widths[i] * PX_TWIPS)))
    // 没量到的（文字在两次生成之间变了的情况）退回估算
    return (text, bold) => table.get(measureKey(text, bold)) ?? estimateTextWidth(text)
  } finally {
    win.destroy()
  }
}
