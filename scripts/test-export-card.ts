// 第二轮下载线的规则测试（由 scripts/test-export.ts 末尾调用，也就是 npm test 的一部分）：
// 答题卡版式规则（题型分组、选择表格、多小题块、小问识别、分值文字）、试卷抬头与分值标注、Word 页脚与选项测宽、
// 下载前自检清单、答题卡的下载流程（文件名、类型、记录、重新下载、预览重名）。
// 纯规则不需要 Electron；真实 PDF 的定位块与黑框分页检查在 test/e2e/export-card.e2e.ts。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_EXPORT_OPTIONS, type DraftSection, type ExportOptions, type PaperItem, type PaperSnapshot } from '../src/shared/domain.ts'
import { formatQuestionNos } from '../src/shared/export.ts'
import { checkDraft } from '../src/main/export/check.ts'
import { CARD_CONFIG, blankCount, buildCardDocument, cardKindOf, subQuestionCount, type CardBlock } from '../src/main/export/card.ts'
import { buildExportDocument, exportHeadings } from '../src/main/export/document.ts'
import { buildDocx, collectMeasureRequests, estimateTextWidth, type DocxImage } from '../src/main/export/docx.ts'
import { blockify, parseHtml } from '../src/main/export/html-tree.ts'
import { countPdfPages } from '../src/main/export/pdf-pages.ts'
import { CARD_MARK, CARD_PAGE, renderCardHtml } from '../src/main/export/render-card-html.ts'
import { renderHtml } from '../src/main/export/render-html.ts'
import { createExportService, type Renderers } from '../src/main/export/service.ts'
import { exportFileName, safeFileTitle } from '../src/main/export/file-name.ts'
import { ANSWER_SHEET_OPTIONS, readExportDefaults } from '../src/main/export/settings.ts'
import { createPaper, getPaper, listVersions, saveDraft } from '../src/main/papers/repo.ts'

type Check = (name: string, fn: () => void | Promise<void>) => Promise<void> | void

export interface Round2Env {
  check: Check
  db: DatabaseSync
  dataDir: string
  root: string
}

// ---------- 造数据 ----------
let seq = 0
const item = (questionType: string, extra: Partial<PaperItem> = {}): PaperItem => ({
  id: `i${++seq}`,
  originQuestionId: null,
  sourceLabel: '',
  questionType,
  numberCount: 1,
  stemHtml: `<p>题干${seq}</p>`,
  answerHtml: null,
  ...extra
})
const section = (title: string, items: PaperItem[], defaultScore?: number): DraftSection => ({ id: `s${++seq}`, title, items, ...(defaultScore === undefined ? {} : { defaultScore }) })
const items = (n: number, type: string, extra: Partial<PaperItem> = {}): PaperItem[] => Array.from({ length: n }, () => item(type, extra))
const snap = (sections: DraftSection[], title = '七年级测试卷'): PaperSnapshot => ({ title, sections })
const OPTIONS_TABLE = '<table data-role="options"><tbody><tr><td>A．甲</td><td>B．乙</td><td>C．丙</td><td>D．丁</td></tr></tbody></table>'

const typesOf = (blocks: CardBlock[]): string[] => blocks.map((b) => b.type)
// 答题卡上出现的全部题号（选择表格的格、填空的题号、解答 / 书面表达框头的题号范围）
function cardNumbers(blocks: CardBlock[]): number[] {
  const out: number[] = []
  for (const b of blocks) {
    if (b.type === 'choice') out.push(...b.rows.flat())
    else if (b.type === 'blank') out.push(...b.items.map((i) => i.no))
    else {
      const m = /^(\d+)(?:～(\d+))?\.$/.exec(b.label)!
      for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) out.push(n)
    }
  }
  return out
}

