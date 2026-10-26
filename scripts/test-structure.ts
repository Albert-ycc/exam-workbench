// 试卷结构与分值算法测试：npm run test:structure
import assert from 'node:assert/strict'
import { boxScoreLabel, formatScore, hasVisibleContent, itemScoreNote, MAX_NUMBER_COUNT, normalizeScore, numberItems, paperItemNote, paperSectionNote, paperTotalNote, sectionScoreNote, structureOf } from '../src/shared/numbering.ts'
import type { DraftSection, LibraryQuestion, PaperItem } from '../src/shared/domain.ts'
import { appendQuestions } from '../src/shared/draft.ts'

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log('  ✓ ' + name)
}
const item = (id: string, extra: Partial<PaperItem> = {}): PaperItem => ({ id, originQuestionId: null, sourceLabel: '', questionType: '单选题', numberCount: 1, stemHtml: id, answerHtml: '<p>A</p>', ...extra })

const sections: DraftSection[] = [
  { id: 's1', title: '选择题', defaultScore: 4, items: [item('1'), item('2'), item('3')] },
  { id: 's2', title: '完形填空', defaultScore: 1, items: [item('c', { numberCount: 15, answerHtml: null })] },
  { id: 's3', title: '解答题', items: [item('17', { score: 8 }), item('18', { score: 10.5 }), item('19', { answerHtml: '  ' })] },
  { id: 's4', title: '空大题', defaultScore: 5, items: [] }
]

check('题数按题号计：完形填空 15 空算 15 题', () => {
  const s = structureOf(sections)
  assert.deepEqual(s.sections.map((x) => x.questionCount), [3, 15, 3, 0])
  assert.deepEqual(s.sections.map((x) => x.blockCount), [3, 1, 3, 0])
  assert.equal(s.questionCount, 21)
  assert.deepEqual([s.sections[1].firstNo, s.sections[1].lastNo], [4, 18])
  assert.deepEqual([s.sections[3].firstNo, s.sections[3].lastNo], [null, null])
})

check('分值：单题覆盖优先于大题默认；块合计 = 每小题 × 小题数；0.5 分不产生浮点误差', () => {
  const s = structureOf(sections)
  assert.equal(s.sections[0].totalScore, 12)
  assert.equal(s.sections[0].perScore, 4)
  assert.equal(s.sections[1].totalScore, 15)
  assert.equal(s.sections[2].totalScore, 18.5)
  assert.deepEqual(s.sections[2].unscoredNos, [21])
  assert.equal(s.totalScore, 45.5)
  assert.equal(s.allScored, false)
  assert.deepEqual(s.unscoredNos, [21])
  const tenths = structureOf([{ id: 'x', title: '', defaultScore: 0.1 + 0.2, items: Array.from({ length: 3 }, (_, i) => item(String(i))) }])
  assert.equal(tenths.totalScore, 1.5, '0.3 取整到 0.5 步长后 ×3')
})

check('缺答案按题号列出（空白答案也算缺）', () => {
  const s = structureOf(sections)
  assert.deepEqual(s.missingAnswerNos, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21])
})

check('大题分值说明三种写法', () => {
  const s = structureOf(sections)
  assert.equal(sectionScoreNote(s.sections[0]), '（共 3 小题，每小题 4 分，共 12 分）')
  assert.equal(sectionScoreNote(s.sections[1]), '（共 15 小题，每小题 1 分，共 15 分）')
  assert.equal(sectionScoreNote(s.sections[2]), '（共 3 小题）', '没设全分值只写题数')
  assert.equal(sectionScoreNote(s.sections[3]), '')
  const mixed = structureOf([{ id: 'm', title: '解答题', items: [item('a', { score: 8 }), item('b', { score: 6 })] }])
  assert.equal(sectionScoreNote(mixed.sections[0]), '（共 2 小题，满分 14 分）')
})

