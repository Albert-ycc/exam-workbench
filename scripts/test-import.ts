// 入库测试：node scripts/test-import.ts [证据目录]
// 拆题部分用真实 Electron 页面环境（DOM、隔离世界）跑三份真实样本与几份构造页面；
// 去重、图片下载、入库提交、试题库查询用临时数据库与假的下载函数。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { assetNameFromUrl } from '../src/main/assets.ts'
import { openDatabase } from '../src/main/db.ts'
import { commitPages } from '../src/main/library/commit.ts'
import { SeenQuestions } from '../src/main/library/dedupe.ts'
import { extractScript, type ExtractedPage } from '../src/main/library/extract-script.ts'
import { MAX_IMAGE_BYTES, downloadImage, sniffImageExt, type ImageFetcher } from '../src/main/library/images.ts'
import { preparePage, toPreview } from '../src/main/library/prepare.ts'
import { deleteQuestion, listQuestionTypes, listQuestions, listSourcePapers } from '../src/main/library/queries.ts'
import { classifyZujuanUrl, normalizeImportUrl, primaryQuestionType, splitPastedLinks } from '../src/shared/library.ts'

const ROOT = resolve(import.meta.dirname, '..')
const FIXTURES = join(ROOT, 'test/fixtures')
const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-import-'))
mkdirSync(evidence, { recursive: true })

let passed = 0
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed++
    console.log('  ✓ ' + name)
  })
}

// ---------- 在 Electron 页面环境里执行拆题脚本 ----------

interface PageRun {
  page: ExtractedPage
  probe: ExtractedPage
  domBefore: string
  domAfter: string
}

const SYNTHETIC: Record<string, string> = {
  verification: '<!doctype html><html><head><title>安全验证</title></head><body><div>访问过于频繁，请完成安全验证后继续访问</div></body></html>',
  plain: '<!doctype html><html><head><title>组卷网</title></head><body><p>首页</p></body></html>',
  answers: `<!doctype html><html><head><title>构造页面-组卷网</title></head><body>
<article class="exam-cnt"><h2 class="exam-title"><div class="title-txt"><span class="txt">构造试卷</span></div></h2>
<section class="exam-list">
<h4 class="sec-title"><span>一、单选题</span><a>添加题型下试题</a></h4>
<div class="tk-quest-item" questionid="900001"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">单选题</span></span><a class="ques-src">来源甲</a></div>
<div class="exam-item__cnt">1. 计算 <img data-src="https://staticzujuan.xkw.com/quesimg/Upload/formula/a.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="vertical-align:middle;" onerror="alert(1)"> 的值<script>alert(1)</script><button>加入试题篮</button><a href="javascript:void 0" onclick="x()">链接文字</a><span hidden>隐藏文字</span><p style="text-align:right;color:red" class="foo" id="bar">右对齐段落</p></div>
<div hidden class="exam-item__opt"><div class="item knowlegde"><p>【知识点】有理数</p></div><div class="item answer"><img src="https://staticzujuan.xkw.com/quesimg/Upload/answer/b.png" style="width:300px"><p>【答案】C</p></div></div></div>
<div class="tk-quest-item" questionid="900002"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">填空题</span></span><a class="ques-src">来源甲</a></div>
<div class="exam-item__cnt">2. 小明有 3. 5 元；<br>(1) 第一问<br>(2) 第二问</div>
<div hidden class="exam-item__opt"><div class="item answer">  </div></div></div>
</section></article></body></html>`,
  // 页面里夹带的内部标记、伪造的待保存引用、非数字题目编号、危险图片地址
  hostile: `<!doctype html><html><body><article class="exam-cnt"><section class="exam-list">
<h4 class="sec-title"><span>一、解答题</span></h4>
<div class="tk-quest-item" questionid="1; DROP TABLE questions"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">证明题</span></span><a class="ques-src">来源丙</a></div>
<div class="exam-item__cnt">1. 文字 ewb-pending:99 <span data-ewb-qno="7">乙</span><span data-ewb-role="options">丙</span><img src="javascript:alert(1)"><img src="https://evil.example.com/x.png"> 结束</div>
<div hidden class="exam-item__opt"><div class="item answer"></div></div></div>
</section></article></body></html>`,
  // 试卷页答案区伪造内部标记：答案不参与小题编号，页面自带的 data-ewb-* 一律不认
  evilAnswer: `<!doctype html><html><body><article class="exam-cnt"><section class="exam-list">
<h4 class="sec-title"><span>一、单选题</span></h4>
<div class="tk-quest-item" questionid="900041"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">单选题</span></span><a class="ques-src">来源己</a></div>
<div class="exam-item__cnt">1. 题干 <span data-ewb-qno="abc"></span><b data-ewb-qno="3">粗</b></div>
<div hidden class="exam-item__opt"><div class="item answer"><span data-ewb-qno="abc"></span>答案<span data-ewb-qno="0">甲</span><table><tbody><tr><td data-ewb-role="option-label">丙</td></tr></tbody></table></div></div></div>
</section></article></body></html>`,
  // 单题页答案区伪造内部标记
  evilQuestion: `<!doctype html><html><body><main class="page test-detail-page"><section class="left-box"><section class="quest-content">
<div class="quesroot" questionid="900031" bankid="2"><div class="info-list"><span class="info-item">题型：单选题</span></div>
<div class="cnt-box"><div class="quest-cnt">下列正确的是<span data-ewb-qno="9">x</span></div><div class="quest-exam"><div class="src-box"><a class="src-item" title="原始出处：某卷">来源戊</a></div></div></div></div></section>
<section class="answer-box"><div class="knowledges">知识点</div><span data-ewb-qno="abc"></span><p>答案图</p><img src="https://staticzujuan.xkw.com/a/b.png"><span data-ewb-role="option-label">戊</span></section></section></main></body></html>`,
  // 说明文字后面只有一道小题：行首题号去掉，不留占位符
  loneNumber: `<!doctype html><html><body><article class="exam-cnt"><section class="exam-list">
<h4 class="sec-title"><span>一、阅读</span></h4>
<div class="tk-quest-item" questionid="900021"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">阅读理解</span></span><a class="ques-src">来源丁</a></div>
<div class="exam-item__cnt">阅读材料。<br>51. 问题一？</div><div hidden class="exam-item__opt"><div class="item answer"></div></div></div>
<div class="tk-quest-item" questionid="900022"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">阅读理解</span></span><a class="ques-src">来源丁</a></div>
<div class="exam-item__cnt">52. 下一题</div><div hidden class="exam-item__opt"><div class="item answer"></div></div></div>
</section></article></body></html>`,
  // 单道题自带题号，题干里另有 1.、2. 开头的条目：不能被当成小题
  listInStem: `<!doctype html><html><body><article class="exam-cnt"><section class="exam-list">
<h4 class="sec-title"><span>一、填空题</span></h4>
<div class="tk-quest-item" questionid="900011"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">填空题</span></span><a class="ques-src">来源乙</a></div>
<div class="exam-item__cnt">5. 按要求排序：<br>1. 苹果<br>2. 香蕉</div><div hidden class="exam-item__opt"><div class="item answer"></div></div></div>
<div class="tk-quest-item" questionid="900012"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">填空题</span></span><a class="ques-src">来源乙</a></div>
<div class="exam-item__cnt">6. 下一题</div><div hidden class="exam-item__opt"><div class="item answer"></div></div></div>
</section></article></body></html>`
}