export async function runRound2Tests(env: Round2Env): Promise<void> {
  const { check, db, root } = env
  const noImages = (): DocxImage => {
    throw new Error('这组测试不含图片')
  }

  console.log('答题卡：题型分组与版式规则')
  check('题型分类：沿用作答区分类，选择类含完形填空与阅读理解的选择小题，填空类只有「填空」', () => {
    const cases: [string, string, string][] = [
      ['选择题', '单选题', 'choice'],
      ['单项选择', '单项选择-四个选项', 'choice'],
      ['语音题', '语音题-单词辨音', 'choice'],
      ['完形填空', '完形填空-15空', 'choice'], // 「填空」二字不能把完形填空判成填空类
      ['阅读理解', '阅读理解-阅读单选/选择5题', 'choice'],
      ['阅读理解', '阅读理解-阅读判断', 'choice'],
      ['阅读理解', '阅读理解-五选五', 'choice'],
      ['判断题', '判断题', 'choice'],
      ['填空题', '填空题', 'blank'],
      ['短文填空', '短文填空-语法填空', 'blank'],
      ['任务型阅读', '任务型阅读-阅读问答', 'blank'], // 标签与大题名都认不出，题干里也没有选项：按填空类（一题一条横线）
      ['解答题', '解答题-计算题', 'solve'],
      ['解答题', '解答题-问答题', 'solve'],
      ['解答题', '解答题-作图题', 'solve'],
      ['证明题', '', 'solve'],
      ['书面表达', '书面表达-看图作文', 'writing'],
      ['综合题', '', 'blank'],
      ['', '', 'blank']
    ]
    for (const [sec, type, kind] of cases) assert.equal(cardKindOf(sec, type, []), kind, `${sec} / ${type}`)
    // 标签与大题名都判断不出时，题干里有选项就是选择类
    assert.equal(cardKindOf('综合题', '', blockify(parseHtml(`<p>下列正确的是</p>${OPTIONS_TABLE}`))), 'choice')
    // 题自己的标签优先于大题名
    assert.equal(cardKindOf('选择题', '填空题', []), 'blank')
  })

  check('选择表格每行 10 题，最后一行不满；超过一个框的行数拆框，大题说明只在第一个框', () => {
    const doc = buildCardDocument(snap([section('选择题', items(23, '单选题'), 3)]))
    assert.equal(CARD_CONFIG.choicePerRow, 10)
    assert.equal(doc.blocks.length, 1)
    const b = doc.blocks[0]
    assert.equal(b.type, 'choice')
    assert.deepEqual((b as { rows: number[][] }).rows.map((r) => r.length), [10, 10, 3])
    assert.deepEqual((b as { rows: number[][] }).rows[2], [21, 22, 23])
    const many = buildCardDocument(snap([section('选择题', items(10 * CARD_CONFIG.choiceMaxRows + 4, '单选题'))]))
    assert.deepEqual(typesOf(many.blocks), ['choice', 'choice'])
    assert.deepEqual(many.blocks.map((x) => x.heading !== null), [true, false], '大题说明行只放在第一个框里')
    assert.deepEqual(cardNumbers(many.blocks), Array.from({ length: 10 * CARD_CONFIG.choiceMaxRows + 4 }, (_, k) => k + 1))
  })

  check('多小题块（完形填空 15 空、阅读理解 5 题）按题号逐个占格，题号接着前面的题', () => {
    const doc = buildCardDocument(
      snap([
        section('单项选择', items(10, '单项选择-四个选项'), 2),
        section('完形填空', [item('完形填空-15空', { numberCount: 15 })], 1),
        section('阅读理解', [item('阅读理解-阅读单选/选择5题', { numberCount: 5 }), item('阅读理解-阅读判断', { numberCount: 5 })], 2)
      ])
    )
    assert.deepEqual(typesOf(doc.blocks), ['choice', 'choice', 'choice'])
    const cloze = doc.blocks[1] as { rows: number[][] }
    assert.deepEqual(cloze.rows.map((r) => [r[0], r[r.length - 1], r.length]), [[11, 20, 10], [21, 25, 5]])
    // 同一大题里相邻的两个阅读理解块合成一个表格：10 个格
    assert.deepEqual((doc.blocks[2] as { rows: number[][] }).rows, [[26, 27, 28, 29, 30, 31, 32, 33, 34, 35]])
    assert.deepEqual(cardNumbers(doc.blocks), Array.from({ length: 35 }, (_, k) => k + 1))
  })

  check('同一大题里题型混排：选择、填空、解答各成各的框，大题说明只出现一次，题号不重不漏', () => {
    const doc = buildCardDocument(
      snap([section('综合题', [item('单选题'), item('单选题'), item('填空题'), item('填空题'), item('解答题-计算题'), item('解答题-问答题'), item('单选题')], 5)])
    )
    assert.deepEqual(typesOf(doc.blocks), ['choice', 'blank', 'solve', 'solve', 'choice'])
    assert.equal(doc.blocks.filter((b) => b.heading !== null).length, 1)
    assert.deepEqual(cardNumbers(doc.blocks), [1, 2, 3, 4, 5, 6, 7])
  })

  check('填空类两栏横线：一题多空时同一行多条线；题号连续；空大题不上答题卡', () => {
    const doc = buildCardDocument(
      snap([
        section('填空题', [item('填空题', { stemHtml: '<p>最大值是______，最小值是______．</p>' }), item('填空题', { stemHtml: '<p>结果是________．</p>' }), item('填空题', { stemHtml: '<p>a<u>&nbsp;&nbsp;&nbsp;</u>b<u>&nbsp;&nbsp;</u>c<u>&nbsp;</u>d</p>' })], 4),
        section('空大题', []),
        section('短文填空', [item('短文填空-语法填空', { numberCount: 3 })], 1)
      ])
    )
    const blank = doc.blocks[0] as { items: { no: number; lines: number }[] }
    assert.deepEqual(blank.items, [{ no: 1, lines: 2 }, { no: 2, lines: 1 }, { no: 3, lines: 3 }])
    assert.deepEqual((doc.blocks[1] as { items: { no: number; lines: number }[] }).items, [{ no: 4, lines: 1 }, { no: 5, lines: 1 }, { no: 6, lines: 1 }])
    assert.equal(doc.blocks.length, 2, '空大题没有框')
    const html = renderCardHtml(doc)
    assert.match(html, /<div class="it"><span class="n">1\.<\/span><span class="line"><\/span><span class="line"><\/span><\/div>/)
    assert.match(html, /<div class="it full"><span class="n">3\./, `${CARD_CONFIG.blankFullRowFrom} 条线的题独占一行`)
  })

  check('小问识别：段首或句末标点后的（1）（2）…连续编号才算；算式里的括号数字、只有一个（1）不算', () => {
    const sub = (html: string): number => subQuestionCount(blockify(parseHtml(html)))
    assert.equal(sub('<p>计算：</p><p>(1)甲；</p><p>(2)乙．</p><p>(3)丙；</p><p>(4)丁．</p>'), 4)
    assert.equal(sub('<p>已知甲．（1）求乙；（2）求丙．</p>'), 2)
    assert.equal(sub('<p>(1)甲<br>(2)乙</p>'), 2)
    assert.equal(sub('<p>设 f(1)=2，f(2)=3，求 f(3)</p>'), 0)
    assert.equal(sub('<p>（1）仅有一问</p>'), 0)
    assert.equal(sub('<p>(1)甲；由(1)可知(2)乙</p>'), 0, '行内引用不算小问')
    assert.equal(sub('<p>(1)甲；</p><p>(3)丙</p>'), 0, '编号不连续的不算')
    assert.equal(sub('<p>（ 1 ）甲</p><p>（ 2 ）乙</p>'), 2)
  })

  check('解答类的作答区：有小问时每问一块、虚线分隔；无小问按类型给高度；总高不超过上限', () => {
    const doc = buildCardDocument(
      snap([
        section(
          '解答题',
          [
            item('解答题-计算题', { stemHtml: '<p>计算：</p><p>(1)甲；</p><p>(2)乙．</p><p>(3)丙．</p>' }),
            item('解答题-计算题'),
            item('解答题-问答题'),
            item('解答题-问答题', { stemHtml: Array.from({ length: 10 }, (_, k) => `<p>(${k + 1})小问；</p>`).join('') }),
            item('解答题-问答题', { stemHtml: Array.from({ length: 11 }, (_, k) => `<p>(${k + 1})编号；</p>`).join('') })
          ],
          8
        )
      ])
    )
    const areas = doc.blocks.map((b) => (b as { areas: number[] }).areas)
    assert.deepEqual(areas[0], [CARD_CONFIG.subAreaMm.calc, CARD_CONFIG.subAreaMm.calc, CARD_CONFIG.subAreaMm.calc])
    assert.deepEqual(areas[1], [CARD_CONFIG.solveAreaMm.calc])
    assert.deepEqual(areas[2], [CARD_CONFIG.solveAreaMm.solve])
    assert.equal(areas[3].length, 10)
    assert.ok(areas[3].reduce((a, b) => a + b, 0) <= CARD_CONFIG.boxMaxMm, '10 个小问的总高被压到上限以内')
    assert.deepEqual(areas[4], [CARD_CONFIG.solveAreaMm.solve], '小问多到 11 个：不再按小问分隔，整题一块作答区')
    const html = renderCardHtml(doc)
    assert.equal((html.match(/class="subq"/g) ?? []).length, 3 + 10)
    assert.match(html, /<div class="subq" style="height:24mm">（3）<\/div>/)
  })

  check('书面表达：横线格，行数取题干里作答横线的折算值，没有横线用默认行数', () => {
    const long = `<p>请写一篇短文。</p><div data-role="writing-lines">${'_'.repeat(300)}</div>`
    const doc = buildCardDocument(snap([section('书面表达', [item('书面表达-看图作文', { stemHtml: long }), item('书面表达-材料作文')], 10)]))
    assert.deepEqual(doc.blocks.map((b) => (b as { lines: number }).lines), [6, CARD_CONFIG.writingDefaultLines])
    assert.equal((renderCardHtml(doc).match(/class="wl"/g) ?? []).length, 6 + CARD_CONFIG.writingDefaultLines)
  })

  check('一题多空数得对：下划线、空白下划线 <u>；带文字的 <u> 不是空；最多画 4 条', () => {
    const blanks = (html: string): number => blankCount(blockify(parseHtml(html)))
    assert.equal(blanks('<p>a______b</p>'), 1)
    assert.equal(blanks('<p>a___b____c</p>'), 2)
    assert.equal(blanks('<p>a<u>&nbsp;&nbsp;</u>b<u>重点</u></p>'), 1)
    assert.equal(blanks('<p>无空</p>'), 1)
    assert.equal(blanks('<p>' + '____ '.repeat(9) + '</p>'), CARD_CONFIG.blankMaxLines)
  })

  console.log('答题卡：分值文字')
  check('大题说明用 sectionScoreNote；框头分值：单题（8 分），多小题块每小题 N 分，未设分值没有', () => {
    const doc = buildCardDocument(
      snap([
        section('选择题', items(10, '单选题'), 4),
        section('解答题', [item('解答题-计算题'), item('解答题-问答题', { score: 10 }), item('解答题-问答题', { score: 0.5 })], 8),
        section('阅读理解', [item('阅读理解-阅读单选/选择5题', { numberCount: 5 }), item('解答题-问答题', { numberCount: 3, score: 2 })]),
        section('未设分', [item('解答题-问答题')])
      ])
    )
    const notes = doc.blocks.filter((b) => b.heading).map((b) => b.heading!.title + b.heading!.note)
    assert.deepEqual(notes, [
      '一、选择题（共 10 小题，每小题 4 分，共 40 分）',
      '二、解答题（共 3 小题，满分 18.5 分）',
      '三、阅读理解（共 8 小题）',
      '四、未设分（共 1 小题）'
    ])
    const solves = doc.blocks.filter((b) => b.type === 'solve' || b.type === 'writing') as { label: string; score: string }[]
    assert.deepEqual(solves.map((b) => [b.label, b.score]), [['11.', '（8 分）'], ['12.', '（10 分）'], ['13.', '（0.5 分）'], ['19～21.', '（每小题 2 分，共 6 分）'], ['22.', '']])
    const html = renderCardHtml(doc)
    assert.match(html, /<b>二、解答题<\/b>（共 3 小题，满分 18\.5 分）/)
  })

  check('答题卡不涉及版别与答案：没有题就报错，题干里的答案字段不影响', () => {
    assert.throws(() => buildCardDocument(snap([section('空', [])])), /还没有题目/)
    const withAnswer = buildCardDocument(snap([section('选择题', [item('单选题', { answerHtml: '<p>A</p>' })])]))
    assert.equal(withAnswer.blocks.length, 1)
  })

  console.log('答题卡：页面 HTML')
  check('版式常量与本地答题卡一致：四角定位块 6.8 / 6.2mm、5×2.6mm，黑框 break-inside: avoid，页脚与顶部提示在页边距盒里', () => {
    const html = renderCardHtml(buildCardDocument(snap([section('选择题', items(3, '单选题'), 4), section('解答题', [item('解答题-问答题')], 8)], '南安市柳南中学初一上第一单元测试')))
    assert.deepEqual([CARD_MARK.offsetX, CARD_MARK.offsetY, CARD_MARK.width, CARD_MARK.height], [6.8, 6.2, 5, 2.6])
    assert.deepEqual([CARD_PAGE.marginX, CARD_PAGE.marginTop], [13, 21.6])
    for (const c of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) assert.match(html, new RegExp(`@${c}-corner \\{ content: ""; background: linear-gradient\\(#000, #000\\) no-repeat (left|right) 6\\.8mm (top|bottom) 6\\.2mm / 5mm 2\\.6mm; \\}`))
    assert.match(html, /\.box \{[^}]*break-inside: avoid/)
    assert.match(html, /@page :first \{ margin-top: 12\.6mm; @top-center \{ content: none; \} \}/)
    assert.match(html, /@top-center \{ content: "请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效"/)
    assert.match(html, /@bottom-center \{ content: "南安市柳南中学初一上第一单元测试 答题卡　第 " counter\(page\) " 页（共 " counter\(pages\) " 页）"/)
    assert.match(html, /<h1 class="title">南安市柳南中学初一上第一单元测试　答题卡<\/h1>/)
    assert.match(html, /班级<span class="line"><\/span><\/span><span class="f">座号.*小组.*姓名/s)
    assert.match(html, /注意事项/)
    assert.equal((html.match(/请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效/g) ?? []).length, 3, '第二页起的页顶提示（页边距盒）、第一页信息框下的提示、注意事项第 3 条')
  })
  check('试卷名里的引号、反斜杠、</style> 不会破坏样式块，页脚里的长试卷名被截短', () => {
    const nasty = `坏"名\\字</style><script>alert(1)</script>${'长'.repeat(60)}`
    const html = renderCardHtml(buildCardDocument(snap([section('选择题', items(1, '单选题'))], nasty)))
    assert.equal((html.match(/<\/style>/g) ?? []).length, 1, '只有样式块自己的结束标签')
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /@bottom-center \{ content: "坏\\22 名\\5c 字\\3c \/style>/)
    const footer = /@bottom-center \{ content: "([^"]*)" counter/.exec(html)![1]
    assert.ok(footer.includes('…'), '超长试卷名在页脚省略')
    assert.match(html, /<h1 class="title">坏"名\\字&lt;\/style&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;长{60}　答题卡<\/h1>/, '标题里的试卷名完整保留（HTML 转义）')
  })

  console.log('试卷抬头与分值标注')
  const scoredSnapshot = snap(
    [
      section('选择题', [item('单选题', { stemHtml: '<p>下列正确的是（　　）</p>' }), item('单选题', { score: 3 })], 4),
      section('完形填空', [item('完形填空-15空', { numberCount: 3, stemHtml: '<p>Tom <span data-ewb-qno="0"></span> is <span data-ewb-qno="1"></span>.</p>' })], 1),
      section('解答题', [item('解答题-问答题', { stemHtml: '<p>求值．</p>' })], 10)
    ],
    '七年级数学第一单元测试'
  )
  const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({ ...DEFAULT_EXPORT_OPTIONS, ...o })
  check('全卷满分、大题说明、题号后的分值标注都调用 shared/numbering 的函数；全部设分才有全卷满分', () => {
    const doc = buildExportDocument(scoredSnapshot, opts())
    assert.equal(doc.totalNote, '（全卷满分：20分）')
    assert.deepEqual(doc.sections.map((s) => s.scoreNote), ['（共 2 小题，满分 7 分）', '（共 3 小题，每小题 1 分，共 3 分）', '（共 1 小题，每小题 10 分，共 10 分）'])
    assert.deepEqual(doc.sections.map((s) => s.heading), ['一、选择题', '二、完形填空', '三、解答题'])
    const text = (n: number, k: number): string => JSON.stringify(doc.sections[n].items[k].body)
    assert.match(text(0, 0), /1\./)
    const html = renderHtml(doc)
    assert.match(html, /<p class="paper-total">（全卷满分：20分）<\/p>/)
    assert.match(html, /<h2 class="section-heading">一、选择题（共 2 小题，满分 7 分）<\/h2>/)
    assert.match(html, /<p>1\.（本题 4 分）下列正确的是/)
    assert.match(html, /<p>2\.（本题 3 分）题干/)
    assert.match(html, /<p>（每小题 1 分，共 3 分）Tom 3 is 4\./, '多小题块没有块首题号，分值说明在最前')
    assert.match(html, /<p>6\.（本题 10 分）求值/)
  })
  check('没设全分值时：没有全卷满分；一题都没设分的大题标题保持原样；设了分的题才标分值', () => {
    const partial = structuredClone(scoredSnapshot)
    partial.sections[0].items[1].score = null
    partial.sections[0].defaultScore = null // 选择题一题都没设
    partial.sections[2].defaultScore = null
    partial.sections[2].items[0].score = 6
    const doc = buildExportDocument(partial, opts())
    assert.equal(doc.totalNote, '')
    assert.deepEqual(doc.sections.map((s) => s.scoreNote), ['', '（共 3 小题，每小题 1 分，共 3 分）', '（共 1 小题，每小题 6 分，共 6 分）'])
    const body = renderHtml(doc).split('<body>')[1]
    assert.doesNotMatch(body, /paper-total/, '没有全卷满分行')
    assert.equal((body.match(/本题/g) ?? []).length, 1, '只有设了分值的那一题标分值，选择题不标')
    const none = buildExportDocument(snap([section('选择题', [item('单选题')])]), opts())
    assert.deepEqual([none.totalNote, none.sections[0].scoreNote], ['', ''])
    assert.match(renderHtml(none).split('<body>')[1], /<p>1\. 题干/, '旧试卷：题号后只有一个空格，没有分值')
    const mixed = structuredClone(scoredSnapshot)
    mixed.sections[0].items[0].score = null
    mixed.sections[0].defaultScore = null
    assert.equal(buildExportDocument(mixed, opts()).sections[0].scoreNote, '（共 2 小题）', '部分设分的大题沿用 sectionScoreNote：只写题数')
  })
  check('分值说明与来源「题文前」并存：题号、分值、来源依次排在题干前', () => {
    const labelled = structuredClone(scoredSnapshot)
    labelled.sections[0].items[0].sourceLabel = '26-27七年级上·样例市·月考'
    const html = renderHtml(buildExportDocument(labelled, opts({ sourcePosition: 'before-stem' })))
    assert.match(html, /<p>1\.（本题 4 分）<span data-role="source">（26-27七年级上·样例市·月考）<\/span>下列正确的是/)
  })
  check('抬头有「班级 座号 小组 姓名」填写行（学生版与教师版都有），PDF 用带下边框的行内块', () => {
    for (const o of [opts(), opts({ answerPosition: 'end' }), opts({ answerPosition: 'after' })]) {
      const withAnswer = structuredClone(scoredSnapshot)
      withAnswer.sections.forEach((s) => s.items.forEach((i) => (i.answerHtml = '<p>A</p>')))
      const html = renderHtml(buildExportDocument(withAnswer, o))
      assert.match(html, /<div class="student-info"><span class="info-field">班级<span class="info-blank" style="width:26mm"><\/span><\/span><span class="info-field">座号.*小组.*姓名<span class="info-blank" style="width:30mm"><\/span><\/span><\/div>/)
      assert.ok(html.indexOf('student-info"') < html.indexOf('section-heading"'), '填写行在第一个大题标题之前')
    }
  })

  console.log('Word：页脚、抬头与测宽')
  const docxParts = async (doc: ReturnType<typeof buildExportDocument>, measure?: (t: string, b: boolean) => number): Promise<{ xml: string; footer: string }> => {
    const file = join(root, `r2-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(file, await buildDocx(doc, noImages, measure))
    const unzip = (part: string): string => execFileSync('unzip', ['-p', file, part], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return { xml: unzip('word/document.xml'), footer: unzip('word/footer1.xml') }
  }
  await check('页脚「第N页（共M页）」：前后文字与 PAGE、NUMPAGES 域按顺序排列', async () => {
    const { footer } = await docxParts(buildExportDocument(scoredSnapshot, opts({ format: 'docx' })))
    const text = footer.replace(/<w:instrText[^>]*>\s*(PAGE|NUMPAGES)\s*<\/w:instrText>/g, '{$1}').replace(/<[^>]+>/g, '')
    assert.equal(text, '第{PAGE}页（共{NUMPAGES}页）')
    assert.doesNotMatch(footer, / \/ /)
  })
  await check('抬头：全卷满分行居中；填写行四条横线用下划线前导符的制表位；大题标题带分值说明', async () => {
    const { xml } = await docxParts(buildExportDocument(scoredSnapshot, opts({ format: 'docx' })))
    const plainText = xml.replace(/<[^>]+>/g, '')
    assert.match(plainText, /（全卷满分：20分）/)
    const info = xml.split('</w:p>').find((p) => p.includes('班级'))!
    assert.equal((info.match(/w:leader="underscore"/g) ?? []).length, 4)
    assert.equal((info.match(/<w:tab\/>/g) ?? []).length, 7, '4 个横线 + 3 个间隔')
    assert.ok(['班级', '座号', '小组', '姓名'].every((l) => info.includes(l)))
    assert.match(plainText, /一、选择题（共 2 小题，满分 7 分）/)
    assert.match(plainText, /1\.（本题 4 分）下列正确的是/)
    const plain = await docxParts(buildExportDocument(snap([section('选择题', [item('单选题')])]), opts({ format: 'docx' })))
    assert.doesNotMatch(plain.xml.replace(/<[^>]+>/g, ''), /全卷满分|本题/)
    assert.ok(plain.xml.includes('班级'), '没设分值的旧试卷也有填写行')
  })
  check('估算宽度：圈码按全角计，西文半角', () => {
    assert.equal(estimateTextWidth('①②③'), estimateTextWidth('甲乙丙'))
    assert.equal(estimateTextWidth('ab'), estimateTextWidth('甲'))
  })
  await check('选项排几列取决于测宽结果：实测更宽就少排几列；要测的文字由空跑一遍列出', async () => {
    const wide = snap([section('选择题', [item('单选题', { stemHtml: `<p>题干</p>${OPTIONS_TABLE}` })])])
    const doc = buildExportDocument(wide, opts({ format: 'docx' }))
    const requests = collectMeasureRequests(doc, noImages)
    assert.deepEqual(requests.map((r) => r.text).sort(), ['A．甲', 'B．乙', 'C．丙', 'D．丁'])
    const tabsIn = (xml: string): number => (xml.split('</w:p>').find((p) => p.includes('A．甲'))?.match(/<w:tab\/>/g) ?? []).length
    assert.equal(tabsIn((await docxParts(doc)).xml), 3, '估算：4 个选项一行')
    assert.equal(tabsIn((await docxParts(doc, () => 3000)).xml), 1, '每项实测 3000 twips：一行放不下 4 个，退成每行 2 个')
    assert.equal(tabsIn((await docxParts(doc, () => 6000)).xml), 0, '每项实测 6000 twips：退成每行 1 个')
    assert.equal(tabsIn((await docxParts(doc, () => 1500)).xml), 3, '每项实测 1500 twips：一行 4 个仍放得下')
  })

  console.log('下载前自检')
  const issueTypes = (c: { issues: { type: string }[] }): string[] => c.issues.map((i) => i.type)
  check('题号列表紧凑写法', () => {
    assert.equal(formatQuestionNos([8, 2, 4, 9, 10, 11, 4]), '2、4、8～11')
    assert.equal(formatQuestionNos([5, 6]), '5、6')
    assert.equal(formatQuestionNos([]), '')
  })
  check('空试卷：阻止下载（试卷与答题卡都一样），不再列别的问题', () => {
    for (const kind of ['paper', 'answer-sheet'] as const) {
      const c = checkDraft({ sections: [section('选择题', [])] }, opts(), kind)
      assert.deepEqual([c.blocked, c.questionCount, issueTypes(c)], [true, 0, ['empty-paper']])
      assert.equal(c.issues[0].blocking, true)
    }
    assert.deepEqual(checkDraft({ sections: [] }, opts(), 'paper').issues.map((i) => i.type), ['empty-paper'])
  })
  check('全部题没有答案而选了卷尾 / 题后：阻止该配置；学生版与答题卡不受影响', () => {
    const sections = [section('选择题', items(4, '单选题'), 2)]
    for (const answerPosition of ['end', 'after'] as const) {
      const c = checkDraft({ sections }, opts({ answerPosition }), 'paper')
      assert.equal(c.blocked, true)
      assert.equal(c.issues[0].type, 'no-answers')
      assert.deepEqual(c.issues[0].questionNos, [1, 2, 3, 4])
      assert.equal(c.issues[0].questionLabel, '1～4')
      assert.equal(c.answerMissingCount, 4)
    }
    assert.equal(checkDraft({ sections }, opts(), 'paper').blocked, false)
    assert.equal(checkDraft({ sections }, opts(), 'paper').answerMissingCount, 4, '学生版也报出缺答案数，弹窗据此提前禁用教师版')
    assert.deepEqual(issueTypes(checkDraft({ sections }, opts({ answerPosition: 'end' }), 'answer-sheet')), [])
  })
  check('部分题缺答案：只提示，列出题号；多小题块按题号逐个列；只有空段落的答案按没有处理', () => {
    const sections = [
      section('选择题', [item('单选题', { answerHtml: '<p>A</p>' }), item('单选题'), item('完形填空-15空', { numberCount: 3, answerHtml: '<p>1.A 2.B 3.C</p>' }), item('单选题', { answerHtml: '<p>&nbsp;</p>' })], 2)
    ]
    const c = checkDraft({ sections }, opts({ answerPosition: 'end' }), 'paper')
    const partial = c.issues.find((i) => i.type === 'partial-answers')!
    assert.deepEqual([partial.questionNos, partial.questionLabel, partial.blocking, c.blocked], [[2, 6], '2、6', false, false])
    // 自检的缺答案口径与下载时一致：下载结果里的 missingAnswers 对得上
    const doc = buildExportDocument({ title: 't', sections }, opts({ answerPosition: 'end' }))
    assert.deepEqual(doc.missingAnswers, ['2', '6'])
    // 全部都是空段落答案：下载时会报「没有任何带答案」，自检也必须是阻止项
    const hollow = [section('选择题', items(2, '单选题', { answerHtml: '<p>&nbsp;</p>' }))]
    assert.throws(() => buildExportDocument({ title: 't', sections: hollow }, opts({ answerPosition: 'end' })), /没有任何带答案/)
    assert.equal(checkDraft({ sections: hollow }, opts({ answerPosition: 'end' }), 'paper').blocked, true)
  })
  check('有题未设分值：列出题号；整卷没设分值单独说明；答题卡与试卷的说明不同', () => {
    const some = [section('选择题', [item('单选题', { score: 2 }), item('单选题'), item('单选题')])]
    const c = checkDraft({ sections: some }, opts(), 'paper')
    const unscored = c.issues.find((i) => i.type === 'unscored')!
    assert.deepEqual([unscored.questionNos, unscored.blocking], [[2, 3], false])
    assert.match(unscored.message, /第 2、3 题没有设置分值.*全卷满分/)
    assert.match(checkDraft({ sections: some }, opts(), 'answer-sheet').issues.find((i) => i.type === 'unscored')!.message, /答题卡/)
    const all = checkDraft({ sections: [section('选择题', items(3, '单选题'))] }, opts(), 'paper').issues.find((i) => i.type === 'unscored')!
    assert.match(all.message, /整卷都没有设置分值/)
    assert.equal(issueTypes(checkDraft({ sections: [section('选择题', items(3, '单选题'), 2)] }, opts(), 'paper')).includes('unscored'), false)
  })
  check('空大题与重复题：空大题带位置；同一道原题出现多次列出各自的题号', () => {
    const sections = [
      section('选择题', [item('单选题', { originQuestionId: 7 }), item('单选题', { originQuestionId: 8 }), item('单选题', { originQuestionId: 7 })], 2),
      section('填空题', []),
      section('解答题', [item('解答题-问答题', { originQuestionId: 7 }), item('解答题-问答题', { originQuestionId: null }), item('解答题-问答题', { originQuestionId: null })], 8)
    ]
    const c = checkDraft({ sections }, opts(), 'paper')
    const empty = c.issues.find((i) => i.type === 'empty-section')!
    assert.deepEqual([empty.sectionIndex, empty.questionNos, empty.blocking], [1, [], false])
    assert.match(empty.message, /^第二大题没有题目，下载时会跳过它，后面的大题序号顺延$/)
    const dup = c.issues.filter((i) => i.type === 'duplicate-question')
    assert.equal(dup.length, 1, '没有原题指针的题互不算重复')
    assert.deepEqual([dup[0].questionNos, dup[0].questionLabel], [[1, 3, 4], '1、3、4'])
  })
  check('目标满分（草稿里的 targetScore）：设了才检查，差几分、多几分；分数相同不提示', () => {
    const sections = [section('选择题', items(10, '单选题'), 9)]
    const gap = checkDraft({ sections, targetScore: 100 }, opts(), 'paper').issues.find((i) => i.type === 'score-mismatch')!
    assert.match(gap.message, /合计 90 分，目标满分 100 分，还差 10 分/)
    assert.match(checkDraft({ sections, targetScore: 80 }, opts(), 'paper').issues.find((i) => i.type === 'score-mismatch')!.message, /多出 10 分/)
    assert.equal(issueTypes(checkDraft({ sections, targetScore: 90 }, opts(), 'paper')).includes('score-mismatch'), false)
    assert.equal(issueTypes(checkDraft({ sections }, opts(), 'paper')).includes('score-mismatch'), false)
    assert.equal(issueTypes(checkDraft({ sections, targetScore: null }, opts(), 'paper')).includes('score-mismatch'), false)
    assert.equal(issueTypes(checkDraft({ sections: [section('选择题', items(3, '单选题'))], targetScore: 100 }, opts(), 'paper')).includes('score-mismatch'), false, '整卷一分都没设时只报未设分值，不报「合计 0 分」')
  })
  check('阻止项排在前面，其余按原顺序；blocked 与阻止项一致', () => {
    const sections = [section('选择题', [item('单选题', { originQuestionId: 1 }), item('单选题', { originQuestionId: 1 })]), section('空', [])]
    const c = checkDraft({ sections }, opts({ answerPosition: 'end' }), 'paper')
    assert.deepEqual(issueTypes(c), ['no-answers', 'unscored', 'empty-section', 'duplicate-question'])
    assert.equal(c.blocked, c.issues.some((i) => i.blocking))
  })

  console.log('下载流程：答题卡')
  const outDir = join(root, 'out-card')
  mkdirSync(outDir)
  const settingsFile = join(root, 'card-settings.json')
  const calls: string[] = []
  const renderers: Renderers = {
    pdf: async (doc) => {
      calls.push('pdf')
      return Buffer.from(renderHtml(doc))
    },
    docx: async (doc) => {
      calls.push('docx')
      return Buffer.from(JSON.stringify(doc))
    },
    card: async (doc) => {
      calls.push('card')
      return Buffer.from(renderCardHtml(doc))
    }
  }
  const service = createExportService({ db: () => db, dataDir: () => env.dataDir, settingsFile: () => settingsFile, defaultDirectory: () => outDir, renderers })
  const paperId = createPaper(db, '七年级数学答题卡试卷')
  saveDraft(db, paperId, { sections: scoredSnapshot.sections })
  const files = (): string[] => readdirSync(outDir).sort()

  await check('答题卡文件名「标题_vN_答题卡.pdf」；记录里 kind 是答题卡；版本说明不含格式；只记保存位置不记试卷配置', async () => {
    assert.equal(service.previewFileName(paperId, DEFAULT_EXPORT_OPTIONS, 'answer-sheet'), '七年级数学答题卡试卷_v1_答题卡.pdf')
    assert.equal(service.previewFileName(paperId, { ...DEFAULT_EXPORT_OPTIONS, format: 'docx', answerPosition: 'end' }, 'answer-sheet'), '七年级数学答题卡试卷_v1_答题卡.pdf', '答题卡固定 PDF，不受传来的配置影响')
    const r = await service.exportPaper({ paperId, kind: 'answer-sheet', options: { ...DEFAULT_EXPORT_OPTIONS, format: 'docx', answerPosition: 'end' }, directory: outDir })
    assert.deepEqual([r.kind, r.versionNo, r.createdVersion, r.pageCount, r.missingAnswers], ['answer-sheet', 1, true, null, []])
    assert.equal(r.filePath, join(outDir, '七年级数学答题卡试卷_v1_答题卡.pdf'))
    assert.deepEqual(calls, ['card'])
    const version = listVersions(db, paperId)[0]
    assert.equal(version.note, '下载时自动保存')
    assert.deepEqual(version.exports.map((e) => [e.kind, e.format, e.options]), [['answer-sheet', 'pdf', ANSWER_SHEET_OPTIONS]])
    assert.deepEqual(service.getDefaults().options, DEFAULT_EXPORT_OPTIONS, '答题卡不改「上一次的试卷配置」')
    assert.equal(service.getDefaults().directory, outDir)
  })
  await check('同一版本再下载答题卡原位覆盖；试卷与答题卡互不覆盖；试卷记住自己的配置', async () => {
    const again = await service.exportPaper({ paperId, kind: 'answer-sheet', options: DEFAULT_EXPORT_OPTIONS, directory: outDir })
    assert.equal(again.filePath, join(outDir, '七年级数学答题卡试卷_v1_答题卡.pdf'))
    assert.deepEqual([again.createdVersion, again.overwritten], [false, true])
    const paper = await service.exportPaper({ paperId, kind: 'paper', options: { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'none' }, directory: outDir })
    assert.equal(paper.kind, 'paper')
    assert.deepEqual(files(), ['七年级数学答题卡试卷_v1_学生版.pdf', '七年级数学答题卡试卷_v1_答题卡.pdf'])
    assert.equal(listVersions(db, paperId).length, 1, '答题卡与试卷共用同一个版本')
    assert.deepEqual(listVersions(db, paperId)[0].exports.map((e) => e.kind).sort(), ['answer-sheet', 'paper'], '同一个文件只有一条记录')
    assert.deepEqual(service.getDefaults().options, DEFAULT_EXPORT_OPTIONS)
  })
  await check('按下载记录重新下载：答题卡按记录的类型重新生成，仍是答题卡，覆盖原文件，记录不增加', async () => {
    const record = listVersions(db, paperId)[0].exports.find((e) => e.kind === 'answer-sheet')!
    calls.length = 0
    const r = await service.reexport(record.id)
    assert.deepEqual([r.kind, r.filePath, r.versionNo], ['answer-sheet', record.filePath, 1])
    assert.deepEqual(calls, ['card'], '重新下载走答题卡渲染器，不是试卷的')
    assert.equal(r.overwritten, true)
    assert.equal(listVersions(db, paperId)[0].exports.filter((e) => e.kind === 'answer-sheet').length, 1)
    const paperRecord = listVersions(db, paperId)[0].exports.find((e) => e.kind === 'paper')!
    calls.length = 0
    assert.equal((await service.reexport(paperRecord.id)).kind, 'paper')
    assert.deepEqual(calls, ['pdf'])
  })
  await check('改草稿后答题卡是 v2；预览与下载一致；空试卷下载答题卡报错且不存版本', async () => {
    const changed = structuredClone(scoredSnapshot.sections)
    changed[0].title = '选择题（改）'
    saveDraft(db, paperId, { sections: changed })
    assert.equal(service.previewFileName(paperId, DEFAULT_EXPORT_OPTIONS, 'answer-sheet'), '七年级数学答题卡试卷_v2_答题卡.pdf')
    const r = await service.exportPaper({ paperId, kind: 'answer-sheet', options: DEFAULT_EXPORT_OPTIONS, directory: outDir })
    assert.deepEqual([r.versionNo, r.createdVersion], [2, true])
    const empty = createPaper(db, '空卷')
    await assert.rejects(service.exportPaper({ paperId: empty, kind: 'answer-sheet', options: DEFAULT_EXPORT_OPTIONS, directory: outDir }), /还没有题目/)
    assert.equal(listVersions(db, empty).length, 0)
    await assert.rejects(service.exportPaper({ paperId, kind: 'x' as 'paper', options: DEFAULT_EXPORT_OPTIONS, directory: outDir }), /下载类型不正确/)
  })
  await check('预览文件名带保存位置时给出重名后的实际文件名，与下载落盘的一致（学生版、答题卡、改稿后的新版本）', async () => {
    const dir = join(root, 'out-preview')
    mkdirSync(dir)
    const p = createPaper(db, '预览重名卷')
    saveDraft(db, p, { sections: scoredSnapshot.sections })
    const student = DEFAULT_EXPORT_OPTIONS
    assert.equal(service.previewFileName(p, student, 'paper', dir), '预览重名卷_v1_学生版.pdf')
    writeFileSync(join(dir, '预览重名卷_v1_学生版.pdf'), 'x') // 别处留下的同名文件：这张试卷的 v1 还没下载过，不能覆盖
    assert.equal(service.previewFileName(p, student, 'paper', dir), '预览重名卷_v1_学生版 (2).pdf')
    const real = await service.exportPaper({ paperId: p, kind: 'paper', options: student, directory: dir })
    assert.equal(real.filePath, join(dir, '预览重名卷_v1_学生版 (2).pdf'))
    assert.equal(service.previewFileName(p, student, 'paper', dir), '预览重名卷_v1_学生版 (2).pdf', '同版本同配置：再下载原位覆盖，预览仍是 (2)')
    assert.equal(service.previewFileName(p, student, 'answer-sheet', dir), '预览重名卷_v1_答题卡.pdf')
    writeFileSync(join(dir, '预览重名卷_v1_答题卡.pdf'), 'x')
    writeFileSync(join(dir, '预览重名卷_v1_答题卡 (2).pdf'), 'x')
    assert.equal(service.previewFileName(p, student, 'answer-sheet', dir), '预览重名卷_v1_答题卡 (3).pdf')
    assert.equal((await service.exportPaper({ paperId: p, kind: 'answer-sheet', options: student, directory: dir })).filePath, join(dir, '预览重名卷_v1_答题卡 (3).pdf'))
    const edited = structuredClone(scoredSnapshot.sections)
    edited[0].title = '改过'
    saveDraft(db, p, { sections: edited })
    assert.equal(service.previewFileName(p, student, 'paper', dir), '预览重名卷_v2_学生版.pdf', '草稿有改动：预览的是将要新存的 v2')
    assert.equal(service.previewFileName(p, student, 'paper', join(dir, '不存在')), '预览重名卷_v2_学生版.pdf', '保存位置不存在时只给基础文件名')
    assert.equal(getPaper(db, p).latestVersionNo, 1)
  })
  await check('设置页改默认保存位置：目录必须存在，试卷配置原样保留，之后的 getDefaults 读到新位置', async () => {
    const before = service.getDefaults()
    const elsewhere = join(root, 'out-default-dir')
    mkdirSync(elsewhere)
    assert.throws(() => service.setDefaultDirectory(join(root, '没有这个文件夹')), /保存位置不存在/)
    assert.throws(() => service.setDefaultDirectory(undefined as unknown as string), /请先选择保存位置/)
    assert.deepEqual(service.getDefaults(), before, '失败时设置不变')
    assert.deepEqual(service.setDefaultDirectory(elsewhere), { options: before.options, directory: elsewhere })
    assert.deepEqual(service.getDefaults(), { options: before.options, directory: elsewhere })
    service.setDefaultDirectory(before.directory)
  })
  await check('检查接口：试卷与答题卡用同一份数据，kind 不对报错；草稿里的目标满分直接参与比对，目标满分不进版本', async () => {
    assert.equal(service.checkExport(paperId, DEFAULT_EXPORT_OPTIONS, 'answer-sheet').issues.some((i) => i.type === 'score-mismatch'), false, '没设目标满分不检查')
    saveDraft(db, paperId, { sections: getPaper(db, paperId).draft.sections, targetScore: 100 })
    const c = service.checkExport(paperId, DEFAULT_EXPORT_OPTIONS, 'answer-sheet')
    assert.equal(c.kind, 'answer-sheet')
    assert.ok(c.issues.some((i) => i.type === 'score-mismatch'))
    assert.throws(() => service.checkExport(paperId, DEFAULT_EXPORT_OPTIONS, 'bad'), /下载类型不正确/)
    const empty = createPaper(db, '空卷二')
    assert.deepEqual(issueTypes(service.checkExport(empty, DEFAULT_EXPORT_OPTIONS, 'paper')), ['empty-paper'])
  })

  console.log('返工：空大题、题干为空、文件名、保存位置')
  check('空大题：试卷与答题卡都跳过，后面的大题序号顺延，两边标题一致', () => {
    const sections = [section('选择题', items(2, '单选题'), 2), section('填空题', []), section('解答题', [item('解答题-问答题')], 8), section('', []), section('书面表达', [item('书面表达-看图作文')], 10)]
    assert.deepEqual(exportHeadings(sections), ['一、选择题', null, '二、解答题', null, '三、书面表达'])
    const doc = buildExportDocument({ title: 't', sections }, opts())
    assert.deepEqual(doc.sections.map((x) => x.heading), ['一、选择题', '二、解答题', '三、书面表达'])
    assert.deepEqual(doc.sections.map((x) => x.items.map((i) => i.firstNo)), [[1, 2], [3], [4]], '题号不受影响')
    const card = buildCardDocument({ title: 't', sections })
    assert.deepEqual(card.blocks.filter((b) => b.heading).map((b) => b.heading!.title), ['一、选择题', '二、解答题', '三、书面表达'], '答题卡与试卷的大题序号一致')
    assert.doesNotMatch(renderHtml(doc), /填空题/)
  })
  check('下载前检查：题干为空（整块列出每个题号）、大题没有名称、大题没有题目', () => {
    const sections = [
      section('选择题', [item('单选题', { stemHtml: '<p>  </p>' }), item('单选题'), item('完形填空-15空', { numberCount: 2, stemHtml: '<p><br></p>' }), item('单选题', { stemHtml: '<p><img src="ewb-asset://x.png"></p>' })], 2),
      section('  ', [item('填空题')], 2),
      section('填空题', []),
      section('', [])
    ]
    const c = checkDraft({ sections }, opts(), 'paper')
    const stem = c.issues.find((i) => i.type === 'empty-stem')!
    assert.deepEqual([stem.questionNos, stem.questionLabel, stem.blocking], [[1, 3, 4], '1、3、4', false], '只有图片的题干不算空')
    assert.match(stem.message, /^第 1、3、4 题的题干是空的/)
    const unnamed = c.issues.filter((i) => i.type === 'unnamed-section')
    assert.deepEqual(unnamed.map((i) => [i.sectionIndex, i.message]), [[1, '第二大题没有名称，下载出来这一大题的标题只有序号']])
    const empty = c.issues.filter((i) => i.type === 'empty-section')
    assert.deepEqual(empty.map((i) => [i.sectionIndex, i.message]), [[2, '第三大题没有题目，下载时会跳过它，后面的大题序号顺延'], [3, '第四大题没有题目，下载时会跳过它，后面的大题序号顺延']], '没有题目的大题不再另报没有名称')
    assert.equal(c.blocked, false)
    assert.ok(checkDraft({ sections }, opts(), 'answer-sheet').issues.some((i) => i.type === 'empty-stem'), '答题卡同样检查')
    // 正常的卷子没有这几类提示
    assert.equal(checkDraft({ sections: [section('选择题', items(3, '单选题'), 2)] }, opts(), 'paper').issues.length, 0)
  })
  check('文件名：Windows 设备名前面加「_」，控制字符与格式字符（零宽、双向控制符）被去掉', () => {
    const name = (title: string): string => exportFileName(title, 1, DEFAULT_EXPORT_OPTIONS, 'paper')
    assert.equal(name('LPT9.txt'), '_LPT9.txt_v1_学生版.pdf')
    assert.equal(name('con.x'), '_con.x_v1_学生版.pdf')
    assert.equal(name('NUL'), 'NUL_v1_学生版.pdf', '设备名要单独占第一段才是保留名，后面接了「_v1」就不是')
    assert.equal(name('aux .b'), '_aux .b_v1_学生版.pdf', '设备名后面的空格 Windows 也当作它')
    assert.equal(name('COM1.pdf'), '_COM1.pdf_v1_学生版.pdf')
    assert.equal(name('LPT¹.doc'), '_LPT¹.doc_v1_学生版.pdf')
    assert.equal(name('COM0.txt'), 'COM0.txt_v1_学生版.pdf', 'COM0 不是保留名')
    assert.equal(name('CONSOLE.txt'), 'CONSOLE.txt_v1_学生版.pdf')
    assert.equal(exportFileName('LPT9.txt', 1, DEFAULT_EXPORT_OPTIONS, 'answer-sheet'), '_LPT9.txt_v1_答题卡.pdf')
    assert.equal(safeFileTitle('a‮b​c‍d⁠e﻿\u0007f g h\u0085i­j'), 'abcdefghij')
    assert.equal(name('‮evil.pdf'), 'evil.pdf_v1_学生版.pdf')
    assert.equal(safeFileTitle('‮​'), '试卷', '清完没有字符时用默认名')
  })
  await check('保存位置只收完整路径的已有文件夹：「.」「..」、相对路径、空、控制字符、文件都被拒绝并给中文原因', async () => {
    const before = service.getDefaults()
    const cases: [unknown, RegExp][] = [
      ['.', /必须是完整路径/],
      ['..', /必须是完整路径/],
      ['a/b', /必须是完整路径/],
      ['~', /必须是完整路径/],
      ['', /请先选择保存位置/],
      ['   ', /请先选择保存位置/],
      [undefined, /请先选择保存位置/],
      [123, /请先选择保存位置/],
      [{}, /请先选择保存位置/],
      [join(root, 'x\u0000y'), /不能用的字符/],
      [join(root, '没有这个文件夹'), /保存位置不存在/],
      [join(root, 'card-settings.json'), /保存位置不存在/]
    ]
    for (const [value, pattern] of cases) {
      assert.throws(() => service.setDefaultDirectory(value as string), pattern, String(value))
      await assert.rejects(service.exportPaper({ paperId, kind: 'paper', options: DEFAULT_EXPORT_OPTIONS, directory: value as string }), pattern, `下载：${String(value)}`)
    }
    assert.deepEqual(service.getDefaults(), before, '被拒绝时设置不变')
    assert.equal(service.previewFileName(paperId, DEFAULT_EXPORT_OPTIONS, 'paper', '.'), service.previewFileName(paperId, DEFAULT_EXPORT_OPTIONS, 'paper'), '预览遇到相对路径只给基础文件名')
    const settings = join(root, 'relative-settings.json')
    writeFileSync(settings, JSON.stringify({ options: DEFAULT_EXPORT_OPTIONS, directory: '.' }))
    assert.equal(readExportDefaults(settings, outDir).directory, outDir, '设置文件里的相对路径不采用')
  })

  console.log('下载流程：同一版本不同配置的文件名')
  const answered = structuredClone(scoredSnapshot.sections)
  answered.forEach((sec) => sec.items.forEach((i) => (i.answerHtml = '<p>A</p>')))
  const namingDir = join(root, 'out-naming')
  mkdirSync(namingDir)
  const naming = createPaper(db, '命名试卷')
  saveDraft(db, naming, { sections: answered })
  const namePreview = (o: ExportOptions, kind: 'paper' | 'answer-sheet' = 'paper'): string => service.previewFileName(naming, o, kind, namingDir)
  const download = async (o: ExportOptions): Promise<string> => {
    const want = namePreview(o)
    const got = await service.exportPaper({ paperId: naming, kind: 'paper', options: o, directory: namingDir })
    assert.equal(basename(got.filePath), want, '下载前预览的就是最终文件名')
    return want
  }
  await check('默认配置的文件名不变；与已有文件配置不同时用区分它的配置词代替「(2)」，词与弹窗选项原词一致', async () => {
    const student = DEFAULT_EXPORT_OPTIONS
    assert.equal(await download(student), '命名试卷_v1_学生版.pdf')
    assert.equal(await download({ ...student, answerArea: true }), '命名试卷_v1_学生版_留作答区域.pdf')
    assert.equal(await download({ ...student, sourcePosition: 'before-stem' }), '命名试卷_v1_学生版_来源在题文前.pdf')
    assert.equal(await download({ ...student, sourcePosition: 'before-stem', answerArea: true }), '命名试卷_v1_学生版_来源在题文前_留作答区域.pdf')
    const teacher = { ...student, answerPosition: 'end' as const }
    assert.equal(await download(teacher), '命名试卷_v1_教师版.pdf')
    assert.equal(await download({ ...teacher, answerPosition: 'after' }), '命名试卷_v1_教师版_题后.pdf')
    assert.equal(await download({ ...teacher, sourcePosition: 'answer' }), '命名试卷_v1_教师版_来源在答案处.pdf')
    assert.equal(await download({ ...teacher, answerPosition: 'after', sourcePosition: 'answer' }), '命名试卷_v1_教师版_题后_来源在答案处.pdf')
    assert.equal(await download({ ...teacher, format: 'docx' }), '命名试卷_v1_教师版.docx', '扩展名不同本来就不重名')
    assert.equal(await download({ ...teacher, format: 'docx', answerArea: true }), '命名试卷_v1_教师版_留作答区域.docx')
    assert.ok(readdirSync(namingDir).every((n) => !n.includes('(2)')), '没有用到序号')
    // 同一配置再下载仍是原位覆盖，名字不变
    assert.equal(await download({ ...student, answerArea: true }), '命名试卷_v1_学生版_留作答区域.pdf')
    assert.equal(listVersions(db, naming)[0].exports.length, readdirSync(namingDir).length, '每个文件只有一条记录')
  })
  await check('先下载的是非默认配置占了基础名：后来的默认配置写出与它的区别；别处留下的同名文件认不出配置时写自己的非默认项，实在区分不了才用序号', async () => {
    const dir = join(root, 'out-naming2')
    mkdirSync(dir)
    const p = createPaper(db, '区别试卷')
    saveDraft(db, p, { sections: answered })
    const peek = (o: ExportOptions): string => service.previewFileName(p, o, 'paper', dir)
    const go = async (o: ExportOptions): Promise<string> => {
      const want = peek(o)
      assert.equal(basename((await service.exportPaper({ paperId: p, kind: 'paper', options: o, directory: dir })).filePath), want)
      return want
    }
    assert.equal(await go({ ...DEFAULT_EXPORT_OPTIONS, answerArea: true }), '区别试卷_v1_学生版.pdf')
    assert.equal(await go(DEFAULT_EXPORT_OPTIONS), '区别试卷_v1_学生版_不留作答区域.pdf')
    // 别处留下的同名文件：没有下载记录，认不出配置
    writeFileSync(join(dir, '区别试卷_v1_教师版.pdf'), '别人的文件')
    assert.equal(peek({ ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'end' }), '区别试卷_v1_教师版 (2).pdf', '默认配置没有可写的词：回退序号')
    assert.equal(peek({ ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'end', answerArea: true }), '区别试卷_v1_教师版_留作答区域.pdf')
    writeFileSync(join(dir, '区别试卷_v1_教师版_留作答区域.pdf'), '又一个别人的文件')
    assert.equal(peek({ ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'end', answerArea: true }), '区别试卷_v1_教师版 (2).pdf', '带词的名字也被占了：回退序号')
    assert.equal(readFileSync(join(dir, '区别试卷_v1_教师版.pdf'), 'utf8'), '别人的文件')
    // 答题卡只有一种配置，不用词
    assert.equal(peek(DEFAULT_EXPORT_OPTIONS), '区别试卷_v1_学生版_不留作答区域.pdf')
    assert.equal(service.previewFileName(p, DEFAULT_EXPORT_OPTIONS, 'answer-sheet', dir), '区别试卷_v1_答题卡.pdf')
  })

  check('PDF 页数：数 /Type /Page，不算 /Type /Pages；不是 PDF 返回 null', () => {
    const fake = Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Pages /Count 2 /Kids [2 0 R 3 0 R]>>\nendobj\n2 0 obj\n<</Type /Page /Parent 1 0 R>>\nendobj\n3 0 obj\n<</Type /Page\n/Parent 1 0 R>>\nendobj\n')
    assert.equal(countPdfPages(fake), 2)
    assert.equal(countPdfPages(Buffer.from('<html></html>')), null)
    assert.equal(countPdfPages(Buffer.from('%PDF-1.4\n')), null)
  })
}