check('单题分值标注与全卷满分', () => {
  assert.equal(itemScoreNote(sections[0].items[0], sections[0]), '（本题 4 分）')
  assert.equal(itemScoreNote(sections[1].items[0], sections[1]), '（每小题 1 分，共 15 分）')
  assert.equal(itemScoreNote(sections[2].items[2], sections[2]), '')
  // 试卷正文的紧凑写法：数字两侧不留空格，题后的分值用半角括号；答题卡仍用带空格的写法
  const s = structureOf(sections)
  assert.equal(paperSectionNote(s.sections[0]), '（共3小题，每小题4分，共12分）')
  assert.equal(paperSectionNote(s.sections[2]), '（共3小题）')
  assert.equal(paperItemNote(sections[0].items[0], sections[0]), '(本题4分)')
  assert.equal(paperItemNote(sections[1].items[0], sections[1]), '(每小题1分，共15分)')
  assert.equal(paperItemNote(sections[2].items[2], sections[2]), '')
  assert.equal(paperTotalNote(structureOf(sections)), '', '有未设分值的题不写全卷满分')
  const full = structureOf(sections.slice(0, 2))
  assert.equal(paperTotalNote(full), '（全卷满分：27分）')
})

check('分值规整：非数字、负数、超过 999 视为未设；按 0.5 取整；显示去掉 .0', () => {
  assert.equal(normalizeScore('4'), null)
  assert.equal(normalizeScore(-1), null)
  assert.equal(normalizeScore(1000), null)
  assert.equal(normalizeScore(Number.NaN), null)
  assert.equal(normalizeScore(2.74), 2.5)
  assert.equal(normalizeScore(2.76), 3)
  assert.equal(formatScore(4), '4')
  assert.equal(formatScore(4.5), '4.5')
})

check('结构与题号算法一致', () => {
  const nos = numberItems(sections)
  const s = structureOf(sections)
  assert.equal(nos[nos.length - 1].lastNo, s.questionCount)
})

check('答案要有看得见的内容才算有：空段落、空白、&nbsp; 都算缺', () => {
  assert.equal(hasVisibleContent('<p></p><p> </p>'), false)
  assert.equal(hasVisibleContent('<p>&nbsp;</p>'), false)
  assert.equal(hasVisibleContent('<p><img src="ewb-asset://x.png"></p>'), true)
  assert.equal(hasVisibleContent('<p>A</p>'), true)
  const s = structureOf([{ id: 'x', title: '', items: [item('a', { answerHtml: '<p>&nbsp;</p>' }), item('b', { answerHtml: '<img src="a">' })] }])
  assert.deepEqual(s.missingAnswerNos, [1])
})

check('答题卡框头分值：单题「（8 分）」，多小题块写每小题与合计', () => {
  assert.equal(boxScoreLabel(sections[2].items[0], sections[2]), '（8 分）')
  assert.equal(boxScoreLabel(sections[1].items[0], sections[1]), '（每小题 1 分，共 15 分）')
  assert.equal(boxScoreLabel(sections[2].items[2], sections[2]), '')
})

check('异常的超大小题数被截到上限，不会展开出百万个题号', () => {
  const s = structureOf([{ id: 'x', title: '', items: [item('huge', { numberCount: 10_000_000 })] }])
  assert.equal(s.questionCount, MAX_NUMBER_COUNT)
})

check('加入试卷：按题型大类找大题，找不到新建；草稿上的目标满分保留', () => {
  const q = (id: number, type: string): LibraryQuestion => ({ id, zujuanQid: null, sourcePaperId: null, sourcePaperTitle: '', sourceLabel: '', sourceOrder: 0, questionType: type, numberCount: 1, stemHtml: 'x', answerHtml: null, createdAt: '', chapterId: null, knowledge: [], difficulty: null, tags: [] })
  const base = { sections: [{ id: 's1', title: '选择题', items: [item('a', { questionType: '单选题' })] }], targetScore: 100 }
  const { draft, placed } = appendQuestions(base, [q(1, '单选题'), q(2, '解答题-计算题'), q(3, '解答题-问答题')])
  assert.equal(draft.targetScore, 100)
  assert.equal(draft.sections.length, 2)
  assert.equal(draft.sections[0].items.length, 2, '同大类进已有大题')
  assert.equal(draft.sections[1].title, '解答题')
  assert.equal(draft.sections[1].items.length, 2, '第二道解答题进刚新建的解答题大题')
  assert.deepEqual(placed.map((p) => p.questionId), [1, 2, 3])
})

console.log(`试卷结构与分值测试通过：${passed} 项`)
