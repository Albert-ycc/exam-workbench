// 入库测试：node scripts/test-import.ts [证据目录]
// 拆题部分用真实 Electron 页面环境（DOM、隔离世界）跑三份真实样本与几份构造页面；
// 去重、图片下载、入库提交、试题库查询用临时数据库与假的下载函数。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { assetNameFromUrl } from '../src/main/assets.ts'
import { openDatabase } from '../src/main/db.ts'
import { saveQuestionMeta } from '../src/main/library/classify.ts'
import { commitPages } from '../src/main/library/commit.ts'
import { SeenQuestions } from '../src/main/library/dedupe.ts'
import { extractScript, type ExtractedPage } from '../src/main/library/extract-script.ts'
import { MAX_IMAGE_BYTES, downloadImage, sniffImageExt, type ImageFetcher } from '../src/main/library/images.ts'
import { preparePage, toPreview } from '../src/main/library/prepare.ts'
import { deleteQuestion, listQuestionTypes, listQuestions, listSourcePapers } from '../src/main/library/queries.ts'
import { DIFFICULTY_TIERS, difficultyTier } from '../src/shared/classify.ts'
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
  // 知识点与难度的畸形写法：重复编号、缺 cid 靠链接补、坏编号、系数越界、没有任何信息的题都不能让整题失败
  metaOdd: `<!doctype html><html><body><article class="exam-cnt"><section class="exam-list">
<h4 class="sec-title"><span>一、单选题</span></h4>
<div class="tk-quest-item" questionid="900051"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">单选题</span></span><b class="gap">|</b><span class="addi-info"><span class="info-cnt">较难（0.30）</span></span><a class="ques-src">来源庚</a></div>
<div class="exam-item__cnt">1. 第一题</div>
<div hidden class="exam-item__opt"><div class="item knowlegde"><p class="knowledge-box">
<a class="knowledge-name" href="/czsx/zsd12" cid="12" cname="  甲　乙 ">甲乙</a>
<a class="knowledge-name" href="/czsx/zsd12" cid="12" cname="重复编号">重复编号</a>
<a class="knowledge-name" href="/czyy/zsd77">后备名称</a>
<a class="knowledge-name" href="javascript:void 0" cid="x1" cname="坏编号">坏编号</a>
<a class="knowledge-name" href="/czsx/zsd-5" cid="-5" cname="负编号">负编号</a>
<a class="knowledge-name" href="/czsx/zsd90" cid="90" cname="">   </a>
<a class="knowledge-explain" href="javascript:void 0" cid="13" cname="解读不算">解读</a></p></div><div class="item answer"></div></div></div>
<div class="tk-quest-item" questionid="900052"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">单选题</span></span><b class="gap">|</b><span class="addi-info"><span class="info-cnt">适中 (1.5)</span></span><a class="ques-src">来源庚</a></div>
<div class="exam-item__cnt">2. 第二题</div>
<div hidden class="exam-item__opt"><div class="item answer"></div></div>
<div class="exam-item__info"><a class="addques" qdname="适中" qdvalue="0.55">加入试题篮</a></div></div>
<div class="tk-quest-item" questionid="900053"><div class="ques-additional"><span class="addi-info"><span class="info-cnt">单选题</span></span><a class="ques-src">来源庚</a></div>
<div class="exam-item__cnt">3. 第三题</div>
<div hidden class="exam-item__opt"><div class="item answer"></div></div></div>
</section></article></body></html>`,
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

