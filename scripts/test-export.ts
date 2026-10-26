// 下载规则测试：node scripts/test-export.ts
// 覆盖：白名单解析、题号与大题序号、答案位置 / 来源位置 / 作答区域的全部有效组合、书面表达横线、
// Word 结构（选项制表位无表格框线、卷尾答案分页）、文件命名与覆盖保护、下载与版本、设置记忆。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_EXPORT_OPTIONS, normalizeExportOptions, type ExportOptions, type PaperSnapshot } from '../src/shared/domain.ts'
import { assetPath } from '../src/main/assets.ts'
import { openDatabase } from '../src/main/db.ts'
import { ANSWER_KEY_TITLE, answerAreaKind, buildExportDocument, limitImageHeights, writingLineCount, type ExportDocument } from '../src/main/export/document.ts'
import { TEXT_WIDTH_TWIPS, buildDocx, imageNeeds, type DocxImage } from '../src/main/export/docx.ts'
import { exportFileName, MAX_TITLE_CHARS, pickTargetPath, safeFileTitle } from '../src/main/export/file-name.ts'
import { parseHtml, serializeNodes, textContent, walk, type ElementNode, type HNode } from '../src/main/export/html-tree.ts'
import { MAX_IMAGE_HEIGHT_PX, displaySize, parseImageSource, rasterSize, svgHasIntrinsicSize } from '../src/main/export/image-src.ts'
import { renderCardHtml } from '../src/main/export/render-card-html.ts'
import { renderHtml } from '../src/main/export/render-html.ts'
import { createExportService, type Renderers } from '../src/main/export/service.ts'
import { parseOptions, readExportDefaults, writeExportDefaults } from '../src/main/export/settings.ts'
import { createPaper, getPaper, getVersion, listVersions, saveDraft } from '../src/main/papers/repo.ts'
import { seedDataDir } from './seed-dev.ts'
import { runRound2Tests } from './test-export-card.ts'
import { allValidOptions, optionsLabel, sampleDraft, type SeedQuestion } from './test-export-fixtures.ts'

const root = mkdtempSync(join(tmpdir(), 'ewb-export-test-'))
let passed = 0
function check(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = (): void => {
    passed++
    console.log('  ✓ ' + name)
  }
  const result = fn()
  if (result instanceof Promise) return result.then(done)
  done()
}

const textOfItem = (nodes: HNode[]): string => textContent(nodes).replace(/[ \t\r\n]+/g, ' ').trim()
const count = (s: string, sub: string): number => s.split(sub).length - 1
const findAll = (nodes: HNode[], pred: (n: ElementNode) => boolean): ElementNode[] => {
  const found: ElementNode[] = []
  walk(nodes, (n) => pred(n) && found.push(n))
  return found
}
const SOURCE_MATH = '26-27七年级上·样例市·月考'
const SOURCE_ENGLISH = '26-27七年级上·样例市·阶段检测'