async function runPages(files: Record<string, string>): Promise<Record<string, PageRun>> {
  const dir = mkdtempSync(join(tmpdir(), 'ewb-import-host-'))
  writeFileSync(join(dir, 'main.cjs'), "require('electron').app.whenReady().then(() => {}); require('electron').app.on('window-all-closed', () => {})")
  const electronPath = createRequire(import.meta.url)('electron') as unknown as string
  const app = await electron.launch({ executablePath: electronPath, args: [join(dir, 'main.cjs')] })
  try {
    const result = await app.evaluate(
      async ({ BrowserWindow, session }, { files, extract, probe }) => {
        // 样本页里的图片地址指向真实站点：测试期间一律拦截，不产生网络访问
        const ses = session.fromPartition('import-test')
        ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(file|data|devtools):/.test(details.url) }))
        const out: Record<string, unknown> = {}
        for (const [name, file] of Object.entries(files)) {
          const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } })
          await win.loadFile(file)
          const run = (code: string): Promise<unknown> => win.webContents.executeJavaScriptInIsolatedWorld(7001, [{ code }])
          const domBefore = await run('document.documentElement.outerHTML')
          const probeResult = await run(probe)
          const page = await run(extract)
          const domAfter = await run('document.documentElement.outerHTML')
          out[name] = { page, probe: probeResult, domBefore, domAfter }
          win.destroy()
        }
        return out
      },
      { files, extract: extractScript(), probe: extractScript(true) }
    )
    return result as Record<string, PageRun>
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- 白名单校验器（先反向验证它能抓出违规） ----------