// 从数学卷样本派生：去掉知识点区块 / 同时去掉难度。先确认去掉的确实是 23 题的全部，再拿来测「读不到」
const mathHtml = readFileSync(FILES.math, 'utf8')
const countOf = (html: string, re: RegExp): number => (html.match(re) ?? []).length
const KNOWLEDGE_BLOCK = /<div class="item knowlegde">[\s\S]*?<\/div>/g
const DIFFICULTY_CELL = /<b class="gap">\|<\/b>\s*<span class="addi-info">\s*<span class="info-cnt">\s*[^<(（]*[（(]\s*[\d.]+\s*[)）]\s*<\/span>\s*<\/span>/g
const DIFFICULTY_ATTRS = /\sqd(?:id|name|value)="[^"]*"/g
const noKnowledgeHtml = mathHtml.replace(KNOWLEDGE_BLOCK, '')
const noDifficultyHtml = mathHtml.replace(DIFFICULTY_CELL, '').replace(DIFFICULTY_ATTRS, '')
const bareHtml = noKnowledgeHtml.replace(DIFFICULTY_CELL, '').replace(DIFFICULTY_ATTRS, '')
assert.ok(countOf(mathHtml, /knowledge-name/g) >= 23, '样本里应有知识点')
assert.equal(countOf(mathHtml, /class="item knowlegde"/g), 23)
assert.equal(countOf(noKnowledgeHtml, /knowledge-name/g), 0)
assert.equal(countOf(noDifficultyHtml, /class="item knowlegde"/g), 23, '只去难度时知识点区块都在')
assert.equal(countOf(noDifficultyHtml, /(?:容易|适中|困难)\s*[（(]\s*\d/g), 0)
assert.equal(countOf(mathHtml, DIFFICULTY_CELL), 23)
assert.equal(countOf(bareHtml, /(?:容易|适中|困难)\s*[（(]\s*\d/g), 0)
assert.equal(countOf(bareHtml, /qd(?:id|name|value)=/g), 0)
FILES.mathNoKnowledge = join(synthDir, 'mathNoKnowledge.html')
FILES.mathNoDifficulty = join(synthDir, 'mathNoDifficulty.html')
FILES.mathBare = join(synthDir, 'mathBare.html')
writeFileSync(FILES.mathNoKnowledge, noKnowledgeHtml, 'utf8')
writeFileSync(FILES.mathNoDifficulty, noDifficultyHtml, 'utf8')
writeFileSync(FILES.mathBare, bareHtml, 'utf8')

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

console.log('知识点与难度（拆题）')
const SUBJECT_OF: Record<string, string> = { math: 'czsx', english: 'czyy', physics: 'czwl' }
const sampleQuestions = ['math', 'english', 'physics'].flatMap((name) => runs[name].page.questions.map((q) => ({ name, q })))

await check('三份试卷页 69 题：逐题都读到 1–6 个知识点与难度系数，学科代码与卷一致，编号不重复', () => {
  assert.equal(sampleQuestions.length, 69)
  for (const { name, q } of sampleQuestions) {
    const where = `${name} 第 ${q.order + 1} 题`
    assert.ok(q.knowledge.length >= 1 && q.knowledge.length <= 6, `${where} 知识点 ${q.knowledge.length} 个`)
    assert.equal(new Set(q.knowledge.map((k) => k.id)).size, q.knowledge.length, `${where} 知识点编号重复`)
    for (const k of q.knowledge) {
      assert.ok(Number.isSafeInteger(k.id) && k.id > 0 && k.name.length > 0, `${where} 知识点异常：${JSON.stringify(k)}`)
      assert.equal(k.subject, SUBJECT_OF[name], `${where} 学科代码`)
    }
    assert.ok(q.difficulty !== null && q.difficulty >= 0 && q.difficulty <= 1, `${where} 难度系数 ${q.difficulty}`)
    assert.ok(q.difficultyLabel, `${where} 没读到档位文字`)
  }
  assert.ok(runs.question.page.questions.every((q) => q.difficultyLabel === ''), '单题页只有系数，没有档位文字')
})

await check('数学第 1 题与单题页主题：知识点编号、名称、顺序、学科、难度系数一致', () => {
  const expected = [
    { id: 4740, name: '倒数', subject: 'czsx' },
    { id: 4748, name: '两个有理数的乘法运算', subject: 'czsx' },
    { id: 4717, name: '绝对值的几何意义', subject: 'czsx' },
    { id: 4731, name: '有理数加法运算', subject: 'czsx' }
  ]
  const paperQ = runs.math.page.questions[0]
  const pageQ = runs.question.page.questions[0]
  assert.equal(paperQ.qid, '17150767')
  assert.deepEqual(paperQ.knowledge, expected)
  assert.deepEqual(pageQ.knowledge, expected, '单题页只取答案区的知识点，不带相似题推荐里的')
  assert.equal(paperQ.difficulty, 0.65)
  assert.equal(pageQ.difficulty, 0.65)
  assert.equal(paperQ.difficultyLabel, '适中')
})

await check('单题页答案里不混知识点（知识点区块仍从答案里剔除）', () => {
  const q = runs.question.page.questions[0]
  assert.equal(q.answerHtml, null)
  const evil = runs.evilQuestion.page.questions[0]
  assert.equal(evil.answerHtml, '<p>答案图</p><p><img src="ewb-pending:0">戊</p>')
  assert.deepEqual(evil.knowledge, [])
})

// 档位表与组卷网页面一致的守卫：试卷页上每一对（档位文字，系数）都要落在 difficultyTier 给出的同名档位里
const tierPairs = sampleQuestions.map(({ name, q }) => ({ where: `${name} 第 ${q.order + 1} 题`, label: q.difficultyLabel, coefficient: q.difficulty as number }))
function tierViolations(): string[] {
  return tierPairs.filter((p) => difficultyTier(p.coefficient)?.label !== p.label).map((p) => `${p.where}：页面「${p.label}」(${p.coefficient})，档位表给「${difficultyTier(p.coefficient)?.label}」`)
}
await check('档位不变量：试卷页每一对（档位文字，系数）都满足 difficultyTier(系数).label === 档位文字', () => {
  assert.equal(tierPairs.length, 69)
  assert.deepEqual(tierViolations(), [])
  // 样本里各档的系数范围（档位表依据）：容易 0.81–0.95、适中 0.57–0.79、困难 0.40
  const range = (label: string): [number, number] => {
    const values = tierPairs.filter((p) => p.label === label).map((p) => p.coefficient)
    return [Math.min(...values), Math.max(...values)]
  }
  assert.deepEqual(new Set(tierPairs.map((p) => p.label)), new Set(['容易', '适中', '困难']))
  assert.deepEqual(range('容易'), [0.81, 0.95])
  assert.deepEqual(range('适中'), [0.57, 0.79])
  assert.deepEqual(range('困难'), [0.4, 0.4])
  writeFileSync(join(evidence, 'difficulty-pairs.json'), JSON.stringify(Object.fromEntries(['容易', '适中', '困难'].map((l) => [l, { range: range(l), count: tierPairs.filter((p) => p.label === l).length }])), null, 1))
})

await check('档位不变量的守卫有效（反向验证）：临时改坏档位表，不变量变红，改回后恢复', () => {
  const saved = DIFFICULTY_TIERS.map((t) => ({ min: t.min, max: t.max, label: t.label }))
  const damage: [string, (t: (typeof DIFFICULTY_TIERS)[number][]) => void][] = [
    ['适中下界抬到 0.6（0.57 的题落进困难）', (t) => void (t[1].min = 0.6, t[2].max = 0.6)],
    ['容易下界抬到 0.9（0.81–0.89 的题落进适中）', (t) => void (t[0].min = 0.9, t[1].max = 0.9)],
    ['困难上界压到 0.3（0.40 的题落进适中）', (t) => void (t[2].max = 0.3, t[1].min = 0.3)],
    ['档位名写错', (t) => void (t[1].label = '中等')]
  ]
  const tiers = DIFFICULTY_TIERS as unknown as (typeof DIFFICULTY_TIERS)[number][]
  try {
    for (const [what, apply] of damage) {
      apply(tiers)
      assert.ok(tierViolations().length > 0, `改坏档位表（${what}）后不变量没有变红`)
      tiers.forEach((t, i) => Object.assign(t, saved[i]))
    }
  } finally {
    tiers.forEach((t, i) => Object.assign(t, saved[i]))
  }
  assert.deepEqual(tierViolations(), [], '档位表应已还原')
})

await check('读不到时为空、不让整题失败：去掉知识点 / 去掉难度 / 两样都去掉的页面', () => {
  const noK = runs.mathNoKnowledge.page
  assert.equal(noK.questions.length, 23)
  assert.ok(noK.questions.every((q) => q.knowledge.length === 0 && q.difficulty !== null && q.difficultyLabel !== ''))
  const noD = runs.mathNoDifficulty.page
  assert.equal(noD.questions.length, 23)
  assert.ok(noD.questions.every((q) => q.knowledge.length > 0 && q.difficulty === null && q.difficultyLabel === ''), '只去掉难度：知识点照读，难度为空')
  assert.deepEqual(noD.questions.map((q) => q.knowledge), runs.math.page.questions.map((q) => q.knowledge))
  const bare = runs.mathBare.page
  assert.equal(bare.questions.length, 23)
  assert.ok(bare.questions.every((q) => q.knowledge.length === 0 && q.difficulty === null && q.difficultyLabel === ''))
  assert.deepEqual(bare.questions.map((q) => q.stemText), runs.math.page.questions.map((q) => q.stemText), '去掉知识点与难度不影响题干')
  assert.equal(bare.declaredCount, 23)
})

await check('畸形写法：重复编号只留第一个、缺 cid 靠链接补、坏编号与空名称跳过、解读链接不算；全角括号与系数越界', () => {
  const [a, b, c] = runs.metaOdd.page.questions
  assert.deepEqual(a.knowledge, [
    { id: 12, name: '甲 乙', subject: 'czsx' },
    { id: 77, name: '后备名称', subject: 'czyy' }
  ])
  assert.equal(a.difficulty, 0.3)
  assert.equal(a.difficultyLabel, '较难')
  assert.deepEqual(b.knowledge, [])
  assert.equal(b.difficulty, 0.55, '页面文字的系数越界时退到加入试题篮按钮上的属性')
  assert.equal(b.difficultyLabel, '适中')
  assert.deepEqual([c.knowledge, c.difficulty, c.difficultyLabel], [[], null, ''])
  assert.equal(runs.metaOdd.page.questions.length, 3)
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
    assert.deepEqual(r1, { added: 1, skipped: 0, filled: 0 })
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
    assert.deepEqual(r2, { added: 22, skipped: 1, filled: 0 })
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
    assert.deepEqual(commitPages(db, dataDir, [again]), { added: 0, skipped: 23, filled: 0 })
    assert.equal(listQuestions(db, {}).total, 23)
  })

  await check('同一次任务里重复出现的题算重复；预览之后库里又多了同一道题，提交时仍会跳过', async () => {
    const seenJob = new SeenQuestions()
    const fetchOk = makeFetcher().fetcher
    const pageA = await preparePage(runs.physics.page, 'https://zujuan.xkw.com/3p1.html', { db, fetchImage: fetchOk, seen: seenJob, pageIndex: 0 })
    const pageB = await preparePage(runs.physics.page, 'https://zujuan.xkw.com/3p2.html', { db, fetchImage: fetchOk, seen: seenJob, pageIndex: 1 })
    assert.equal(pageA.questions.filter((q) => q.duplicate).length, 0)
    assert.ok(pageB.questions.every((q) => q.duplicate), '第二页的题在本次任务里已出现过')
    assert.deepEqual(commitPages(db, dataDir, [pageA]), { added: 26, skipped: 0, filled: 0 })
    // pageC 在 pageA 提交之前做的预览：全部显示为新题，提交时被核对出重复
    const emptyDir = mkdtempSync(join(tmpdir(), 'ewb-empty-'))
    const emptyDb = openDatabase(emptyDir)
    const stale = await preparePage(runs.physics.page, 'https://zujuan.xkw.com/3p3.html', { db: emptyDb, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    emptyDb.close()
    rmSync(emptyDir, { recursive: true, force: true })
    assert.ok(stale.questions.every((q) => !q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [stale]), { added: 0, skipped: 26, filled: 0 })
  })

  await check('没有题目编号时按内容指纹去重（题干文字加图片哈希）', async () => {
    const noQid: ExtractedPage = structuredClone(runs.english.page)
    noQid.questions = noQid.questions.slice(0, 3).map((q) => ({ ...q, qid: null }))
    const fetchOk = makeFetcher().fetcher
    const first = await preparePage(noQid, 'https://zujuan.xkw.com/3p9.html', { db, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    assert.ok(first.questions.every((q) => !q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [first]), { added: 3, skipped: 0, filled: 0 })
    const second = await preparePage(noQid, 'https://zujuan.xkw.com/3p9.html', { db, fetchImage: fetchOk, seen: new SeenQuestions(), pageIndex: 0 })
    assert.ok(second.questions.every((q) => q.duplicate))
    assert.deepEqual(commitPages(db, dataDir, [second]), { added: 0, skipped: 3, filled: 0 })
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
    assert.deepEqual(commitPages(db, dataDir, [page]), { added: 1, skipped: 0, filled: 0 })
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

  // ---------- 知识点与难度入库、补齐（每个用例各用一个全新的库） ----------
  type Db = ReturnType<typeof openDatabase>
  async function withFreshDb(fn: (fresh: Db, freshDir: string) => Promise<void>): Promise<void> {
    const freshDir = mkdtempSync(join(tmpdir(), 'ewb-import-meta-'))
    mkdirSync(join(freshDir, 'assets'), { recursive: true })
    const fresh = openDatabase(freshDir)
    try {
      await fn(fresh, freshDir)
    } finally {
      fresh.close()
      rmSync(freshDir, { recursive: true, force: true })
    }
  }
  const prep = (fresh: Db, page: ExtractedPage, seenJob = new SeenQuestions(), pageIndex = 0) =>
    preparePage(page, PAPER_URL, { db: fresh, fetchImage: makeFetcher().fetcher, seen: seenJob, pageIndex })
  const libraryOf = (fresh: Db): Map<string, { id: number; knowledge: unknown; difficulty: number | null }> =>
    new Map(listQuestions(fresh, {}).items.map((q) => [q.zujuanQid ?? `#${q.id}`, { id: q.id, knowledge: q.knowledge, difficulty: q.difficulty }]))
  const pageMeta = (q: ExtractedPage['questions'][number]): { knowledge: unknown; difficulty: number | null } => ({ knowledge: q.knowledge, difficulty: q.difficulty })
  const fills = (preview: ReturnType<typeof toPreview>): number => preview.questions.filter((q) => q.fill).length

  await check('入库写知识点与难度：新题入库后逐题与页面一致（页面顺序），预览带知识点数与系数', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      const page = await prep(fresh, runs.math.page)
      const preview = toPreview(page, 't')
      assert.equal(preview.noKnowledge, 0)
      assert.deepEqual(preview.questions.map((q) => q.knowledgeCount), runs.math.page.questions.map((q) => q.knowledge.length))
      assert.deepEqual(preview.questions.map((q) => q.difficulty), runs.math.page.questions.map((q) => q.difficulty))
      assert.ok(preview.questions.every((q) => !q.fill && !q.duplicate))
      assert.deepEqual(commitPages(fresh, freshDir, [page]), { added: 23, skipped: 0, filled: 0 })
      const stored = libraryOf(fresh)
      assert.equal(stored.size, 23)
      for (const q of runs.math.page.questions) assert.deepEqual({ knowledge: stored.get(q.qid!)!.knowledge, difficulty: stored.get(q.qid!)!.difficulty }, pageMeta(q), `第 ${q.order + 1} 题`)
    })
  })

  await check('去掉知识点区块的页面：noKnowledge 等于题数，题照常入库（有难度的照存），库里没有知识点', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      const page = await prep(fresh, runs.mathNoKnowledge.page)
      const preview = toPreview(page, 't')
      assert.equal(preview.noKnowledge, 23)
      assert.equal(preview.noDifficulty, 0)
      assert.equal(preview.noKnowledge, preview.questions.length)
      assert.ok(preview.questions.every((q) => q.knowledgeCount === 0 && q.difficulty !== null))
      assert.deepEqual(commitPages(fresh, freshDir, [page]), { added: 23, skipped: 0, filled: 0 })
      const items = listQuestions(fresh, {}).items
      assert.equal(items.length, 23)
      assert.ok(items.every((q) => q.knowledge.length === 0 && q.difficulty !== null))
      assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM question_knowledge').get()!.n, 0)
    })
  })

  await check('noKnowledge 含已在库的题：本页没读到的算，读到的不算；页面读数异常（坏编号、空名称、越界系数）被规整掉', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      assert.deepEqual(commitPages(fresh, freshDir, [await prep(fresh, runs.english.page)]), { added: 20, skipped: 0, filled: 0 })
      const partial = structuredClone(runs.english.page)
      for (const i of [0, 5, 19]) partial.questions[i].knowledge = []
      for (const i of [1, 2]) partial.questions[i].difficulty = null
      const preview = toPreview(await prep(fresh, partial), 't')
      assert.ok(preview.questions.every((q) => q.duplicate))
      assert.equal(preview.noKnowledge, 3, '已在库的题也要计入')
      assert.equal(preview.noDifficulty, 2, '没取到难度的题同样计入，含已在库的')
      assert.equal(fills(preview), 0, '库里已有知识点与难度，不需要补')
      const hostile = structuredClone(runs.english.page)
      hostile.questions[0].knowledge = [
        { id: -1, name: '负编号', subject: 'czyy' },
        { id: 5, name: '   ', subject: 'czyy' },
        { id: 7, name: '有效', subject: '<script>' },
        { id: 7, name: '同编号', subject: 'czyy' },
        { id: 1.5, name: '小数编号', subject: 'czyy' }
      ]
      hostile.questions[0].difficulty = 7
      hostile.questions[1].difficulty = Number.NaN
      const prepared = await prep(fresh, hostile)
      assert.deepEqual(prepared.questions[0].knowledge, [{ id: 7, name: '有效', subject: '' }])
      assert.equal(prepared.questions[0].difficulty, null)
      assert.equal(prepared.questions[1].difficulty, null)
    })
  })

  await check('去掉难度的页面：noDifficulty 等于题数，题照常入库（知识点照存）；之后再入原页面只补难度，已有知识点不动', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      const page = await prep(fresh, runs.mathNoDifficulty.page)
      const preview = toPreview(page, 't')
      assert.equal(preview.noDifficulty, 23)
      assert.equal(preview.noDifficulty, preview.questions.length)
      assert.equal(preview.noKnowledge, 0)
      assert.ok(preview.questions.every((q) => q.difficulty === null && q.knowledgeCount > 0))
      assert.deepEqual(commitPages(fresh, freshDir, [page]), { added: 23, skipped: 0, filled: 0 })
      const first = libraryOf(fresh)
      assert.ok([...first.values()].every((q) => q.difficulty === null && (q.knowledge as unknown[]).length > 0))
      assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM question_difficulty').get()!.n, 0)

      const again = await prep(fresh, runs.math.page)
      const againPreview = toPreview(again, 't')
      assert.equal(againPreview.noDifficulty, 0)
      assert.equal(fills(againPreview), 23, '库里只缺难度也要补')
      assert.deepEqual(commitPages(fresh, freshDir, [again]), { added: 0, skipped: 23, filled: 23 })
      const after = libraryOf(fresh)
      for (const q of runs.math.page.questions) {
        assert.deepEqual(after.get(q.qid!)!.knowledge, first.get(q.qid!)!.knowledge, `第 ${q.order + 1} 题已有的知识点不动`)
        assert.equal(after.get(q.qid!)!.difficulty, q.difficulty)
      }
      // 反过来：库里只缺知识点，用只去掉知识点的页面补不了任何东西
      const stripped = await prep(fresh, runs.mathNoKnowledge.page)
      assert.equal(fills(toPreview(stripped, 't')), 0)
    })
  })

  await check('补齐：先入库去掉知识点与难度的页面，再入原页面——预览 fill 与提交 filled 正确，不新增题，已有的不被改', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      assert.deepEqual(commitPages(fresh, freshDir, [await prep(fresh, runs.mathBare.page)]), { added: 23, skipped: 0, filled: 0 })
      assert.ok([...libraryOf(fresh).values()].every((q) => (q.knowledge as unknown[]).length === 0 && q.difficulty === null))
      // 库里已有的三种情形：两样都有 / 只有知识点 / 只有难度（来自更早的入库），补齐不能改动它们
      const qids = runs.math.page.questions.map((q) => q.qid!)
      const before = libraryOf(fresh)
      const oldK = [{ id: 999999, name: '旧知识点', subject: 'czsx' }]
      saveQuestionMeta(fresh, before.get(qids[1])!.id, { knowledge: oldK, difficulty: 0.3 })
      saveQuestionMeta(fresh, before.get(qids[2])!.id, { knowledge: [{ id: 888888, name: '只有知识点', subject: 'czsx' }], difficulty: null })
      saveQuestionMeta(fresh, before.get(qids[3])!.id, { knowledge: [], difficulty: 0.11 })

      const page = await prep(fresh, runs.math.page)
      const preview = toPreview(page, 't')
      assert.ok(preview.questions.every((q) => q.duplicate), '全部已在库')
      assert.equal(preview.questions[1].fill, false, '两样都有，不补')
      assert.equal(fills(preview), 22)
      assert.equal(preview.noKnowledge, 0)
      assert.equal(preview.questions.filter((q) => !q.duplicate).length, 0)
      assert.deepEqual(commitPages(fresh, freshDir, [page]), { added: 0, skipped: 23, filled: 22 })

      const after = libraryOf(fresh)
      assert.equal(after.size, 23, '不新增题')
      for (const q of runs.math.page.questions) {
        const got = after.get(q.qid!)!
        const i = q.order
        if (i === 1) assert.deepEqual({ knowledge: got.knowledge, difficulty: got.difficulty }, { knowledge: oldK, difficulty: 0.3 }, '已有知识点与难度的题不被改')
        else if (i === 2) assert.deepEqual({ knowledge: got.knowledge, difficulty: got.difficulty }, { knowledge: [{ id: 888888, name: '只有知识点', subject: 'czsx' }], difficulty: q.difficulty }, '只补缺的难度，已有知识点不动')
        else if (i === 3) assert.deepEqual({ knowledge: got.knowledge, difficulty: got.difficulty }, { knowledge: q.knowledge, difficulty: 0.11 }, '只补缺的知识点，已有难度不动')
        else assert.deepEqual({ knowledge: got.knowledge, difficulty: got.difficulty }, pageMeta(q), `第 ${i + 1} 题`)
      }
      // 再入一次：没有可补的了；用去掉信息的页面再入，页面读不到就什么也不改
      const again = await prep(fresh, runs.math.page)
      assert.equal(fills(toPreview(again, 't')), 0)
      assert.deepEqual(commitPages(fresh, freshDir, [again]), { added: 0, skipped: 23, filled: 0 })
      const bareAgain = await prep(fresh, runs.mathBare.page)
      assert.equal(fills(toPreview(bareAgain, 't')), 0)
      assert.equal(toPreview(bareAgain, 't').noKnowledge, 23)
      assert.equal(toPreview(bareAgain, 't').noDifficulty, 23)
      assert.deepEqual(commitPages(fresh, freshDir, [bareAgain]), { added: 0, skipped: 23, filled: 0 })
      assert.deepEqual(libraryOf(fresh), after, '库内容不变')
    })
  })

  await check('补齐只算一次：同一次入库里前面出现过的重复题不算；预览之后库里才多出的题，提交时也能补', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      commitPages(fresh, freshDir, [await prep(fresh, runs.mathBare.page)])
      const job = new SeenQuestions()
      const a = await prep(fresh, runs.math.page, job, 0)
      const b = await prep(fresh, runs.math.page, job, 1)
      assert.equal(fills(toPreview(a, 't')), 23)
      assert.equal(fills(toPreview(b, 't')), 0, '同一次入库里前面补过的题，后面重复出现的不再算')
      assert.ok(b.questions.every((q) => q.duplicate && q.repeatInJob))
      assert.deepEqual(commitPages(fresh, freshDir, [a, b]), { added: 0, skipped: 46, filled: 23 })
    })
    await withFreshDb(async (fresh, freshDir) => {
      // pageStale 在库里还没有这些题时做的预览（全是新题）；之后另一次入库把无知识点的版本写进库，再提交 stale
      const emptyDir = mkdtempSync(join(tmpdir(), 'ewb-empty-meta-'))
      const emptyDb = openDatabase(emptyDir)
      const stale = await prep(emptyDb, runs.math.page)
      emptyDb.close()
      rmSync(emptyDir, { recursive: true, force: true })
      assert.ok(stale.questions.every((q) => !q.duplicate && !q.fill))
      commitPages(fresh, freshDir, [await prep(fresh, runs.mathBare.page)])
      assert.deepEqual(commitPages(fresh, freshDir, [stale]), { added: 0, skipped: 23, filled: 23 })
      assert.ok([...libraryOf(fresh).values()].every((q) => (q.knowledge as unknown[]).length > 0 && q.difficulty !== null))
    })
  })

  await check('新题与待补齐的题混在一页：单题页先以无信息入库，再入整张试卷——新增 22、补齐 1', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      const bareQuestion = structuredClone(runs.question.page)
      bareQuestion.questions[0].knowledge = []
      bareQuestion.questions[0].difficulty = null
      assert.deepEqual(commitPages(fresh, freshDir, [await prep(fresh, bareQuestion)]), { added: 1, skipped: 0, filled: 0 })
      const page = await prep(fresh, runs.math.page)
      const preview = toPreview(page, 't')
      assert.equal(preview.questions.filter((q) => !q.duplicate).length, 22)
      assert.equal(fills(preview), 1)
      assert.equal(preview.questions.find((q) => q.fill)!.duplicate, true)
      assert.deepEqual(commitPages(fresh, freshDir, [page]), { added: 22, skipped: 1, filled: 1 })
      const stored = libraryOf(fresh)
      assert.equal(stored.size, 23)
      for (const q of runs.math.page.questions) assert.deepEqual({ knowledge: stored.get(q.qid!)!.knowledge, difficulty: stored.get(q.qid!)!.difficulty }, pageMeta(q))
    })
  })

  await check('无题目编号按内容指纹找到库里那道题补齐；补齐写到一半失败，整次入库回滚（新增的题也不留）', async () => {
    await withFreshDb(async (fresh, freshDir) => {
      const noQid = structuredClone(runs.english.page)
      noQid.questions = noQid.questions.slice(0, 3).map((q) => ({ ...q, qid: null, knowledge: [], difficulty: null }))
      assert.deepEqual(commitPages(fresh, freshDir, [await prep(fresh, noQid)]), { added: 3, skipped: 0, filled: 0 })
      const withMeta = structuredClone(runs.english.page)
      withMeta.questions = withMeta.questions.slice(0, 3).map((q) => ({ ...q, qid: null }))
      const page = await prep(fresh, withMeta)
      assert.equal(fills(toPreview(page, 't')), 3)
      assert.deepEqual(commitPages(fresh, freshDir, [page]), { added: 0, skipped: 3, filled: 3 })
      assert.equal(listQuestions(fresh, {}).items.length, 3)
      // 回滚：补齐写到一半失败（知识点表被占住），整次入库一条都不留
      const before = libraryOf(fresh)
      const failing = await prep(fresh, runs.mathBare.page)
      const filling = await prep(fresh, runs.math.page)
      // 先入的 failing 新增 23 道，后一页 filling 的同一批题在提交时才发现已在库、去补难度——触发器让这一步失败
      fresh.exec('CREATE TRIGGER fail_meta BEFORE INSERT ON question_difficulty BEGIN SELECT RAISE(ABORT, \'故意失败\'); END')
      assert.throws(() => commitPages(fresh, freshDir, [failing, filling]), /故意失败/)
      fresh.exec('DROP TRIGGER fail_meta')
      assert.deepEqual(libraryOf(fresh), before)
      assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM questions').get()!.n, 3)
    })
  })
} finally {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(synthDir, { recursive: true, force: true })
}

console.log(`入库测试通过：${passed} 项，证据在 ${evidence}`)