try {
  // ---------- 样例数据：seed-dev 的 6 道题 ----------
  const dataDir = join(root, 'data')
  seedDataDir(dataDir)
  const db = openDatabase(dataDir)
  const questions = (
    db
      .prepare('SELECT id, source_label, question_type, number_count, stem_html, answer_html FROM questions ORDER BY id')
      .all() as unknown as { id: number; source_label: string; question_type: string; number_count: number; stem_html: string; answer_html: string | null }[]
  ).map((r): SeedQuestion => ({ id: r.id, sourceLabel: r.source_label, questionType: r.question_type, numberCount: r.number_count, stemHtml: r.stem_html, answerHtml: r.answer_html }))
  const draft = sampleDraft(questions)
  const snapshot: PaperSnapshot = { title: '七年级数学第一单元测试', sections: draft.sections }
  const build = (o: Partial<ExportOptions>): ExportDocument => buildExportDocument(snapshot, { ...DEFAULT_EXPORT_OPTIONS, ...o })

  console.log('白名单 HTML')
  check('解析后只按白名单序列化：脚本、class、事件属性、未知标签', () => {
    const nodes = parseHtml('<p class="x" onclick="evil()">A &amp; B&nbsp;<b>粗</b><script>alert(1)</script><br><img src="ewb-asset://x.png" width=10 style="color:red"></p><custom>内容</custom>')
    assert.equal(serializeNodes(nodes), '<p>A &amp; B <b>粗</b><br><img src="ewb-asset://x.png" width="10"></p>内容')
  })
  check('实体、数字字符引用、注释与未闭合标签', () => {
    assert.equal(textContent(parseHtml('a&lt;b&#65;&#x42;&hellip;<!-- 注释 -->')), 'a<bAB…')
    assert.equal(serializeNodes(parseHtml('<p>一<p>二')), '<p>一</p><p>二</p>')
    assert.equal(serializeNodes(parseHtml('<table><tr><td>1<td>2<tr><td>3</table>')), '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>')
  })
  check('图片地址：本地图片与内嵌图片可识别，外链不可', () => {
    assert.equal(parseImageSource(`ewb-asset://${'a'.repeat(64)}.svg`)?.kind, 'asset')
    assert.equal(parseImageSource('data:image/png;base64,AAAA')?.kind, 'data')
    assert.equal(parseImageSource('https://img.xkw.com/a.png'), null)
  })

  check('SVG 是否写明宽高；图片显示尺寸与 PDF 的 height:auto 规则一致', () => {
    const svg = (attrs: string): Buffer => Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}><path d="M0 0"/></svg>`)
    assert.equal(svgHasIntrinsicSize(svg('width="52.3pt" height="18pt" viewBox="0 0 70 24"')), true)
    assert.equal(svgHasIntrinsicSize(svg('viewBox="0 0 80 40"')), false)
    assert.equal(svgHasIntrinsicSize(svg('width="100%" height="100%" viewBox="0 0 80 40"')), false)
    assert.equal(svgHasIntrinsicSize(svg('width="20"')), false)
    const natural = { width: 100, height: 50 }
    assert.deepEqual(displaySize({}, natural, 600), { width: 100, height: 50 })
    assert.deepEqual(displaySize({ width: '40', height: '99' }, natural, 600), { width: 40, height: 20 }) // 两个都给：按宽度与自然比例
    assert.deepEqual(displaySize({ height: '25' }, natural, 600), { width: 50, height: 25 })
    assert.deepEqual(displaySize({ width: '1200' }, natural, 600), { width: 600, height: 300 }) // 超宽等比缩小
  })

  console.log('作答区域类型')
  check('先看题目自己的题型标签（组卷网标签原文），标签判断不出类别时再看所在大题的标题', () => {
    const cases: [string, string, string][] = [
      ['选择题（每题 3 分）', '单选题', 'none'],
      ['判断题', '', 'none'],
      ['填空题', '填空题', 'none'],
      ['完形填空', '完形填空', 'none'],
      ['计算题', '', 'calc'],
      ['解答题', '解答题-计算题', 'calc'], // 编辑器自动建的大题名只有大类「解答题」，标签里的「计算」才能让计算题留 36mm
      ['解答题', '解答题-问答题', 'solve'],
      ['解答题', '解答题-作图题', 'solve'],
      ['解答题', '计算题', 'calc'],
      ['综合题', '计算题', 'calc'],
      ['综合题', '证明题', 'solve'],
      ['应用题', '', 'solve'],
      ['简答题', '', 'solve'],
      ['填空题', '解答题', 'solve'], // 题自己的标签优先于所在大题
      ['解答题', '完形填空-15空', 'none'],
      ['解答题', '单项选择-四个选项', 'none'],
      ['书面表达', '', 'writing'],
      ['解答题', '书面表达-看图作文', 'writing'],
      ['计算题', '实验题-测量与探究实验', 'calc'], // 标签认不出类别（实验题不在规则里），回落到大题标题
      ['实验题', '实验题', 'none'],
      ['', '', 'none']
    ]
    for (const [section, type, expected] of cases) assert.equal(answerAreaKind(section, type), expected, `${section}/${type}`)
  })

  console.log('题号、大题序号与来源')
  check('大题标题带序号，全卷题号连续，多小题块占 3 个题号', () => {
    const doc = build({})
    assert.deepEqual(doc.sections.map((s) => s.heading), ['一、选择题（每题 3 分）', '二、填空题', '三、计算题', '四、解答题', '五、完形填空', '六、书面表达'])
    assert.deepEqual(doc.sections.map((s) => [s.items[0].firstNo, s.items[0].lastNo]), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 7], [8, 8]])
    assert.equal(doc.title, '七年级数学第一单元测试')
  })
  check('题号并入第一段，完形填空的小题号占位符按全卷题号填好', () => {
    const doc = build({})
    assert.match(textOfItem(doc.sections[0].items[0].body), /^1\. 下列说法正确的是（　　）/)
    const cloze = textOfItem(doc.sections[4].items[0].body)
    assert.doesNotMatch(cloze, /^\d/) // 多小题块不加块首题号
    assert.match(cloze, /He 5____ from Canada.*likes 6____ very much.*often 7____ basketball/)
    assert.match(cloze, /5\. A\. come.*6\. A\. sport.*7\. A\. play/)
    assert.doesNotMatch(renderHtml(doc), /data-ewb-qno/)
  })
  check('来源「题文前」：单题在题号之后、题干之前；多小题块放在最前面', () => {
    const doc = build({ sourcePosition: 'before-stem' })
    assert.match(textOfItem(doc.sections[0].items[0].body), new RegExp(`^1\\.（${SOURCE_MATH}）下列说法正确的是`))
    assert.match(textOfItem(doc.sections[4].items[0].body), new RegExp(`^（${SOURCE_ENGLISH}）Tom is a new student`))
    const html = renderHtml(doc)
    assert.equal((html.match(/data-role="source"/g) ?? []).length, 6)
  })
  check('来源标签为空时不输出空括号', () => {
    const blank: PaperSnapshot = { ...snapshot, sections: snapshot.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, sourceLabel: '  ' })) })) }
    const doc = buildExportDocument(blank, { ...DEFAULT_EXPORT_OPTIONS, sourcePosition: 'before-stem' })
    assert.doesNotMatch(renderHtml(doc), /（）/)
    assert.match(textOfItem(doc.sections[0].items[0].body), /^1\. 下列说法正确的是/)
  })
  check('来源「不显示」「答案处」时题干里没有来源', () => {
    for (const o of [{ sourcePosition: 'none' as const }, { sourcePosition: 'answer' as const, answerPosition: 'end' as const }]) {
      const doc = build(o)
      for (const s of doc.sections) assert.doesNotMatch(textOfItem(s.items[0].body), /样例市/)
    }
  })

  console.log('答案位置 × 来源 × 作答区域（全部有效组合）')
  const combos = allValidOptions(normalizeExportOptions).filter((o) => o.format === 'pdf')
  check('有效组合数：卷尾 6 + 题后 3 + 不显示 4 = 13', () => {
    assert.equal(combos.length, 13)
    assert.equal(allValidOptions(normalizeExportOptions).length, 26)
  })
  for (const o of combos) {
    check(`组合：${optionsLabel(o)}`, () => {
      const doc = buildExportDocument(snapshot, o)
      const items = doc.sections.map((s) => s.items[0])
      const html = renderHtml(doc)
      assert.equal(doc.edition, o.answerPosition === 'none' ? '学生版' : '教师版')

      // 答案位置
      if (o.answerPosition === 'none') {
        assert.equal(doc.answerKey, null)
        assert.ok(items.every((i) => i.answer === null))
        assert.doesNotMatch(html, /【答案】|参考答案/)
      } else if (o.answerPosition === 'end') {
        assert.ok(items.every((i) => i.answer === null))
        assert.deepEqual(doc.answerKey!.map((r) => r.label), ['1', '2', '3', '5、6、7'])
        assert.match(html, new RegExp(`<h2 class="key-title">${ANSWER_KEY_TITLE}</h2>`))
        assert.ok(html.indexOf('参考答案') > html.indexOf('六、书面表达'), '参考答案在正文之后')
      } else {
        assert.equal(doc.answerKey, null)
        assert.deepEqual(items.map((i) => i.answer !== null), [true, true, true, false, true, false])
        assert.doesNotMatch(html, /参考答案/)
      }

      // 来源位置
      const answerSources = [...doc.sections.flatMap((s) => s.items.flatMap((i) => i.answer ?? [])), ...(doc.answerKey ?? []).flatMap((r) => r.nodes)].filter(
        (n): n is ElementNode => n.type === 'el' && n.attrs['data-role'] === 'answer-source'
      )
      if (o.sourcePosition === 'answer') assert.deepEqual(answerSources.map((n) => textContent(n.children)), [`（${SOURCE_MATH}）`, `（${SOURCE_MATH}）`, `（${SOURCE_MATH}）`, `（${SOURCE_ENGLISH}）`])
      else assert.equal(answerSources.length, 0)
      const stemSources = items.filter((i) => findAll(i.body, (n) => n.attrs['data-role'] === 'source').length > 0)
      assert.equal(stemSources.length, o.sourcePosition === 'before-stem' ? 6 : 0)

      // 作答区域：计算题 36mm、解答题 32mm，答案在题后时整体关闭
      const spaces = items.map((i) => (i.space ? `${i.space.kind}:${i.space.mm}` : null))
      assert.deepEqual(spaces, o.answerArea ? [null, null, 'calc:36', 'solve:32', null, null] : [null, null, null, null, null, null])
      if (o.answerPosition === 'after') assert.equal(doc.options.answerArea, false)

      // 书面表达：作答区域打开时长下划线转成横线行（每行 8mm），否则保持原样
      const lines = findAll(items[5].body, (n) => n.attrs['data-role'] === 'writing-lines')
      if (o.answerArea) {
        assert.equal(lines.length, 1)
        assert.equal(lines[0].children.length, writingLineCount(120))
        assert.doesNotMatch(textOfItem(items[5].body), /_{20}/)
        assert.match(html, /<div data-role="writing-lines"><div data-role="writing-line"><\/div><div data-role="writing-line"><\/div><\/div>/)
      } else {
        assert.equal(lines.length, 0)
        assert.doesNotMatch(html, /<div data-role="writing-lines">/)
        assert.match(textOfItem(items[5].body), /_{100,}/)
      }
      // 填空题保留原题的下划线
      assert.match(serializeNodes(items[1].body), /<u>\u3000{4}<\/u>/)
    })
  }

  console.log('书面表达横线')
  check('横线行数按下划线长度折算，限制在 2～20 行', () => {
    assert.deepEqual([100, 120, 490, 5000].map(writingLineCount), [2, 2, 10, 20])
  })
  check('段落中间的长下划线把段落拆开；短下划线（填空）不动', () => {
    const custom: PaperSnapshot = {
      title: 'T',
      sections: [
        {
          id: 's',
          title: '书面表达',
          items: [
            { id: 'a', originQuestionId: null, sourceLabel: '', questionType: '书面表达', numberCount: 1, stemHtml: `<p>Dear Tom,<br>${'_'.repeat(490)}<br>Yours, Li <u>____</u></p><p>${'＿'.repeat(300)}</p>`, answerHtml: null }
          ]
        }
      ]
    }
    const doc = buildExportDocument(custom, { ...DEFAULT_EXPORT_OPTIONS, answerArea: true })
    const body = doc.sections[0].items[0].body
    assert.deepEqual(
      body.map((n) => (n.type === 'el' ? `${n.tag}${n.attrs['data-role'] ? '#' + n.attrs['data-role'] : ''}:${n.attrs['data-role'] === 'writing-lines' ? n.children.length : ''}` : 'text')),
      ['p:', 'div#writing-lines:10', 'p:', 'div#writing-lines:6']
    )
    assert.equal(textOfItem([body[0]]), '1. Dear Tom,')
    assert.equal(textOfItem([body[2]]), 'Yours, Li ____')
  })

  console.log('内容校验')
  check('没有题目、没有任何答案、图片未本地化都会拒绝', () => {
    assert.throws(() => buildExportDocument({ title: 'T', sections: [{ id: 's', title: '空', items: [] }] }, DEFAULT_EXPORT_OPTIONS), /还没有题目/)
    const noAnswer: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '解答题', items: [{ ...draft.sections[3].items[0] }] }] }
    assert.throws(() => buildExportDocument(noAnswer, { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'end' }), /没有任何带答案的题目/)
    assert.doesNotThrow(() => buildExportDocument(noAnswer, DEFAULT_EXPORT_OPTIONS))
    const foreign: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '解答题', items: [{ ...draft.sections[3].items[0], stemHtml: '<p>x <img src="https://img.xkw.com/a.png"></p>' }] }] }
    assert.throws(() => buildExportDocument(foreign, DEFAULT_EXPORT_OPTIONS), /第 1 题的题干含有未保存到本地的图片/)
  })
  await check('伪造的占位符不报错：非数字的占位元素当普通 span 丢弃，文字里写着的 data-ewb-qno 字样原样显示', () => {
    const forged = '<p>文字 &lt;span data-ewb-qno="0"&gt;&lt;/span&gt; 与 <span data-ewb-qno="x"></span><span  data-ewb-qno="1">有内容</span>结束</p>'
    const snap: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '解答题', items: [{ ...draft.sections[3].items[0], stemHtml: forged, answerHtml: '<p>【答案】<span data-ewb-qno="abc"></span>C</p>' }] }] }
    const doc = buildExportDocument(snap, { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'after' })
    const html = renderHtml(doc)
    assert.doesNotMatch(html, /<span[^>]*data-ewb-qno/, '输出里没有带占位属性的元素')
    assert.match(html, /&lt;span data-ewb-qno="0"&gt;&lt;\/span&gt;/, '文字里的字面串原样显示')
    assert.match(html, /<span>有内容<\/span>结束/, '有内容的伪造占位元素保留内容、去掉属性')
    assert.match(html, /【答案】C/)
    // 真正的占位元素（属性值是数字、内容为空）仍然填成题号
    const real: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '完形填空', items: [{ ...draft.sections[3].items[0], numberCount: 2, stemHtml: '<p>甲<span data-ewb-qno="0"></span>乙<span data-ewb-qno="1"></span></p>' }] }] }
    assert.match(renderHtml(buildExportDocument(real, DEFAULT_EXPORT_OPTIONS)), /甲1乙2/)
  })
  check('同一题目内容在所有组合下都不含白名单之外的标签与属性', () => {
    for (const o of combos) {
      const html = renderHtml(buildExportDocument(snapshot, o))
      assert.doesNotMatch(html, /<script|onerror|onclick|class="question/i)
    }
  })

  console.log('Word 结构')
  const natural = (src: string): DocxImage => {
    const source = parseImageSource(src)!
    if (source.kind === 'asset' && source.ext === 'png') {
      const data = readFileSync(assetPath(dataDir, source.name))
      return { data, type: 'png', ...rasterSize(data, 'png')! }
    }
    const data = readFileSync(assetPath(dataDir, questions.map((q) => q.stemHtml.match(/ewb-asset:\/\/([0-9a-f]{64}\.png)/)?.[1]).find(Boolean)!))
    return { data, type: 'png', width: 64, height: 20 } // SVG 在应用里由隐藏窗口栅格化；测试里用位图代替
  }
  const docxXml = async (o: Partial<ExportOptions>): Promise<string> => {
    const file = join(root, `t-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(file, await buildDocx(build({ ...o, format: 'docx' }), natural))
    return execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  }
  await check('选项用制表位排成一行，不出表格；数据表格才有框线', async () => {
    const xml = await docxXml({})
    assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1, '只有解答题里的数据表格')
    const optionsParagraph = xml.split('</w:p>').find((p) => p.includes('A．①②'))!
    assert.equal((optionsParagraph.match(/<w:tab\/>/g) ?? []).length, 3)
    assert.match(optionsParagraph, /<w:tabs>(<w:tab w:val="left" w:pos="\d+"\/>){3}<\/w:tabs>/)
    assert.match(xml, /w:eastAsia="黑体"/, '标题与大题用黑体')
    assert.match(xml, /w:position w:val="-\d+"/, '与文字同行的公式图下移，半磅整数')
    assert.match(xml, /一、选择题（每题 3 分）/)
    assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 2, '公式图与数轴图')
  })
  await check('同一份内容多次生成，正文 XML 完全一致（重新下载与首次下载对应）', async () => {
    const first = await docxXml({ answerPosition: 'end', answerArea: true })
    const second = await docxXml({ answerPosition: 'end', answerArea: true })
    assert.equal(first, second)
  })
  await check('默认字体：中文宋体、西文 Times New Roman、五号', async () => {
    const file = join(root, 'styles-check.docx')
    writeFileSync(file, await buildDocx(build({ format: 'docx' }), natural))
    const styles = execFileSync('unzip', ['-p', file, 'word/styles.xml'], { encoding: 'utf8' })
    assert.match(styles, /<w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"\/>/)
    assert.match(styles, /<w:sz w:val="21"\/>/)
  })
  await check('卷尾答案另起一页，每题一行，合并题号', async () => {
    const xml = await docxXml({ answerPosition: 'end' })
    assert.equal((xml.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1)
    const keyStart = xml.indexOf('参考答案')
    assert.ok(keyStart > xml.indexOf('六、书面表达'))
    const key = xml.slice(keyStart)
    assert.match(key, /5、6、7/)
    assert.match(key, /【答案】C/)
    assert.doesNotMatch(await docxXml({}), /参考答案/)
  })
  await check('作答区域：计算题留白 36mm、解答题 32mm，书面表达横线逐行带下划线', async () => {
    const xml = await docxXml({ answerArea: true })
    assert.match(xml, /w:line="2041" w:lineRule="exact"/)
    assert.match(xml, /w:line="1814" w:lineRule="exact"/)
    assert.equal((xml.match(/<w:between /g) ?? []).length, 2)
    assert.equal((xml.match(/w:line="454" w:lineRule="exact"/g) ?? []).length, 2)
    assert.doesNotMatch(await docxXml({}), /w:between/)
  })
  await check('题后答案带左侧竖线；来源在答案前', async () => {
    const xml = await docxXml({ answerPosition: 'after', sourcePosition: 'answer' })
    assert.ok((xml.match(/<w:left w:val="single"/g) ?? []).length >= 4)
    assert.match(xml, /（26-27七年级上·样例市·月考）/)
  })
  check('图片清单：同一地址只列一次，取最大显示宽度', () => {
    const needs = imageNeeds(build({}))
    assert.equal(needs.length, 2)
    assert.deepEqual(needs.map((n) => n.wantedWidth).sort(), [64, 96])
  })

  console.log('入库线内容约定')
  const customItem = (stemHtml: string, questionType = '解答题', numberCount = 1) => ({ id: 'c1', originQuestionId: null, sourceLabel: '', questionType, numberCount, stemHtml, answerHtml: null })
  const customDoc = (title: string, stemHtml: string, o: Partial<ExportOptions> = {}, count = 1): { doc: ExportDocument; xml: () => Promise<string> } => {
    const snap: PaperSnapshot = { title: 'T', sections: [{ id: 's', title, items: [customItem(stemHtml, title, count)] }] }
    const options = { ...DEFAULT_EXPORT_OPTIONS, ...o }
    return {
      doc: buildExportDocument(snap, options),
      xml: async () => {
        const file = join(root, `c-${Math.random().toString(36).slice(2)}.docx`)
        writeFileSync(file, await buildDocx(buildExportDocument(snap, { ...options, format: 'docx' }), natural))
        return execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      }
    }
  }
  await check('只有 data-role="bordered" 的数据表画框线，排版表格与选项表没有框线（PDF 与 Word）', async () => {
    const stem = '<p>表：</p><table data-role="bordered"><tr><td>甲</td><td>乙</td></tr></table><table><tr><td>排版</td><td>表格</td></tr></table><table data-role="options"><tr><td>A．1</td><td>B．2</td></tr></table>'
    const { doc, xml } = customDoc('解答题', stem)
    const html = renderHtml(doc)
    assert.match(html, /table\[data-role="bordered"\] td, table\[data-role="bordered"\] th \{ border: /)
    assert.doesNotMatch(html, /\ntd, th \{[^}]*border/, '通用的 td、th 规则不带框线')
    const body = await xml()
    assert.equal(count(body, '<w:tbl>'), 2, '数据表与排版表格都是 Word 表格，选项表不是')
    const borders = [...body.matchAll(/<w:tblBorders>(.*?)<\/w:tblBorders>/g)].map((m) => m[1])
    assert.equal(borders.length, 2)
    assert.match(borders[0], /w:val="single"/)
    assert.doesNotMatch(borders[1], /w:val="single"/)
    assert.match(borders[1], /w:val="none"/)
  })
  await check('着重号输出为 <em data-role="dot">：PDF 用着重点且不斜体，Word 用着重号且不加斜体；普通 em 仍是斜体', async () => {
    const { doc, xml } = customDoc('填空题', '<p>请<em data-role="dot">注意</em>这个词，<em>斜体</em>另算。</p>')
    const html = renderHtml(doc)
    assert.match(html, /<em data-role="dot">注意<\/em>/)
    assert.match(html, /em\[data-role="dot"\] \{ font-style: normal; text-emphasis: filled dot; text-emphasis-position: under; \}/)
    const body = await xml()
    const run = (text: string): string => body.split('</w:r>').find((r) => r.includes(`>${text}<`))!
    assert.match(run('注意'), /<w:em w:val="underDot"\/>/)
    assert.doesNotMatch(run('注意'), /<w:i\/>/)
    assert.match(run('斜体'), /<w:i\/>/)
  })
  await check('右对齐段落 p[data-role="right-aligned"]：PDF 与 Word 都右对齐，其他段落不受影响', async () => {
    const { doc, xml } = customDoc('解答题', '<p>正文</p><p data-role="right-aligned">（本题 8 分）</p>')
    assert.match(renderHtml(doc), /<p data-role="right-aligned">（本题 8 分）<\/p>/)
    assert.match(renderHtml(doc), /p\[data-role="right-aligned"\] \{ text-align: right; \}/)
    const body = await xml()
    const paras = body.split('</w:p>')
    assert.match(paras.find((p) => p.includes('本题 8 分'))!, /<w:jc w:val="right"\/>/)
    assert.doesNotMatch(paras.find((p) => p.includes('>1.<'))!, /<w:jc /)
  })
  await check('书面表达的 <div data-role="writing-lines">（里面是原下划线文本）：加作答区域折成横线行，不加则还原成可折行的段落', async () => {
    const stem = `<p>请以「我的学校」为题写一篇短文。</p><div data-role="writing-lines">${'_'.repeat(490)}</div>`
    const on = customDoc('书面表达', stem, { answerArea: true })
    const lines = findAll(on.doc.sections[0].items[0].body, (n) => n.attrs['data-role'] === 'writing-lines')
    assert.equal(lines.length, 1)
    assert.equal(lines[0].children.length, 10, '490 个下划线折成 10 行')
    assert.doesNotMatch(textOfItem(on.doc.sections[0].items[0].body), /_{20}/)
    assert.equal(count(await on.xml(), '<w:between '), 10)
    const off = customDoc('书面表达', stem, { answerArea: false })
    assert.equal(findAll(off.doc.sections[0].items[0].body, (n) => n.attrs['data-role'] === 'writing-lines').length, 0)
    assert.match(textOfItem(off.doc.sections[0].items[0].body), /_{490}/, '下划线原样保留')
    assert.match(renderHtml(off.doc), /overflow-wrap: anywhere/, 'PDF 里长下划线会折行，不会缩成一行')
    assert.equal(count(await off.xml(), '<w:between '), 0)
    // 大题不是书面表达时（题被拖进别的大题），即使加作答区域也保持原样
    const elsewhere = customDoc('填空题', stem, { answerArea: true })
    assert.match(textOfItem(elsewhere.doc.sections[0].items[0].body), /_{490}/)
  })
  await check('多小题块：小题号占位符出现在选项表的号码格与填空横线里，也按全卷题号填好；Word 里号码格与选项制表位对齐', async () => {
    const stem =
      '<p>阅读短文。<span data-ewb-qno="0"></span>题<u><span data-ewb-qno="1"></span>　　　</u></p>' +
      '<table data-role="options"><tr><td data-role="option-label"><span data-ewb-qno="0"></span>.</td><td>A．come</td><td>B．comes</td><td>C．coming</td><td>D．came</td></tr></table>' +
      '<table data-role="options"><tr><td data-role="option-label"><span data-ewb-qno="1"></span>.</td><td>A．one</td><td>B．two</td><td>C．three</td><td>D．four</td></tr></table>'
    const snap: PaperSnapshot = {
      title: 'T',
      sections: [
        { id: 's0', title: '单选题', items: [customItem('<p>前面一道</p>', '单选题')] },
        { id: 's1', title: '完形填空', items: [customItem(stem, '完形填空-2空', 2)] }
      ]
    }
    const doc = buildExportDocument(snap, DEFAULT_EXPORT_OPTIONS)
    const html = renderHtml(doc)
    assert.doesNotMatch(html, /data-ewb-qno/)
    assert.match(html, /<td data-role="option-label">2\.<\/td>/)
    assert.match(html, /<td data-role="option-label">3\.<\/td>/)
    assert.match(html, /阅读短文。2题<u>3\u3000{3}<\/u>/)
    const file = join(root, 'labels.docx')
    writeFileSync(file, await buildDocx(doc, natural))
    const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' })
    const para = xml.split('</w:p>').find((p) => p.includes('>2.<') && p.includes('A．come'))!
    assert.equal(count(para, '<w:tab/>'), 4, '号码后 1 个制表位 + 选项之间 3 个')
    assert.match(para, /<w:ind w:left="\d+" w:hanging="\d+"\/>/)
    assert.equal(count(xml, '<w:tbl>'), 0, '选项表没有 Word 表格')
  })

  console.log('评审问题回归')
  await check('XML 不允许的控制字符（标题、大题名、来源、题干、答案、数字字符引用里）被清掉，Word 文件的各部分仍是合法 XML', async () => {
    const bad = '\u0001\u0008\u000b\u000c\u001f￾￿\ud800'
    const snap: PaperSnapshot = {
      title: `卷${bad}名`,
      sections: [
        {
          id: 's',
          title: `大题${bad}名`,
          items: [
            {
              ...customItem(`<p>题${bad}干&#1;&#x1f;&#11;</p><table data-role="bordered"><tr><td>格${bad}</td></tr></table>`),
              sourceLabel: `来源${bad}`,
              answerHtml: `<p>答${bad}案</p>`
            }
          ]
        }
      ]
    }
    const illegal = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿\ud800]/
    for (const o of [{ answerPosition: 'end', sourcePosition: 'answer' }, { answerPosition: 'after', sourcePosition: 'before-stem' }, { answerPosition: 'none', sourcePosition: 'none' }] as const) {
      const doc = buildExportDocument(snap, { ...DEFAULT_EXPORT_OPTIONS, ...o })
      const html = renderHtml(doc)
      assert.doesNotMatch(html, illegal)
      assert.match(html, /卷名/)
      assert.match(html, /一、大题名/)
      assert.match(html, /题干/)
      const file = join(root, `ctl-${Math.random().toString(36).slice(2)}.docx`)
      writeFileSync(file, await buildDocx(doc, natural))
      for (const part of ['word/document.xml', 'word/styles.xml', 'docProps/core.xml', 'word/footer1.xml']) {
        const xml = execFileSync('unzip', ['-p', file, part], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        assert.doesNotMatch(xml, illegal, part)
        execFileSync('xmllint', ['--noout', '-'], { input: xml }) // 不是合法 XML 会抛错
      }
      assert.match(execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' }), /卷名/)
    }
  })
  check('制表符、换行等合法字符不受清理影响（折成空格）', () => {
    const doc = buildExportDocument({ title: 'T', sections: [{ id: 's', title: '解答题', items: [customItem('<p>甲\t乙\n丙</p>')] }] }, DEFAULT_EXPORT_OPTIONS)
    assert.match(textOfItem(doc.sections[0].items[0].body), /甲 乙 丙/)
  })
  check('下载配置只保留四个字段，多余字段不进下载记录与设置文件', () => {
    const parsed = parseOptions({ answerPosition: 'end', sourcePosition: 'none', format: 'pdf', answerArea: true, extra: '<script>', __proto__x: 1 })
    assert.deepEqual(Object.keys(parsed).sort(), ['answerArea', 'answerPosition', 'format', 'sourcePosition'])
    const file = join(root, 'whitelist', 'export-settings.json')
    writeExportDefaults(file, { options: { ...parsed, extra: 'x' } as ExportOptions, directory: root })
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).options).sort(), ['answerArea', 'answerPosition', 'format', 'sourcePosition'])
    writeFileSync(file, JSON.stringify({ options: { ...parsed, extra: 'y' }, directory: root }))
    assert.deepEqual(Object.keys(readExportDefaults(file, root).options).sort(), ['answerArea', 'answerPosition', 'format', 'sourcePosition'])
  })
  check('没有答案内容的题记在 missingAnswers 里（答案位置不是不显示时），多小题块用题号范围', () => {
    assert.deepEqual(build({ answerPosition: 'end' }).missingAnswers, ['4', '8'])
    assert.deepEqual(build({ answerPosition: 'after' }).missingAnswers, ['4', '8'])
    assert.deepEqual(build({ answerPosition: 'none' }).missingAnswers, [])
    const range: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '完形填空', items: [customItem('<p>前</p>'), { ...customItem('<p>组</p>', '完形填空', 3), answerHtml: null }, { ...customItem('<p>尾</p>'), answerHtml: '<p>【答案】A</p>' }] }] }
    assert.deepEqual(buildExportDocument(range, { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'end' }).missingAnswers, ['1', '2～4'])
    const emptyAnswer: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '解答题', items: [{ ...customItem('<p>x</p>'), answerHtml: '<p>　</p>' }, { ...customItem('<p>y</p>'), answerHtml: '<p>【答案】B</p>' }] }] }
    assert.deepEqual(buildExportDocument(emptyAnswer, { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'after' }).missingAnswers, ['1'], '只有空白的答案算没有答案')
  })
  await check('图片显示高度不超过 215mm：Word 里等比缩小，PDF 写回缩小后的宽高；矮图不动', async () => {
    assert.deepEqual(displaySize({}, { width: 700, height: 1500 }, 650, MAX_IMAGE_HEIGHT_PX), { width: Math.round(((700 * MAX_IMAGE_HEIGHT_PX) / 1500) * 100) / 100, height: MAX_IMAGE_HEIGHT_PX })
    assert.deepEqual(displaySize({ width: '900', height: '3200' }, { width: 900, height: 3200 }, 650, MAX_IMAGE_HEIGHT_PX).height, MAX_IMAGE_HEIGHT_PX)
    assert.deepEqual(displaySize({}, { width: 300, height: 200 }, 650, MAX_IMAGE_HEIGHT_PX), { width: 300, height: 200 })
    const png = (name: string): string => `ewb-asset://${name.repeat(64).slice(0, 64)}.png`
    const tall = png('a')
    const wide = png('b')
    const small = png('c')
    const answer = `<p>【答案】</p><p><img src="${tall}"></p><p><img src="${wide}"></p><p><img src="${small}"></p>`
    const snap: PaperSnapshot = { title: 'T', sections: [{ id: 's', title: '解答题', items: [{ ...customItem('<p>题</p>'), answerHtml: answer }] }] }
    const sizes: Record<string, { width: number; height: number }> = { [tall]: { width: 700, height: 1500 }, [wide]: { width: 900, height: 3200 }, [small]: { width: 300, height: 200 } }
    const doc = buildExportDocument(snap, { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'end' })
    const lookup = (src: string): DocxImage => ({ data: readFileSync(assetPath(dataDir, questions.map((q) => q.stemHtml.match(/ewb-asset:\/\/([0-9a-f]{64}\.png)/)?.[1]).find(Boolean)!)), type: 'png', ...sizes[src] })
    const file = join(root, 'tall.docx')
    writeFileSync(file, await buildDocx(doc, lookup))
    const extents = [...execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' }).matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => [Number(m[1]) / 9525, Number(m[2]) / 9525])
    assert.equal(extents.length, 3)
    assert.ok(extents.every(([, h]) => h <= MAX_IMAGE_HEIGHT_PX + 0.01), `Word 里每张图高度都不超过 ${MAX_IMAGE_HEIGHT_PX}px：${JSON.stringify(extents)}`)
    assert.ok(Math.abs(extents[0][1] / extents[0][0] - 1500 / 700) < 0.01, '等比缩小')
    assert.deepEqual(extents[2].map(Math.round), [300, 200], '矮图不动')
    // PDF：把缩小后的宽高写回属性
    const changed = limitImageHeights(doc, (src) => sizes[src] ?? null, TEXT_WIDTH_TWIPS / 15)
    assert.equal(changed, 2)
    const html = renderHtml(doc)
    assert.match(html, new RegExp(`<img src="${tall}" width="${Math.round((700 * MAX_IMAGE_HEIGHT_PX) / 1500)}" height="${MAX_IMAGE_HEIGHT_PX}">`))
    assert.match(html, new RegExp(`<img src="${wide}" width="${Math.round((900 * MAX_IMAGE_HEIGHT_PX) / 3200)}" height="${MAX_IMAGE_HEIGHT_PX}">`))
    assert.match(html, new RegExp(`<img src="${small}">`))
  })
  await check('Word：题号所在的第一段与下一段同页，卷尾答案每题一行不拆页，有留白的整题与留白同页', async () => {
    const xml = await docxXml({})
    const first = xml.split('</w:p>').find((p) => p.includes('>1.<'))!
    assert.match(first, /<w:keepNext\/>/)
    const second = xml.split('</w:p>').find((p) => p.includes('则 a 一定是负数') || p.includes('若 '))!
    assert.doesNotMatch(second, /<w:keepNext\/>/)
    const withSpace = await docxXml({ answerArea: true })
    const calc = withSpace.split('</w:p>').find((p) => p.includes('计算：'))!
    assert.match(calc, /<w:keepNext\/>/, '计算题的题干与它后面的留白同页')
    const after = await docxXml({ answerPosition: 'after' })
    assert.match(after.split('</w:p>').find((p) => p.includes('计算：'))!, /<w:keepNext\/>/, '答案紧跟在题后时，题干最后一块与答案同页')
    const end = await docxXml({ answerPosition: 'end' })
    assert.ok(count(end, '<w:cantSplit/>') >= 4 + 2, '卷尾答案 4 行与解答题数据表 2 行都不拆页')
  })

  console.log('文件命名与覆盖保护')
  check('去掉 Windows 不允许的字符、限制长度', () => {
    assert.equal(safeFileTitle('七年级/数学:第一单元*测试?"<>|\\'), '七年级数学第一单元测试')
    assert.equal(safeFileTitle('  . '), '试卷')
    assert.equal(safeFileTitle('a'.repeat(200)).length, MAX_TITLE_CHARS)
    assert.equal(safeFileTitle('测试卷...'), '测试卷')
    assert.equal(exportFileName('七年级数学第一单元测试', 3, { ...DEFAULT_EXPORT_OPTIONS }, 'paper'), '七年级数学第一单元测试_v3_学生版.pdf')
    assert.equal(exportFileName('T', 1, { ...DEFAULT_EXPORT_OPTIONS, answerPosition: 'after', format: 'docx' }, 'paper'), 'T_v1_教师版.docx')
  })
  check('同名文件存在时加序号；同版本同配置的结果可以原位覆盖', () => {
    const taken = new Set(['/d/x_v1_学生版.pdf', '/d/x_v1_学生版 (2).pdf'])
    assert.equal(pickTargetPath('/d', 'x_v1_学生版.pdf', (p) => taken.has(p), () => false), '/d/x_v1_学生版 (3).pdf')
    assert.equal(pickTargetPath('/d', 'x_v1_学生版.pdf', (p) => taken.has(p), (p) => p === '/d/x_v1_学生版 (2).pdf'), '/d/x_v1_学生版 (2).pdf')
    assert.equal(pickTargetPath('/d', 'y.pdf', (p) => taken.has(p), () => false), '/d/y.pdf')
  })

  console.log('设置记忆')
  check('首次使用取默认值；写入后读回；保存位置消失时回到默认；文件损坏时回到默认', () => {
    const file = join(root, 'settings', 'export-settings.json')
    const downloads = join(root, 'Downloads')
    mkdirSync(downloads, { recursive: true })
    assert.deepEqual(readExportDefaults(file, downloads), { options: DEFAULT_EXPORT_OPTIONS, directory: downloads })
    const chosen = join(root, 'chosen')
    mkdirSync(chosen)
    const options: ExportOptions = { answerPosition: 'end', sourcePosition: 'answer', format: 'docx', answerArea: true }
    writeExportDefaults(file, { options, directory: chosen })
    assert.deepEqual(readExportDefaults(file, downloads), { options, directory: chosen })
    rmSync(chosen, { recursive: true })
    assert.equal(readExportDefaults(file, downloads).directory, downloads)
    writeFileSync(file, '{坏的')
    assert.deepEqual(readExportDefaults(file, downloads), { options: DEFAULT_EXPORT_OPTIONS, directory: downloads })
    assert.throws(() => parseOptions({ answerPosition: 'x' }), /下载配置不正确/)
    assert.equal(parseOptions({ answerPosition: 'after', sourcePosition: 'none', format: 'pdf', answerArea: true }).answerArea, false)
  })

  console.log('下载流程（渲染器用替身，版本与记录用真实数据库）')
  const outDir = join(root, 'out')
  mkdirSync(outDir)
  const settingsFile = join(root, 'svc-settings.json')
  const rendered: { html?: string; docx?: string }[] = []
  // 测试用的钩子：生成前执行（让生成失败，或在生成期间改草稿）
  let beforeRender: (() => void) | null = null
  const renderers: Renderers = {
    pdf: async (doc) => {
      const hook = beforeRender
      beforeRender = null
      hook?.()
      const html = renderHtml(doc)
      rendered.push({ html })
      return Buffer.from(html)
    },
    docx: async (doc) => {
      rendered.push({ docx: JSON.stringify(doc) })
      return Buffer.from(JSON.stringify(doc))
    },
    card: async (doc) => Buffer.from(renderCardHtml(doc))
  }
  const getVersionText = (id: number): string => JSON.stringify(getVersion(db, listVersions(db, id)[0].id).snapshot)
  const service = createExportService({ db: () => db, dataDir: () => dataDir, settingsFile: () => settingsFile, defaultDirectory: () => outDir, renderers })
  const paperId = createPaper(db, '七年级数学第一单元测试')
  saveDraft(db, paperId, draft)
  const student = { ...DEFAULT_EXPORT_OPTIONS }
  const files = (): string[] => readdirSync(outDir).sort()

  await check('预览文件名：没有版本时是 v1；首次下载存 v1', async () => {
    assert.equal(service.previewFileName(paperId, student, 'paper'), '七年级数学第一单元测试_v1_学生版.pdf')
    const result = await service.exportPaper({ paperId, kind: 'paper', options: student, directory: outDir })
    assert.deepEqual({ ...result, filePath: undefined }, { kind: 'paper', versionNo: 1, filePath: undefined, overwritten: false, createdVersion: true, pageCount: null, missingAnswers: [] })
    assert.equal(result.filePath, join(outDir, '七年级数学第一单元测试_v1_学生版.pdf'))
    assert.deepEqual(files(), ['七年级数学第一单元测试_v1_学生版.pdf'])
    const versions = listVersions(db, paperId)
    assert.equal(versions[0].note, '下载时自动保存')
    assert.equal(versions[0].origin, 'download')
    assert.equal(versions[0].exports.length, 1)
  })
  await check('内容不变再下载仍是 v1，同版本同配置原位覆盖，不产生新版本', async () => {
    assert.equal(service.previewFileName(paperId, student, 'paper'), '七年级数学第一单元测试_v1_学生版.pdf')
    const again = await service.exportPaper({ paperId, kind: 'paper', options: student, directory: outDir })
    assert.deepEqual({ versionNo: again.versionNo, createdVersion: again.createdVersion, overwritten: again.overwritten }, { versionNo: 1, createdVersion: false, overwritten: true })
    assert.deepEqual(files(), ['七年级数学第一单元测试_v1_学生版.pdf'])
    assert.equal(listVersions(db, paperId).length, 1)
    assert.equal(listVersions(db, paperId)[0].exports.length, 1, '同一文件的再次下载只更新原记录，不多出一条')
  })
  await check('同名但配置不同时用区分它的配置词，不覆盖原文件', async () => {
    const withArea = await service.exportPaper({ paperId, kind: 'paper', options: { ...student, answerArea: true }, directory: outDir })
    assert.equal(withArea.filePath, join(outDir, '七年级数学第一单元测试_v1_学生版_留作答区域.pdf'))
    assert.equal(withArea.overwritten, false)
    const teacher = await service.exportPaper({ paperId, kind: 'paper', options: { ...student, answerPosition: 'end', format: 'docx' }, directory: outDir })
    assert.equal(teacher.filePath, join(outDir, '七年级数学第一单元测试_v1_教师版.docx'))
    assert.equal(files().length, 3)
    assert.doesNotMatch(readFileSync(join(outDir, '七年级数学第一单元测试_v1_学生版.pdf'), 'utf8'), /<div class="answer-space"/)
    assert.match(readFileSync(withArea.filePath, 'utf8'), /<div class="answer-space"/)
    assert.equal(listVersions(db, paperId).length, 1)
  })
  await check('改草稿后预览与下载都是 v2，旧文件与旧版本不动', async () => {
    const changed = structuredClone(draft)
    changed.sections[2].items[0].stemHtml = '<p>计算：(−3)² + |−7|</p>'
    saveDraft(db, paperId, changed)
    assert.equal(service.previewFileName(paperId, student, 'paper'), '七年级数学第一单元测试_v2_学生版.pdf')
    const result = await service.exportPaper({ paperId, kind: 'paper', options: student, directory: outDir })
    assert.deepEqual({ versionNo: result.versionNo, createdVersion: result.createdVersion }, { versionNo: 2, createdVersion: true })
    assert.equal(result.filePath, join(outDir, '七年级数学第一单元测试_v2_学生版.pdf'))
    assert.match(readFileSync(result.filePath, 'utf8'), /\(−3\)²/)
    assert.doesNotMatch(readFileSync(join(outDir, '七年级数学第一单元测试_v1_学生版.pdf'), 'utf8'), /\(−3\)²/)
    assert.deepEqual(listVersions(db, paperId).map((v) => v.versionNo), [2, 1])
  })
  await check('按下载记录重新下载：回到原版本原配置，文件内容与首次一致', async () => {
    const v1 = listVersions(db, paperId).find((v) => v.versionNo === 1)!
    const first = v1.exports.find((e) => e.filePath.endsWith('七年级数学第一单元测试_v1_学生版.pdf'))!
    const before = readFileSync(first.filePath)
    const result = await service.reexport(first.id)
    assert.deepEqual({ versionNo: result.versionNo, createdVersion: result.createdVersion, overwritten: result.overwritten }, { versionNo: 1, createdVersion: false, overwritten: true })
    assert.equal(result.filePath, first.filePath)
    assert.ok(before.equals(readFileSync(result.filePath)), '重新下载的内容与首次一致')
    assert.equal(listVersions(db, paperId).find((v) => v.versionNo === 1)!.exports.length, v1.exports.length, '重新下载同一个文件只更新原记录，不多出一条')
    // 教师版 docx 的记录同样能还原
    const docxRecord = v1.exports.find((e) => e.format === 'docx')!
    const again = await service.reexport(docxRecord.id)
    assert.equal(again.filePath, docxRecord.filePath)
    assert.equal(again.versionNo, 1)
  })
  check('只允许在文件夹中显示下载记录里出现过的文件', () => {
    assert.equal(service.isRecordedPath(join(outDir, '七年级数学第一单元测试_v1_学生版.pdf')), true)
    assert.equal(service.isRecordedPath('/etc/hosts'), false)
    assert.equal(service.isRecordedPath(join(outDir, '..', 'data', 'workbench.db')), false)
  })
  await check('下载后记住配置与保存位置', async () => {
    await service.exportPaper({ paperId, kind: 'paper', options: { ...student, answerPosition: 'after', sourcePosition: 'answer', format: 'docx' }, directory: outDir })
    assert.deepEqual(service.getDefaults(), { options: { answerPosition: 'after', sourcePosition: 'answer', format: 'docx', answerArea: false }, directory: outDir })
  })
  await check('出错时不留多余版本：没有答案的教师版、保存位置不存在、图片文件丢失', async () => {
    const solo = createPaper(db, '只有一道题')
    saveDraft(db, solo, { sections: [{ ...draft.sections[3], items: [draft.sections[3].items[0]] }] })
    await assert.rejects(service.exportPaper({ paperId: solo, kind: 'paper', options: { ...student, answerPosition: 'end' }, directory: outDir }), /没有任何带答案的题目/)
    await assert.rejects(service.exportPaper({ paperId: solo, kind: 'paper', options: student, directory: join(outDir, '不存在') }), /保存位置不存在/)
    assert.equal(listVersions(db, solo).length, 0)

    const withImage = createPaper(db, '带图试卷')
    const lost = `ewb-asset://${'0'.repeat(64)}.png`
    saveDraft(db, withImage, { sections: [{ id: 's', title: '解答题', items: [{ ...draft.sections[3].items[0], stemHtml: `<p>图 <img src="${lost}"></p>` }] }] })
    await assert.rejects(service.exportPaper({ paperId: withImage, kind: 'paper', options: student, directory: outDir }), /1 张图片的文件找不到/)
    assert.equal(listVersions(db, withImage).length, 0)
    assert.equal(readdirSync(outDir).filter((n) => n.endsWith('.tmp')).length, 0)
  })
  await check('同时发起的两次下载按顺序执行，版本号不冲突', async () => {
    const racing = createPaper(db, '并发试卷')
    saveDraft(db, racing, draft)
    const [a, b] = await Promise.all([
      service.exportPaper({ paperId: racing, kind: 'paper', options: student, directory: outDir }),
      service.exportPaper({ paperId: racing, kind: 'paper', options: { ...student, format: 'docx' }, directory: outDir })
    ])
    assert.deepEqual([a.versionNo, a.createdVersion, b.versionNo, b.createdVersion], [1, true, 1, false])
    assert.equal(getPaper(db, racing).latestVersionNo, 1)
  })

  await check('生成失败、保存位置不能写，都不留下没有下载记录的版本', async () => {
    const orphan = createPaper(db, '孤儿版本试卷')
    saveDraft(db, orphan, draft)
    beforeRender = () => {
      throw new Error('生成 PDF 超时')
    }
    await assert.rejects(service.exportPaper({ paperId: orphan, kind: 'paper', options: student, directory: outDir }), /生成 PDF 超时/)
    assert.equal(listVersions(db, orphan).length, 0, '生成失败：没有版本')
    if (process.getuid?.() !== 0) {
      const readOnly = join(root, 'read-only')
      mkdirSync(readOnly)
      chmodSync(readOnly, 0o555)
      try {
        await assert.rejects(service.exportPaper({ paperId: orphan, kind: 'paper', options: student, directory: readOnly }), /无法保存|没有写入权限/)
      } finally {
        chmodSync(readOnly, 0o755)
      }
      assert.equal(listVersions(db, orphan).length, 0, '保存位置不能写：没有版本')
    }
    assert.equal(readdirSync(outDir).filter((n) => n.startsWith('.ewb-')).length, 0, '没有残留的临时文件')
    const ok = await service.exportPaper({ paperId: orphan, kind: 'paper', options: student, directory: outDir })
    assert.deepEqual([ok.versionNo, ok.createdVersion], [1, true])
  })
  await check('生成期间草稿又被改了：文件按存下的版本重新生成，内容与版本一致', async () => {
    const live = createPaper(db, '边下边改试卷')
    saveDraft(db, live, draft)
    const edited = structuredClone(draft)
    edited.sections[2].items[0].stemHtml = '<p>生成途中改过：(−9)² + 1</p>'
    beforeRender = () => saveDraft(db, live, edited)
    const r = await service.exportPaper({ paperId: live, kind: 'paper', options: student, directory: outDir })
    assert.equal(r.versionNo, 1)
    const text = readFileSync(r.filePath, 'utf8')
    assert.match(text, /生成途中改过/, '文件是按存下的版本（含这次修改）生成的')
    assert.match(getVersionText(live), /生成途中改过/)
  })
  await check('缺答案提示：下载结果与下载前检查都列出没有答案的题；多余的配置字段不进下载记录与设置文件', async () => {
    const teacher = { ...student, answerPosition: 'end' as const }
    const partial = service.checkExport(paperId, teacher, 'paper').issues.find((i) => i.type === 'partial-answers')!
    assert.deepEqual([partial.questionNos, partial.questionLabel, partial.blocking], [[4, 8], '4、8', false])
    assert.equal(service.checkExport(paperId, student, 'paper').issues.some((i) => i.type === 'partial-answers' || i.type === 'no-answers'), false)
    const r = await service.exportPaper({ paperId, kind: 'paper', options: { ...teacher, extra: '<script>' } as ExportOptions, directory: outDir })
    assert.deepEqual(r.missingAnswers, ['4', '8'])
    const latest = listVersions(db, paperId).flatMap((v) => v.exports).find((e) => e.filePath === r.filePath)!
    assert.deepEqual(Object.keys(latest.options).sort(), ['answerArea', 'answerPosition', 'format', 'sourcePosition'])
    const raw = db.prepare('SELECT options_json FROM exports WHERE file_path = ?').get(r.filePath) as { options_json: string }
    assert.doesNotMatch(raw.options_json, /script|extra/)
    assert.doesNotMatch(readFileSync(settingsFile, 'utf8'), /script|extra/)
    const again = await service.reexport(latest.id)
    assert.deepEqual(again.missingAnswers, ['4', '8'])
    // 没有任何答案时仍然报错
    const none = createPaper(db, '全无答案')
    saveDraft(db, none, { sections: [{ ...draft.sections[3], items: [draft.sections[3].items[0]] }] })
    const noneCheck = service.checkExport(none, teacher, 'paper')
    assert.deepEqual([noneCheck.blocked, noneCheck.answerMissingCount, noneCheck.questionCount], [true, 1, 1])
    assert.equal(noneCheck.issues[0].type, 'no-answers')
    await assert.rejects(service.exportPaper({ paperId: none, kind: 'paper', options: teacher, directory: outDir }), /没有任何带答案的题目/)
  })

  // 第二轮：答题卡、抬头与分值、Word 页脚与测宽、下载前自检。检查函数共用，通过项计入总数
  await runRound2Tests({ check, db, dataDir, root })

  db.close()
  console.log(`下载规则测试通过：${passed} 项`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