const ALLOWED_TAGS = new Set('p br span b strong i em u sub sup img table thead tbody tr td th div ol ul li'.split(' '))
const ALLOWED_ATTRS = new Set('src width height alt colspan rowspan data-ewb-qno data-role'.split(' '))
function whitelistViolations(html: string): string[] {
  const bad: string[] = []
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    if (!ALLOWED_TAGS.has(m[1].toLowerCase())) bad.push(`标签 ${m[1]}`)
    for (const a of m[2].matchAll(/\s+([^\s=>]+)/g)) if (!ALLOWED_ATTRS.has(a[1])) bad.push(`属性 ${a[1]}（${m[1]}）`)
  }
  // 标签总数与匹配到的数量对得上，防止正则漏掉畸形标签
  const lt = (html.match(/</g) ?? []).length
  const matched = (html.match(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[^\s=>]+(?:="[^"]*")?)*\s*\/?>/g) ?? []).length
  if (lt !== matched) bad.push(`存在无法解析的尖括号（${lt} 个 <，匹配 ${matched} 个标签）`)
  return bad
}

// ---------- 假的下载函数 ----------

const PNG_HEAD = Buffer.from('89504e470d0a1a0a', 'hex')
function fakePng(seed: string): Buffer {
  return Buffer.concat([PNG_HEAD, Buffer.from(createHash('sha256').update(seed).digest('hex'))])
}
function makeFetcher(failing: (url: string) => boolean = () => false): { fetcher: ImageFetcher; calls: string[] } {
  const calls: string[] = []
  const fetcher: ImageFetcher = async (url) => {
    calls.push(url)
    if (failing(url)) return { status: 404, contentType: 'text/html', bytes: Buffer.from('not found') }
    return { status: 200, contentType: 'image/png', bytes: fakePng(url) }
  }
  return { fetcher, calls }
}

// ---------- 主流程 ----------

const FILES: Record<string, string> = {
  math: join(FIXTURES, 'zujuan-math-7a.html'),
  english: join(FIXTURES, 'zujuan-english-7a.html'),
  physics: join(FIXTURES, 'zujuan-physics-8a.html'),
  question: join(FIXTURES, 'zujuan-question-math.html')
}
const synthDir = mkdtempSync(join(tmpdir(), 'ewb-import-synth-'))
for (const [name, html] of Object.entries(SYNTHETIC)) {
  FILES[name] = join(synthDir, `${name}.html`)
  writeFileSync(FILES[name], html, 'utf8')
}

console.log('拆题（真实页面环境）')
const runs = await runPages(FILES)
// 样本是本地文件，页面地址换成它们在组卷网上的样子（数学卷、英语卷与单题页的链接是真实的，物理卷是示意编号）
const PAPER_URL = 'https://zujuan.xkw.com/2p3543573.html'
const QUESTION_URL = 'https://zujuan.xkw.com/2q17150767.html'
const PAGE_URLS: Record<string, string> = { math: PAPER_URL, english: 'https://zujuan.xkw.com/3p3537274.html', physics: 'https://zujuan.xkw.com/4p9000002.html', question: QUESTION_URL }
for (const [name, url] of Object.entries(PAGE_URLS)) runs[name].page.url = url
writeFileSync(join(evidence, 'extracted-summary.json'), JSON.stringify(Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { kind: v.page.kind, title: v.page.title, questions: v.page.questions.map((q) => ({ qid: q.qid, type: q.questionType, label: q.sourceLabel, section: q.sectionTitle, n: q.numberCount, start: q.start, text: q.stemText.slice(0, 40), hasAnswer: q.answerHtml !== null })), diagnostics: v.page.diagnostics }])), null, 1))

await check('白名单校验器能抓出违规（反向验证）', () => {
  assert.ok(whitelistViolations('<p>ok</p>').length === 0)
  assert.ok(whitelistViolations('<a href="x">t</a>').length >= 2)
  assert.ok(whitelistViolations('<p style="color:red">t</p>').length === 1)
  assert.ok(whitelistViolations('<p class="a" onclick="x()">t</p>').length === 2)
  assert.ok(whitelistViolations('<p>1 < 2</p>').length === 1)
})

