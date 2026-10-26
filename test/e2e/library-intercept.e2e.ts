// 入库端到端测试的公用部分（不是独立的测试）：用 test/fixtures 里的组卷网真实页面样本代替组卷网。
// library / import-classify / pages 三套共用。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { FIXTURES_DIR } from '../../scripts/fixtures.ts'

export const FIXTURES = FIXTURES_DIR
export const PAPER_URL = 'https://zujuan.xkw.com/2p3543573.html'
export const QUESTION_URL = 'https://zujuan.xkw.com/2q17150767.html'
export const ENGLISH_URL = 'https://zujuan.xkw.com/2p1111111.html'
export const VERIFY_URL = ENGLISH_URL
export const VERIFY_FOREVER_URL = 'https://zujuan.xkw.com/2p2222222.html'

export async function installIntercept(app: ElectronApplication): Promise<void> {
  const answerImg = '<div class="item answer"><img src="https://staticzujuan.xkw.com/quesimg/Upload/answer/e2e-answer.png"></div>'
  let paper = readFileSync(join(FIXTURES, 'zujuan-math-7a.html'), 'utf8')
  const empty = '<div class="item answer"></div>'
  const second = paper.indexOf(empty, paper.indexOf(empty) + 1) // 第二题放一张答案图
  assert.ok(second > 0)
  paper = paper.slice(0, second) + answerImg + paper.slice(second + empty.length)
  const pages = {
    '/2p3543573.html': paper,
    '/2q17150767.html': readFileSync(join(FIXTURES, 'zujuan-question-math.html'), 'utf8'),
    '/2p1111111.html': readFileSync(join(FIXTURES, 'zujuan-english-7a.html'), 'utf8'),
    // 页面标明 30 题、实际只有 20 题：预览要提示核对
    '/2p3333333.html': readFileSync(join(FIXTURES, 'zujuan-english-7a.html'), 'utf8').replace('试卷题型（共 20题）', '试卷题型（共 30题）')
  }
  // 1×1 的有效 PNG，后面附上请求地址，保证每个地址的图片内容不同（入库按内容哈希存放）
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  await app.evaluate(async ({ session }, { pages, png }) => {
    const ses = session.fromPartition('persist:zujuan')
    await ses.setProxy({ proxyRules: 'http://127.0.0.1:9' }) // 万一拦截漏了也不会真的出网
    const verifyHtml = '<!doctype html><html><head><title>安全验证</title></head><body><div>访问过于频繁，请完成安全验证后继续访问</div></body></html>'
    const state = { served: [] as string[], verify: new Set(['/2p1111111.html', '/2p2222222.html']), pages }
    ;(globalThis as unknown as { __ewb: typeof state }).__ewb = state
    const html = { 'content-type': 'text/html; charset=utf-8' }
    ses.protocol.handle('https', (request) => {
      state.served.push(request.url)
      const url = new URL(request.url)
      if (url.hostname === 'zujuan.xkw.com') {
        if (state.verify.has(url.pathname)) return new Response(verifyHtml, { headers: html })
        const page = (state.pages as Record<string, string>)[url.pathname]
        return new Response(page ?? '<!doctype html><html><body>组卷网</body></html>', { headers: html })
      }
      if (/\.(xkw|zxxk)\.com$/.test(url.hostname)) {
        const head = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
        const tail = new TextEncoder().encode(request.url)
        const body = new Uint8Array(head.length + tail.length)
        body.set(head)
        body.set(tail, head.length)
        return new Response(body, { headers: { 'content-type': 'image/png' } })
      }
      return new Response('', { status: 404 })
    })
  }, { pages, png })
}