const EXPECTED: [string, number][] = [['math', 23], ['english', 20], ['physics', 26]]
for (const [name, count] of EXPECTED) {
  const { page } = runs[name]
  await check(`${name}：识别为试卷页，拆出 ${count} 道题，标题非空`, () => {
    assert.equal(page.kind, 'paper')
    assert.equal(page.questions.length, count)
    assert.equal(page.questionCount, count)
    assert.ok(page.title.length > 5, page.title)
    assert.equal(page.declaredCount, count, '页面自己标明的题数应与拆出的题数一致')
  })
  await check(`${name}：题目编号不重复，题型、来源标签、大题标题都不为空`, () => {
    const qids = page.questions.map((q) => q.qid)
    assert.ok(qids.every((q) => q && /^\d+$/.test(q)))
    assert.equal(new Set(qids).size, count)
    for (const q of page.questions) {
      assert.ok(q.questionType, `第 ${q.order + 1} 题题型为空`)
      assert.ok(q.sourceLabel, `第 ${q.order + 1} 题来源标签为空`)
      assert.ok(q.sectionTitle, `第 ${q.order + 1} 题大题标题为空`)
      assert.ok(q.stemText.length > 0, `第 ${q.order + 1} 题题干为空`)
    }
  })
  await check(`${name}：题干不以题号开头，起始题号逐题连续，小题数与题号间隔一致`, () => {
    for (const q of page.questions) {
      assert.ok(!/^\s*\d{1,3}\s*[.．、]/.test(q.stemText), `题干以题号开头：${q.stemText.slice(0, 20)}`)
      assert.ok(!/^<p>\s*\d{1,3}\s*[.．、]/.test(q.stemHtml), `题干 HTML 以题号开头：${q.stemHtml.slice(0, 40)}`)
      assert.ok(q.start !== null, `第 ${q.order + 1} 题没有识别到起始题号`)
    }
    page.questions.forEach((q, i) => {
      const next = page.questions[i + 1]
      if (next) assert.equal(q.start! + q.numberCount, next.start!, `第 ${i + 1} 题块：起始 ${q.start} + 小题数 ${q.numberCount} 应等于下一块起始 ${next.start}`)
    })
    assert.deepEqual(page.diagnostics, [])
    const total = page.questions.reduce((sum, q) => sum + q.numberCount, 0)
    assert.equal(total, page.questions.at(-1)!.start! + page.questions.at(-1)!.numberCount - page.questions[0].start!)
  })
  await check(`${name}：题干与答案里没有白名单外的标签和属性`, () => {
    for (const q of page.questions) {
      assert.deepEqual(whitelistViolations(q.stemHtml), [], `第 ${q.order + 1} 题`)
      if (q.answerHtml) assert.deepEqual(whitelistViolations(q.answerHtml), [])
    }
  })
  await check(`${name}：图片地址全部改写为待保存引用，原地址不留在内容里`, () => {
    for (const q of page.questions) {
      const srcs = [...q.stemHtml.matchAll(/src="([^"]*)"/g)].map((m) => m[1])
      for (const src of srcs) {
        const m = /^ewb-pending:(\d+)$/.exec(src)
        assert.ok(m, `图片地址未改写：${src}`)
        assert.ok(Number(m![1]) < page.images.length)
      }
      assert.ok(!/xkw\.com|zxxk\.com|https?:/.test(q.stemHtml))
    }
    assert.ok(page.images.every((u) => /^https:\/\/(staticzujuan|img)\.xkw\.com\//.test(u)))
    assert.equal(new Set(page.images).size, page.images.length)
  })
  await check(`${name}：未登录样本没有答案；拆题不修改页面 DOM`, () => {
    assert.ok(page.questions.every((q) => q.answerHtml === null))
    assert.equal(runs[name].domBefore, runs[name].domAfter)
    assert.equal(runs[name].probe.questions.length, 0)
    assert.equal(runs[name].probe.questionCount, count)
  })
}

await check('英语：完形填空 15 空、阅读理解等多小题块的小题数与占位符', () => {
  const qs = runs.english.page.questions
  const byLabel = (q: (typeof qs)[number]): number => {
    const blanks = /-(\d+)空/.exec(q.questionType)
    const reading = /阅读单选\/选择(\d+)题/.exec(q.questionType)
    return Number((blanks ?? reading)?.[1] ?? 0)
  }
  const multi = qs.filter((q) => q.numberCount > 1)
  assert.deepEqual(multi.map((q) => q.numberCount), [5, 15, 5, 5, 5, 5, 5, 10])
  for (const q of qs) if (byLabel(q)) assert.equal(q.numberCount, byLabel(q), q.questionType)
  for (const q of multi) {
    const ks = [...q.stemHtml.matchAll(/<span data-ewb-qno="(\d+)"><\/span>/g)].map((m) => Number(m[1]))
    assert.ok(ks.length >= q.numberCount, `${q.questionType} 占位符不足`)
    assert.deepEqual([...new Set(ks)].sort((a, b) => a - b), Array.from({ length: q.numberCount }, (_, i) => i))
  }
  for (const q of qs.filter((q) => q.numberCount === 1)) assert.ok(!q.stemHtml.includes('data-ewb-qno'), '单题不应有占位符')
  const cloze = qs.find((q) => q.questionType.startsWith('完形填空'))!
  assert.equal(cloze.numberCount, 15)
  assert.ok(cloze.stemHtml.includes('data-role="option-label"'), '小题行应合并成带号码格的选项表')
})

await check('英语：书面表达的长下划线标成横线区；选项表标 options；带框表格标 bordered', () => {
  const qs = runs.english.page.questions
  assert.ok(qs[18].stemHtml.includes('<div data-role="writing-lines">___'))
  assert.ok(qs[1].stemHtml.includes('<table data-role="options">'))
  assert.ok(qs[12].stemHtml.includes('<table data-role="bordered">'))
})

await check('数学物理：公式图保留、数据表标 bordered、着重号标 dot、右对齐不丢', () => {
  assert.ok(runs.math.page.questions[0].stemHtml.includes('<img src="ewb-pending:0">'))
  assert.ok(runs.math.page.questions[7].stemHtml.includes('<table data-role="bordered">'))
  assert.ok(runs.physics.page.questions[15].stemHtml.includes('<em data-role="dot">合理</em>'))
})

await check('单题页：只取主题目，不带相似题推荐；题干与试卷页一致；识别原始出处卷', () => {
  const { page } = runs.question
  assert.equal(page.kind, 'question')
  assert.equal(page.questions.length, 1)
  const q = page.questions[0]
  assert.equal(q.qid, '17150767')
  assert.equal(q.questionType, '单选题')
  assert.ok(q.sourceLabel)
  assert.equal(q.numberCount, 1)
  const paperQ = runs.math.page.questions.find((x) => x.qid === '17150767')!
  assert.equal(q.stemText, paperQ.stemText)
  assert.equal(q.stemHtml.replace(/ewb-pending:\d+/g, 'P'), paperQ.stemHtml.replace(/ewb-pending:\d+/g, 'P'))
  assert.equal(q.answerHtml, null)
  assert.equal(new URL(page.origin!.url).pathname, '/2p3543573.html')
  assert.ok(page.origin!.title.includes('七年级第一学期10月学情自测数学试题'))
  assert.equal(runs.question.domBefore, runs.question.domAfter)
})

await check('构造页面：清洗杂项、隐藏内容、懒加载图片、答案图片、行首列表不误判', () => {
  const { page } = runs.answers
  assert.equal(page.questions.length, 2)
  const q1 = page.questions[0]
  assert.equal(q1.stemHtml, '<p>计算 <img src="ewb-pending:0"> 的值链接文字</p><p data-role="right-aligned">右对齐段落</p>')
  assert.equal(page.images[0], 'https://staticzujuan.xkw.com/quesimg/Upload/formula/a.png') // 取 data-src，不取占位的 data: 图
  assert.equal(q1.answerHtml, '<p><img src="ewb-pending:1"></p><p>【答案】C</p>')
  assert.equal(page.images[1], 'https://staticzujuan.xkw.com/quesimg/Upload/answer/b.png')
  assert.equal(page.questions[1].answerHtml, null, '空白答案区不算答案')
  assert.equal(page.questions[1].stemHtml, '<p>小明有 3. 5 元；</p><p>(1) 第一问</p><p>(2) 第二问</p>')
  assert.equal(page.questions[1].numberCount, 1)
  const list = runs.listInStem.page
  assert.deepEqual(list.questions.map((q) => q.numberCount), [1, 1])
  assert.ok(list.questions[0].stemHtml.includes('1. 苹果'), '题干里的列表序号应原样保留')
  assert.ok(!list.questions[0].stemHtml.startsWith('<p>5.'))
})

await check('答案区不认页面自带的内部标记，也不生成占位符（试卷页与单题页）', () => {
  const a = runs.evilAnswer.page.questions[0]
  assert.equal(a.stemHtml, '<p>题干 <b>粗</b></p>')
  assert.equal(a.answerHtml, '<p>答案甲</p><table><tbody><tr><td>丙</td></tr></tbody></table>')
  const q = runs.evilQuestion.page.questions[0]
  assert.equal(q.stemHtml, '<p>下列正确的是x</p>')
  assert.equal(q.answerHtml, '<p>答案图</p><p><img src="ewb-pending:0">戊</p>')
  // 所有样本与构造页面：答案里没有任何内部标记，题干里的占位符只在多小题块里
  for (const [name, run] of Object.entries(runs)) {
    for (const item of run.page.questions) {
      assert.ok(!item.answerHtml || !/data-ewb|data-role="option-label"/.test(item.answerHtml), `${name} 答案含内部标记`)
      const placeholders = [...item.stemHtml.matchAll(/data-ewb-qno="([^"]*)"/g)].map((m) => m[1])
      assert.ok(placeholders.every((k) => /^\d{1,3}$/.test(k) && Number(k) < item.numberCount), `${name} 占位符取值异常`)
      if (item.numberCount === 1) assert.equal(placeholders.length, 0, `${name} 单题不该有占位符`)
    }
  }
})

await check('构造页面：伪造的内部标记与待保存引用不起作用；非数字题目编号按无编号处理；说明文字后的单道小题去掉行首题号', () => {
  const q = runs.hostile.page.questions[0]
  assert.equal(q.qid, null)
  assert.equal(q.stemHtml, '<p>文字 ewb-pending:99 乙丙<img src="ewb-pending:0"><img src="ewb-pending:1"> 结束</p>')
  assert.deepEqual(runs.hostile.page.images, ['javascript:alert(1)', 'https://evil.example.com/x.png'])
  assert.ok(!q.stemHtml.includes('data-ewb') && !q.stemHtml.includes('data-role'))
  assert.equal(runs.hostile.page.declaredCount, null)
  const lone = runs.loneNumber.page.questions
  assert.deepEqual(lone.map((x) => x.numberCount), [1, 1])
  assert.equal(lone[0].stemHtml, '<p>阅读材料。</p><p>问题一？</p>')
})

await check('验证页与非题目页：kind 为 none，验证页标出 verification', () => {
  assert.equal(runs.verification.page.kind, 'none')
  assert.equal(runs.verification.page.verification, true)
  assert.equal(runs.plain.page.kind, 'none')
  assert.equal(runs.plain.page.verification, false)
  assert.equal(runs.math.page.verification, false)
})

console.log('链接规则')
await check('组卷网链接分类、规范化与粘贴拆分', () => {
  assert.equal(classifyZujuanUrl('https://zujuan.xkw.com/2p3543573.html'), 'paper')
  assert.equal(classifyZujuanUrl('https://zujuan.xkw.com/2q17150767.html?from=x#top'), 'question')
  assert.equal(classifyZujuanUrl('https://zujuan.xkw.com/zhineng-view'), 'smart')
  assert.equal(classifyZujuanUrl('https://zujuan.xkw.com/czsx/zsd4740'), null)
  assert.equal(classifyZujuanUrl('https://evil.example.com/2p3543573.html'), null)
  assert.equal(classifyZujuanUrl('https://zujuan.xkw.com.evil.com/2p3543573.html'), null)
  assert.equal(classifyZujuanUrl('javascript:alert(1)'), null)
  assert.equal(classifyZujuanUrl('not a url'), null)
  assert.equal(normalizeImportUrl(' http://zujuan.xkw.com/2p3543573.html?x=1#a '), 'https://zujuan.xkw.com/2p3543573.html')
  assert.equal(normalizeImportUrl('https://zujuan.xkw.com/zhineng-view'), null)
  assert.deepEqual(splitPastedLinks('a\n\n b  a\r\nc'), ['a', 'b', 'c'])
  assert.equal(primaryQuestionType('解答题-计算题'), '解答题')
  assert.equal(primaryQuestionType('单选题'), '单选题')
})

console.log('图片下载')
await check('按文件头判断格式；非图片、超大、非组卷网域名一律拒绝', async () => {
  assert.equal(sniffImageExt(fakePng('a')), 'png')
  assert.equal(sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg')
  assert.equal(sniffImageExt(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg')
  assert.equal(sniffImageExt(Buffer.from('<html><body>验证码</body></html>')), null)
  const ok = makeFetcher()
  assert.equal((await downloadImage('https://staticzujuan.xkw.com/a.png', ok.fetcher))?.ext, 'png')
  assert.equal(await downloadImage('https://evil.example.com/a.png', ok.fetcher), null)
  assert.equal(await downloadImage('https://xkw.com.evil.com/a.png', ok.fetcher), null)
  assert.equal(await downloadImage('http://127.0.0.1:8765/a.png', ok.fetcher), null)
  assert.equal(ok.calls.length, 1, '不该请求非组卷网域名')
  const html: ImageFetcher = async () => ({ status: 200, contentType: 'image/png', bytes: Buffer.from('<html>验证页</html>') })
  assert.equal(await downloadImage('https://img.xkw.com/a.png', html), null)
  const big: ImageFetcher = async () => ({ status: 200, contentType: 'image/png', bytes: Buffer.concat([PNG_HEAD, Buffer.alloc(MAX_IMAGE_BYTES)]) })
  assert.equal(await downloadImage('https://img.xkw.com/a.png', big), null)
  let tries = 0
  const flaky: ImageFetcher = async () => {
    if (tries++ === 0) throw new Error('reset')
    return { status: 200, contentType: 'image/png', bytes: fakePng('x') }
  }
  assert.equal((await downloadImage('https://img.xkw.com/a.png', flaky))?.ext, 'png')
  const data = 'data:image/png;base64,' + fakePng('d').toString('base64')
  assert.equal((await downloadImage(data, ok.fetcher))?.ext, 'png')
})

console.log('入库：预览、去重、提交')
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-import-data-'))
mkdirSync(join(dataDir, 'assets'), { recursive: true })
const db = openDatabase(dataDir)
try {
  // 先入库单题页，再入库整张试卷：单题页的那道题在试卷里应被识别为已在库
  const seen = new SeenQuestions()
  const net = makeFetcher()
  const questionPage = await preparePage(runs.question.page, QUESTION_URL, { db, fetchImage: net.fetcher, seen, pageIndex: 0 })
  await check('单题页：来源卷取原始出处，预览显示题型与来源，图片已下载', () => {
    assert.equal(questionPage.sourceUrl, PAPER_URL)
    assert.ok(questionPage.sourceTitle.includes('数学试题'))
    assert.equal(questionPage.questions.length, 1)
    const preview = toPreview(questionPage, questionPage.sourceTitle)
    assert.equal(preview.questions[0].duplicate, false)
    assert.equal(preview.questions[0].questionType, '单选题')
    assert.equal(preview.imageTotal, 2)
    assert.equal(preview.imageFailed, 0)
    assert.ok(preview.questions[0].previewText.startsWith('下列说法正确的是'))
  })
  const r1 = commitPages(db, dataDir, [questionPage])
  await check('提交单题：新增 1 道，来源卷记录生成', () => {
    assert.deepEqual(r1, { added: 1, skipped: 0 })
    const papers = listSourcePapers(db)
    assert.equal(papers.length, 1)
    assert.equal(papers[0].url, PAPER_URL)
    assert.equal(papers[0].questionCount, 1)
    const q = listQuestions(db, {}).items[0]
    assert.ok(q.stemHtml.includes('ewb-asset://') && !q.stemHtml.includes('ewb-pending'))
    assert.equal(q.sourcePaperTitle, questionPage.sourceTitle)
    assert.equal(q.zujuanQid, '17150767')
  })

  const seen2 = new SeenQuestions()
  const failedUrl = runs.math.page.images[3]
  const failing = makeFetcher((url) => url === failedUrl)
  const mathPage = await preparePage(runs.math.page, PAPER_URL, { db, fetchImage: failing.fetcher, seen: seen2, pageIndex: 0 })
  const preview = toPreview(mathPage, runs.math.page.title)
  await check('整张试卷：22 道新题、1 道已在库；已在库的题不下载图片；失败图片计入预览', () => {
    assert.equal(mathPage.questions.length, 23)
    assert.equal(mathPage.questions.filter((q) => q.duplicate).length, 1)
    assert.equal(mathPage.questions.find((q) => q.qid === '17150767')!.duplicate, true)
    assert.ok(!failing.calls.includes(runs.question.page.images[0]), '已在库的题不该再下载图片')
    assert.equal(preview.questions.filter((q) => q.duplicate).length, 1)
    assert.equal(preview.imageFailed, 1)
    assert.equal(preview.questions.reduce((sum, q) => sum + q.failedImages, 0) >= 1, true)
    assert.equal(preview.questions.filter((q) => q.hasAnswer).length, 0)
  })
  const r2 = commitPages(db, dataDir, [mathPage])
  await check('提交试卷：新增 22、跳过 1；内容里没有待保存引用，图片文件都在；失败的图片被去掉', () => {
    assert.deepEqual(r2, { added: 22, skipped: 1 })
    const all = listQuestions(db, {}).items
    assert.equal(all.length, 23)
    assert.equal(listSourcePapers(db).length, 1, '单题页的出处卷与整卷是同一条来源卷记录')
    for (const q of all) {
      assert.ok(!q.stemHtml.includes('ewb-pending'))
      for (const m of q.stemHtml.matchAll(/src="([^"]+)"/g)) {
        const name = assetNameFromUrl(m[1])
        assert.ok(name, `图片地址不是本地协议：${m[1]}`)
        assert.ok(existsSync(join(dataDir, 'assets', name!)), `图片文件缺失：${name}`)
      }
      assert.deepEqual(whitelistViolations(q.stemHtml), [])
    }
    const assets = db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n: number }
    assert.ok(assets.n > 50)
    const stored = db.prepare('SELECT source_order FROM questions WHERE source_paper_id = 1 ORDER BY source_order').all() as { source_order: number }[]
    assert.equal(new Set(stored.map((r) => r.source_order)).size, 23)
  })

  const seen3 = new SeenQuestions()
  const again = await preparePage(runs.math.page, PAPER_URL, { db, fetchImage: makeFetcher().fetcher, seen: seen3, pageIndex: 0 })
  await check('同一链接再入一次：全部已在库，提交为 0 新增 23 跳过，库里题数不变', () => {
    assert.ok(again.questions.every((q) => q.duplicate))
    assert.ok(toPreview(again, 't').questions.every((q) => q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [again]), { added: 0, skipped: 23 })
    assert.equal(listQuestions(db, {}).total, 23)
  })

  await check('同一次任务里重复出现的题算重复；预览之后库里又多了同一道题，提交时仍会跳过', async () => {
    const seenJob = new SeenQuestions()
    const fetchOk = makeFetcher().fetcher
    const pageA = await preparePage(runs.physics.page, 'https://zujuan.xkw.com/3p1.html', { db, fetchImage: fetchOk, seen: seenJob, pageIndex: 0 })
    const pageB = await preparePage(runs.physics.page, 'https://zujuan.xkw.com/3p2.html', { db, fetchImage: fetchOk, seen: seenJob, pageIndex: 1 })
    assert.equal(pageA.questions.filter((q) => q.duplicate).length, 0)
    assert.ok(pageB.questions.every((q) => q.duplicate), '第二页的题在本次任务里已出现过')
    assert.deepEqual(commitPages(db, dataDir, [pageA]), { added: 26, skipped: 0 })
    // pageC 在 pageA 提交之前做的预览：全部显示为新题，提交时被核对出重复
    const emptyDir = mkdtempSync(join(tmpdir(), 'ewb-empty-'))
    const emptyDb = openDatabase(emptyDir)
    const stale = await preparePage(runs.physics.page, 'https://zujuan.xkw.com/3p3.html', { db: emptyDb, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    emptyDb.close()
    rmSync(emptyDir, { recursive: true, force: true })
    assert.ok(stale.questions.every((q) => !q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [stale]), { added: 0, skipped: 26 })
  })

  await check('没有题目编号时按内容指纹去重（题干文字加图片哈希）', async () => {
    const noQid: ExtractedPage = structuredClone(runs.english.page)
    noQid.questions = noQid.questions.slice(0, 3).map((q) => ({ ...q, qid: null }))
    const fetchOk = makeFetcher().fetcher
    const first = await preparePage(noQid, 'https://zujuan.xkw.com/3p9.html', { db, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    assert.ok(first.questions.every((q) => !q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [first]), { added: 3, skipped: 0 })
    const second = await preparePage(noQid, 'https://zujuan.xkw.com/3p9.html', { db, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    assert.ok(second.questions.every((q) => q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [second]), { added: 0, skipped: 3 })
    // 同题带编号再入：与「无编号入库的同内容题」算重复
    const withQid = structuredClone(runs.english.page)
    withQid.questions = withQid.questions.slice(0, 3)
    const third = await preparePage(withQid, 'https://zujuan.xkw.com/3p9.html', { db, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    assert.ok(third.questions.every((q) => q.duplicate))
  })

  await check('危险图片地址与伪造引用：不下载、不崩溃，提交时图片被去掉', async () => {
    const calls = makeFetcher()
    const page = await preparePage(runs.hostile.page, 'https://zujuan.xkw.com/5p1.html', { db, fetchImage: calls.fetcher, seen: new SeenQuestions(), pageIndex: 0 })
    assert.equal(calls.calls.length, 0, '非组卷网域名与 javascript: 地址都不该请求')
    const preview = toPreview(page, 't')
    assert.equal(preview.imageFailed, 2)
    assert.equal(preview.questions[0].failedImages, 2)
    assert.deepEqual(commitPages(db, dataDir, [page]), { added: 1, skipped: 0 })
    const stored = listQuestions(db, { keyword: 'ewb-pending:99' }).items[0]
    assert.equal(stored.stemHtml, '<p>文字 ewb-pending:99 乙丙 结束</p>')
  })

  await check('智能组卷预览页（共用网址）用题目编号哈希区分来源卷', async () => {
    const smart = structuredClone(runs.english.page)
    smart.url = 'https://zujuan.xkw.com/zhineng-view'
    smart.questions = smart.questions.slice(10, 13)
    const other = structuredClone(smart)
    other.questions = other.questions.slice(0, 2)
    const a = await preparePage(smart, smart.url, { db, fetchImage: makeFetcher().fetcher, seen: new SeenQuestions(), pageIndex: 0 })
    const b = await preparePage(other, other.url, { db, fetchImage: makeFetcher().fetcher, seen: new SeenQuestions(), pageIndex: 0 })
    assert.match(a.sourceUrl!, /^https:\/\/zujuan\.xkw\.com\/zhineng-view#sp-[0-9a-f]{12}$/)
    assert.notEqual(a.sourceUrl, b.sourceUrl)
  })

  await check('试题库查询：题型大类含子类、来源卷、关键词只匹配文字、分页', () => {
    const types = listQuestionTypes(db)
    assert.ok(types.includes('解答题-计算题') && types.includes('单选题'))
    const solve = listQuestions(db, { questionType: '解答题' })
    assert.equal(solve.total, 8)
    assert.ok(solve.items.every((q) => primaryQuestionType(q.questionType) === '解答题'))
    assert.equal(listQuestions(db, { questionType: '解答题-计算题' }).total, 2)
    assert.equal(listQuestions(db, { questionType: '解答' }).total, 0, '前缀必须到「-」为止')
    const paperId = listSourcePapers(db).find((p) => p.url === PAPER_URL)!.id
    assert.equal(listQuestions(db, { sourcePaperId: paperId }).total, 23)
    assert.equal(listQuestions(db, { keyword: '倒数' }).total > 0, true)
    assert.equal(listQuestions(db, { keyword: 'span' }).total, 0, '关键词不能命中标签名')
    assert.equal(listQuestions(db, { keyword: 'ewb-asset' }).total, 0, '关键词不能命中图片文件名')
    assert.equal(listQuestions(db, { keyword: 'data-role' }).total, 0)
    const page1 = listQuestions(db, { limit: 10, offset: 0 })
    const page2 = listQuestions(db, { limit: 10, offset: 10 })
    assert.equal(page1.items.length, 10)
    assert.equal(new Set([...page1.items, ...page2.items].map((q) => q.id)).size, 20)
    const kw = listQuestions(db, { keyword: 'Cindy' })
    assert.equal(kw.total, 1)
    assert.ok(kw.items[0].stemHtml.includes('Cindy'))
  })

  await check('删除题目：来源卷下没有题时一并清理；原题只读仍然成立', () => {
    assert.throws(() => db.prepare("UPDATE questions SET stem_html = 'x' WHERE id = 1").run(), /只读/)
    const before = listSourcePapers(db).length
    const lone = listQuestions(db, { keyword: 'Cindy' }).items[0]
    const siblings = listQuestions(db, { sourcePaperId: lone.sourcePaperId! }).total
    for (const q of listQuestions(db, { sourcePaperId: lone.sourcePaperId! }).items) deleteQuestion(db, q.id)
    assert.ok(siblings > 0)
    assert.equal(listSourcePapers(db).length, before - 1)
    assert.equal(listQuestions(db, { sourcePaperId: lone.sourcePaperId! }).total, 0)
  })
} finally {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(synthDir, { recursive: true, force: true })
}

console.log(`入库测试通过：${passed} 项，证据在 ${evidence}`)
