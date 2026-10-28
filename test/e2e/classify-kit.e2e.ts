// 归类组件端到端测试（第三轮组件样板）：把 src/renderer/src/components/classify 的全部组件打成一个只用于测试的样张页，
// 放进应用主窗口（带真实预加载接口），不进正式界面。
// 一、样张截图（1440×900 与 1000×640 各一遍）：四个筛选块在左栏宽度与 compact 宽度、200 个知识点展开滚动、空状态；
//    TagPicker 的空列表 / 批量半选 / 搜索中 / 出现「新建」/ 超长提示；TagManagerModal 的列表 / 行内改名 / 合并确认 / 删除确认
// 二、行为断言：切换发出的数组、章节自动展开、知识点分组与搜索与展开全部、难度中性样式、打标签的新建流程（新名、同名不分大小写、超长、
//    全角空格、输入法组词）、键盘 ↑↓ 回车、管理弹窗的改名 / 合并 / 删除 / 报错、各宽度下没有横向滚动
// 用法：node test/e2e/classify-kit.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Locator, Page } from 'playwright'
import { build } from 'vite'
import { buildTo, launchApp, ROOT } from '../../scripts/e2e/app.ts'
import { evidenceDir } from '../../scripts/temp-dir.ts'

const evidence = evidenceDir(process.argv[2], 'ewb-classify-kit-')

// ---------- 样张页 ----------
const harness = join(ROOT, 'node_modules/.cache/ewb-classify-harness')
rmSync(harness, { recursive: true, force: true })
mkdirSync(join(harness, 'src'), { recursive: true })
writeFileSync(
  join(harness, 'src/index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>归类组件样张</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ewb-asset:" />
</head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`
)
writeFileSync(
  join(harness, 'src/gallery.css'),
  String.raw`
/* 让文档本身滚动：比窗口还高的元素截图才不会被裁在视口里 */
html, body, #root { height: auto; min-height: 100%; }
.g-root { min-height: 100vh; padding: 20px 28px 80px; background: var(--desk); }
.g-sec { background: var(--paper); border: 1px solid var(--rule); padding: 14px 20px 20px; margin: 0 0 16px; width: fit-content; min-width: 600px; max-width: 1080px; }
.g-sec > h3 { margin: 0 0 12px; font: 700 15px var(--song); letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid var(--ink); }
.g-pair { display: flex; gap: 32px; align-items: flex-start; }
.g-cap { margin: 0 0 6px; font-size: 12px; color: var(--mute); }
.g-ctl { display: flex; gap: 8px; margin: 0 0 8px; }
/* 试题库左栏：LibraryPage.css 的 grid 第一列 248px，筛选栏自带 16px 内边距 */
.g-rail { width: 248px; flex: none; height: auto; overflow: auto; box-shadow: 0 0 0 1px var(--rule); }
/* 编辑器题库栏「更多筛选」弹层：宽约 320px，用真实的 ui-popover 外观 */
.g-compact { position: static; width: 320px; max-height: none; overflow: visible; flex: none; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.g-bare { width: 320px; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.g-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
.g-row > .g-k { width: 110px; font-size: 12px; color: var(--ink-2); flex: 0 0 auto; }
`
)

writeFileSync(
  join(harness, 'src/main.tsx'),
  String.raw`import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Popover, ToastHost, toast } from '../../../../src/renderer/src/components/ui'
import { ChapterFilter, DifficultyFilter, KnowledgeFilter, TagFilter, TagManagerModal, TagPicker } from '../../../../src/renderer/src/components/classify'
import { normalizeClassName, type Chapter, type DifficultyKey, type Tag, type TagRef, type TagRenameResult } from '@shared/classify'
import type { KnowledgeCount } from '@shared/library'
import '../../../../src/renderer/src/styles.css'
import '../../../../src/renderer/src/pages/LibraryPage.css'
import './gallery.css'

// ---------- 数据：真实名称 ----------
const chapter = (id: number, parentId: number | null, name: string, position: number): Chapter => ({ id, parentId, name, position, count: 0 })
const LONG_CHAPTER = Array.from('第四章 一元一次方程在行程问题工程问题销售问题中的应用综合训练专题').slice(0, 30).join('')
const CHAPTERS: Chapter[] = [
  chapter(11, null, '第一章 有理数', 0),
  chapter(12, 11, '1.1 正数和负数', 0),
  chapter(13, 11, '1.2 有理数', 1),
  chapter(14, 11, '1.3 数轴', 2),
  chapter(21, null, '第二章 整式的加减', 1),
  chapter(22, 21, '2.1 整式', 0),
  chapter(23, 21, '2.2 整式的加减', 1),
  chapter(31, null, '第三章 一元一次方程', 2),
  chapter(41, null, LONG_CHAPTER, 3),
  chapter(42, 41, '4.1 行程问题', 0)
]
const CHAPTER_COUNTS = new Map<number, number>([[0, 7], [11, 18], [12, 6], [13, 8], [14, 4], [21, 9], [22, 5], [23, 4], [41, 2], [42, 2]]) // 31 没有题：变淡

const kp = (id: number, name: string, subject: string, count: number): KnowledgeCount => ({ id, name, subject, count })
const BASE_KNOWLEDGE: KnowledgeCount[] = [
  kp(4718, '求一个数的绝对值', 'czsx', 18), kp(4740, '倒数', 'czsx', 15), kp(4731, '有理数加法运算', 'czsx', 14), kp(91001, '细节理解', 'czyy', 12),
  kp(4713, '相反数的定义', 'czsx', 12), kp(4717, '绝对值的几何意义', 'czsx', 11), kp(4763, '含乘方的有理数混合运算', 'czsx', 9), kp(4708, '用数轴上的点表示有理数', 'czsx', 8),
  kp(4755, '有理数的乘方运算', 'czsx', 7), kp(91002, '说明文', 'czyy', 7), kp(4748, '两个有理数的乘法运算', 'czsx', 6), kp(4703, '有理数的定义', 'czsx', 6),
  kp(91003, '记叙文', 'czyy', 6), kp(4705, '有理数的分类', 'czsx', 5), kp(5725, '举反例', 'czsx', 4), kp(4720, '绝对值非负性', 'czsx', 3),
  kp(4723, '有理数大小比较', 'czsx', 3), kp(17881, '人称代词的宾格', 'czyy', 3), kp(4715, '化简多重符号', 'czsx', 2), kp(4732, '有理数加法中的符号问题', 'czsx', 2),
  kp(147306, '元音字母的发音', 'czyy', 2), kp(4741, '有理数乘法运算律', 'czsx', 1), kp(147873, '单词的读音', 'czyy', 1)
]
// 再造 177 个凑成 200 个，测内部滚动
const MATH_TOPICS = ['有理数', '整式', '一元一次方程', '几何图形', '数据的收集', '相交线与平行线', '实数', '二元一次方程组', '不等式', '三角形']
const MATH_ASPECTS = ['的概念', '的运算', '的实际应用', '的性质', '的化简求值', '的综合', '与图形', '的比较', '的规律探究', '的数形结合', '的分类讨论', '的错解辨析', '的建模', '的估算']
const ENGLISH_TOPICS = ['定语从句', '宾语从句', '状语从句', '非谓语动词', '时态与语态', '情态动词', '介词辨析', '冠词用法', '形容词比较级', '代词辨析']
const ENGLISH_ASPECTS = ['的判断', '的应用', '易错点', '专项']
const EXTRA: KnowledgeCount[] = []
for (const t of MATH_TOPICS) for (const a of MATH_ASPECTS) EXTRA.push(kp(100000 + EXTRA.length, t + a, 'czsx', 0))
EXTRA.length = 137
for (const t of ENGLISH_TOPICS) for (const a of ENGLISH_ASPECTS) EXTRA.push(kp(100000 + EXTRA.length, t + a, 'czyy', 0))
EXTRA.forEach((item, i) => { item.count = Math.max(1, 10 - Math.floor(i / 20)) })
const BIG_KNOWLEDGE = [...BASE_KNOWLEDGE, ...EXTRA].sort((a, b) => b.count - a.count)

const LONG_TAG = Array.from('七年级上册第一单元月考易错题整理汇总再加一点').slice(0, 20).join('')
const tag = (id: number, name: string, count: number): Tag => ({ id, name, count })
const FILTER_TAGS: Tag[] = [tag(1, '易错', 12), tag(2, '压轴', 5), tag(3, '期中复习', 9), tag(4, LONG_TAG, 2), tag(5, '培优', 0)]
const TAG_COUNTS = new Map<number, number>([[1, 12], [2, 5], [3, 9], [4, 2]])
const DIFFICULTIES: { key: DifficultyKey; count: number }[] = [{ key: 'easy', count: 24 }, { key: 'medium', count: 31 }, { key: 'hard', count: 3 }]

const w = window as unknown as { __log: string[]; __toast: typeof toast }
w.__log = []
w.__toast = toast
const say = (text: string): void => { w.__log.push(text) }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const fold = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase())

interface SetData {
  chapters: Chapter[]
  chapterCounts: Map<number, number>
  difficulties: { key: DifficultyKey; count: number }[]
  knowledge: KnowledgeCount[]
  tags: Tag[]
  tagCounts: Map<number, number>
}
// 15 个标签（多于 12 个出搜索框），题数故意乱序：同一题数按原顺序，0 题的排最后
const SORT_TAGS: Tag[] = [tag(21, '甲', 0), tag(22, '乙', 3), tag(23, '丙', 7), tag(24, '丁', 3), tag(25, '戊', 0), tag(26, '己', 9), tag(27, '庚', 1), tag(28, '辛', 5), tag(29, '壬', 2), tag(30, '癸', 0), tag(31, '子', 4), tag(32, '丑', 8), tag(33, '寅', 6), tag(34, '卯', 1), tag(35, '辰', 2)]
const WRAP_NAME = '含有多个符号的有理数混合运算与绝对值化简综合应用' // 24 字：左栏宽度下两行放得下
const WRAP_KNOWLEDGE: KnowledgeCount[] = [kp(5001, WRAP_NAME, 'czsx', 3), kp(5002, '倒数', 'czsx', 2)]
const FULL: SetData = { chapters: CHAPTERS, chapterCounts: CHAPTER_COUNTS, difficulties: DIFFICULTIES, knowledge: BASE_KNOWLEDGE, tags: FILTER_TAGS, tagCounts: TAG_COUNTS }
const EMPTY: SetData = { chapters: [], chapterCounts: new Map(), difficulties: [], knowledge: [], tags: [], tagCounts: new Map() }

// 一整套筛选块：state 自己管，每次 onChange 记日志
function FilterSet({ id, compact, bare, data, only, selected, ext, filtered }: { id: string; compact?: boolean; bare?: boolean; data: SetData; only?: 'knowledge' | 'tags'; filtered?: boolean; selected?: { chap?: number[]; diff?: DifficultyKey[]; know?: number[]; tags?: number[] }; ext?: boolean }) {
  const [chap, setChap] = useState<number[]>(selected?.chap ?? [])
  const [diff, setDiff] = useState<DifficultyKey[]>(selected?.diff ?? [])
  const [know, setKnow] = useState<number[]>(selected?.know ?? [])
  const [tagIds, setTagIds] = useState<number[]>(selected?.tags ?? [])
  return (
    <div data-set={id}>
      {ext && (
        <div className="g-ctl">
          <Button size="sm" data-testid="ext-chapter" onClick={() => setChap((list) => [...list, 23])}>外部选中 2.2</Button>
        </div>
      )}
      <div className={bare ? 'g-bare' : compact ? 'ui-popover g-compact' : 'lb-filter g-rail'}>
        {only === undefined && (
          <ChapterFilter compact={compact} chapters={data.chapters} counts={data.chapterCounts} selected={chap}
            onChange={(next) => { setChap(next); say(id + ':chapters:' + JSON.stringify(next)) }} onManage={() => say(id + ':manage-chapter')} />
        )}
        {only === undefined && (
          <DifficultyFilter compact={compact} filtered={filtered} items={data.difficulties} selected={diff} onChange={(next) => { setDiff(next); say(id + ':difficulty:' + JSON.stringify(next)) }} />
        )}
        {only !== 'tags' && <KnowledgeFilter compact={compact} filtered={filtered} items={data.knowledge} selected={know} onChange={(next) => { setKnow(next); say(id + ':knowledge:' + JSON.stringify(next)) }} />}
        {only !== 'knowledge' && (
          <TagFilter compact={compact} tags={data.tags} counts={data.tagCounts} selected={tagIds}
            onChange={(next) => { setTagIds(next); say(id + ':tags:' + JSON.stringify(next)) }} onManage={() => say(id + ':manage-tag')} />
        )}
      </div>
    </div>
  )
}

// 假的标签后端：改名、合并、删除都和真实接口同口径，重新读数据比回调晚一会儿（测「不闪回旧名」）
function useFakeTags(initial: Tag[], prefix: string) {
  const [tags, setTags] = useState<Tag[]>(initial)
  const next = useRef(100)
  const current = useRef(tags)
  current.current = tags
  const later = (update: (list: Tag[]) => Tag[]): void => { setTimeout(() => setTags(update), 250) }
  return {
    tags,
    async create(name: string): Promise<TagRef> {
      say(prefix + 'create:' + name)
      await sleep(40)
      if (name === '出错') throw new Error("Error invoking remote method 'library:create-tag': Error: 标签名「出错」暂不可用")
      const clean = normalizeClassName(name, 20)
      const same = current.current.find((t) => fold(t.name) === fold(clean))
      if (same) return { id: same.id, name: same.name }
      const created = { id: next.current++, name: clean, count: 0 }
      setTags((list) => [...list, created])
      return { id: created.id, name: created.name }
    },
    async rename(id: number, name: string): Promise<TagRenameResult> {
      say(prefix + 'rename:' + id + ':' + name)
      await sleep(60)
      if (name === '出错') throw new Error("Error invoking remote method 'library:rename-tag': Error: 标签名「出错」暂不可用")
      const from = current.current.find((t) => t.id === id)!
      const clean = normalizeClassName(name, 20)
      const other = current.current.find((t) => t.id !== id && fold(t.name) === fold(clean))
      if (other) {
        later((list) => list.filter((t) => t.id !== id).map((t) => (t.id === other.id ? { ...t, count: t.count + from.count } : t)))
        return { id, mergedInto: other.id }
      }
      later((list) => list.map((t) => (t.id === id ? { ...t, name: clean } : t)))
      return { id, mergedInto: null }
    },
    async remove(id: number): Promise<void> {
      say(prefix + 'delete:' + id)
      await sleep(60)
      later((list) => list.filter((t) => t.id !== id))
    }
  }
}

const PICK_TAGS: Tag[] = [tag(1, '易错', 12), tag(2, '压轴', 5), tag(3, '期中复习', 9), tag(4, LONG_TAG, 2), tag(5, 'Mock', 3), tag(6, '培优', 0)]
const MANY_TAGS: Tag[] = Array.from({ length: 80 }, (_, i) => tag(1000 + i, '第' + (i + 1) + '单元易错题', i % 7))
const MANAGER_TAGS: Tag[] = [tag(1, '易错', 3), tag(2, '压轴', 5), tag(3, '好题', 2), tag(4, '期中复习', 9), tag(5, LONG_TAG, 2), tag(6, '培优', 0), tag(7, 'Mock', 1)]
const PAPER_TAGS: Tag[] = [tag(1, '七年级1班', 4), tag(2, '第一章', 3), tag(3, '月考', 2)]

// 勾选状态：和真实页面一样，切换后这个标签不再是「部分有」
function useSel(checked: number[], mixed: number[] = []) {
  const [state, setState] = useState({ checked: new Set(checked), mixed: new Set(mixed) })
  return {
    checked: state.checked as ReadonlySet<number>,
    mixed: state.mixed as ReadonlySet<number>,
    toggle: (prefix: string) => (t: TagRef, on: boolean): void => {
      say(prefix + 'toggle:' + t.id + ':' + on)
      setState((s) => {
        const c = new Set(s.checked)
        const m = new Set(s.mixed)
        m.delete(t.id)
        if (on) c.add(t.id)
        else c.delete(t.id)
        return { checked: c, mixed: m }
      })
    }
  }
}

function Gallery() {
  const picker = useFakeTags(PICK_TAGS, 'picker:')
  const pickSel = useSel([1], [2, 5])
  const many = useFakeTags(MANY_TAGS, 'many:')
  const manySel = useSel([])
  const questionTags = useFakeTags(MANAGER_TAGS, 'q:')
  const paperTags = useFakeTags(PAPER_TAGS, 'p:')
  const noTags = useFakeTags([], 'none:')
  const paperSel = useSel([1])
  const noneSel = useSel([])
  const [open, setOpen] = useState<'' | 'questions' | 'papers' | 'none'>('')

  return (
    <div className="g-root" id="gallery">
      <section className="g-sec" data-gallery="filters">
        <h3>四个筛选块：试题库左栏宽度（左）与编辑器「更多筛选」弹层宽度（右）</h3>
        <div className="g-pair">
          <FilterSet id="rail" data={FULL} ext selected={{ chap: [13, 21], diff: ['medium'], know: [4718], tags: [1] }} />
          <FilterSet id="compact" compact data={FULL} selected={{ chap: [13, 21], diff: ['medium'], know: [4718], tags: [1] }} />
        </div>
      </section>

      <section className="g-sec" data-gallery="more">
        <h3>放进真实 Popover 的「更多筛选」（编辑器题库栏的用法）</h3>
        <div className="g-row">
          <span className="g-k">Popover</span>
          <Popover trigger={<Button data-testid="open-more">更多筛选</Button>} label="更多筛选" align="start">
            {() => <FilterSet id="more" compact bare data={FULL} />}
          </Popover>
        </div>
      </section>

      <section className="g-sec" data-gallery="knowledge-big">
        <h3>知识点 200 个：展开全部后内部滚动</h3>
        <div className="g-pair">
          <FilterSet id="big-rail" only="knowledge" data={{ ...FULL, knowledge: BIG_KNOWLEDGE }} />
          <FilterSet id="big-compact" compact only="knowledge" data={{ ...FULL, knowledge: BIG_KNOWLEDGE }} />
        </div>
      </section>

      <section className="g-sec" data-gallery="many-tags">
        <h3>标签 15 个（题数乱序）：有题的在前、0 题在后，多于 12 个带搜索框；左栏里不设内框，compact 里 120px 内框</h3>
        <div className="g-pair">
          <FilterSet id="sort-rail" only="tags" data={{ ...FULL, tags: SORT_TAGS, tagCounts: new Map(SORT_TAGS.map((t) => [t.id, t.count])) }} />
          <FilterSet id="sort-compact" compact only="tags" data={{ ...FULL, tags: SORT_TAGS, tagCounts: new Map(SORT_TAGS.map((t) => [t.id, t.count])) }} />
        </div>
      </section>

      <section className="g-sec" data-gallery="wrap">
        <h3>知识点名称：24 字在左栏宽度下换两行显示，不用省略号截掉后缀</h3>
        <div className="g-pair">
          <FilterSet id="wrap-rail" only="knowledge" data={{ ...FULL, knowledge: WRAP_KNOWLEDGE }} />
          <FilterSet id="wrap-compact" compact only="knowledge" data={{ ...FULL, knowledge: WRAP_KNOWLEDGE }} />
        </div>
      </section>

      <section className="g-sec" data-gallery="empty-filtered">
        <h3>页面有其他筛选条件、难度与知识点被筛空：写「当前条件下没有可选的…」</h3>
        <div className="g-pair">
          <FilterSet id="filtered-rail" filtered data={EMPTY} />
        </div>
      </section>

      <section className="g-sec" data-gallery="empty">
        <h3>空状态：没有章节、难度、知识点、标签</h3>
        <div className="g-pair">
          <FilterSet id="empty-rail" data={EMPTY} />
          <FilterSet id="empty-compact" compact data={EMPTY} />
        </div>
      </section>

      <section className="g-sec" data-gallery="picker">
        <h3>打标签小框（放进 Popover）</h3>
        <div className="g-row">
          <span className="g-k">TagPicker</span>
          <Popover trigger={<Button data-testid="open-picker">批量：易错全有，压轴 Mock 部分有</Button>} label="打标签" align="start">
            {({ close }) => (
              <TagPicker tags={picker.tags} checked={pickSel.checked} mixed={pickSel.mixed} onToggle={pickSel.toggle('picker:')} onCreate={picker.create}
                onManage={() => { say('picker:manage'); close() }} />
            )}
          </Popover>
          <Popover trigger={<Button data-testid="open-picker-empty">还没有任何标签</Button>} label="打标签" align="start">
            {() => <TagPicker tags={noTags.tags} checked={noneSel.checked} onToggle={noneSel.toggle('none:')} onCreate={noTags.create} onManage={() => say('none:manage')} />}
          </Popover>
          <Popover trigger={<Button data-testid="open-picker-bulk">批量：所选 12 道</Button>} label="打标签" align="start">
            {() => (
              <TagPicker tags={PICK_TAGS} checked={new Set([1])} mixed={new Set([2, 5])} counts={new Map([[1, 12], [2, 4], [5, 1], [3, 0], [4, 0]])} selectionSize={12} onToggle={(t, on) => say('bulk:toggle:' + t.id + ':' + on)} onCreate={picker.create} />
            )}
          </Popover>
          <Popover trigger={<Button data-testid="open-picker-remove">去标签：只列所选带着的</Button>} label="去标签" align="start">
            {() => (
              <TagPicker tags={PICK_TAGS.slice(0, 2)} checked={new Set([1])} mixed={new Set([2])} counts={new Map([[1, 12], [2, 4]])} selectionSize={12} allowCreate={false} onToggle={(t, on) => say('remove:toggle:' + t.id + ':' + on)} />
            )}
          </Popover>
          <Popover trigger={<Button data-testid="open-picker-many">80 个标签</Button>} label="打标签" align="start">
            {() => <TagPicker tags={many.tags} checked={manySel.checked} onToggle={manySel.toggle('many:')} onCreate={many.create} />}
          </Popover>
          <Popover trigger={<Button data-testid="open-picker-paper">试卷标签（份试卷）</Button>} label="打标签" align="start">
            {() => <TagPicker unit="份试卷" tags={paperTags.tags} checked={paperSel.checked} onToggle={paperSel.toggle('paper:')} onCreate={paperTags.create} />}
          </Popover>
        </div>
      </section>

      <section className="g-sec" data-gallery="manager">
        <h3>管理标签弹窗</h3>
        <div className="g-row">
          <span className="g-k">TagManagerModal</span>
          <Button data-testid="open-manager" onClick={() => setOpen('questions')}>管理标签（道题）</Button>
          <Button data-testid="open-manager-papers" onClick={() => setOpen('papers')}>管理试卷标签（份试卷）</Button>
          <Button data-testid="open-manager-empty" onClick={() => setOpen('none')}>没有标签</Button>
        </div>
      </section>

      {open === 'questions' && <TagManagerModal title="管理标签" unit="道题" tags={questionTags.tags} onRename={questionTags.rename} onDelete={questionTags.remove} onClose={() => setOpen('')} />}
      {open === 'papers' && <TagManagerModal title="管理试卷标签" unit="份试卷" tags={paperTags.tags} onRename={paperTags.rename} onDelete={paperTags.remove} onClose={() => setOpen('')} />}
      {open === 'none' && <TagManagerModal title="管理标签" unit="道题" tags={[]} onRename={noTags.rename} onDelete={noTags.remove} onClose={() => setOpen('')} />}
      <ToastHost />
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Gallery />)
`
)
await build({
  root: join(harness, 'src'),
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@shared': join(ROOT, 'src/shared') } },
  build: { outDir: join(harness, 'dist'), emptyOutDir: true }
})

buildTo('out-kit3')
const { app, window } = await launchApp({ outDir: 'out-kit3' })
const pageErrors: string[] = []
window.on('pageerror', (error) => pageErrors.push('pageerror: ' + error.message))
window.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push('console: ' + message.text())
})
const ok = (name: string): void => console.log('  ✓ ' + name)
const galleryFile = join(harness, 'dist/index.html')
let sizeTag = '1440x900'
const shot = (target: Locator | Page, name: string) => target.screenshot({ path: join(evidence, `${name}-${sizeTag}.png`) })
const settle = (ms = 120) => window.waitForTimeout(ms)
const logOf = (): Promise<string[]> => window.evaluate(() => (window as unknown as { __log: string[] }).__log.slice())
const lastLog = async (): Promise<string> => (await logOf()).at(-1) ?? ''
const logCount = async (): Promise<number> => (await logOf()).length

async function resize(width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
  await window.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height])
  sizeTag = `${width}x${height}`
}
async function loadGallery(): Promise<void> {
  await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), galleryFile)
  await window.locator('#gallery').waitFor()
  await settle(200)
}

const setOf = (id: string): Locator => window.locator(`[data-set="${id}"]`)
const blockOf = (set: Locator, title: string): Locator => set.getByRole('region', { name: title, exact: true })
const itemOf = (scope: Locator, name: string): Locator => scope.locator('button.cf-item').filter({ has: window.locator(`span:text-is("${name}")`) })
const chipOf = (scope: Locator, name: string): Locator => scope.locator('button.cf-chip').filter({ has: window.locator(`span:text-is("${name}")`) })
const rowTexts = (scope: Locator): Promise<string[]> => scope.locator('.cf-item > span').allInnerTexts()
const hasClass = (locator: Locator, name: string): Promise<boolean> => locator.evaluate((el, cls) => el.classList.contains(cls), name)
const overflowing = (locator: Locator): Promise<boolean> => locator.evaluate((el) => el.scrollWidth > el.clientWidth + 0.5)

// 容器里所有可见元素的右边缘都不超过容器内容区，且没有横向滚动条
async function assertNoHorizontalScroll(container: Locator, label: string): Promise<void> {
  const result = await container.evaluate((root) => {
    const bad: string[] = []
    const check = (el: Element, name: string): void => {
      const h = el as HTMLElement
      if (h.scrollWidth > h.clientWidth + 0.5) bad.push(name + ' 横向可滚动 ' + h.scrollWidth + '>' + h.clientWidth)
    }
    check(root, 'root')
    root.querySelectorAll('.cf-scroll, .cf-pinned, .cf-picker-list').forEach((el) => check(el, el.className))
    const box = root.getBoundingClientRect()
    const cs = getComputedStyle(root)
    const right = box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
    root.querySelectorAll('.cf-row, .cf-chip, .cf-prow, .cf-search, .cf-note').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > right + 0.5) bad.push((el.className as string) + ' 超出右边缘 ' + (r.right - right).toFixed(1) + 'px')
    })
    return bad
  })
  assert.deepEqual(result, [], label + '：不应有横向滚动或超出')
}

try {
  // =====================================================================================
  // 一、样张截图（两个窗口尺寸各一遍）
  // =====================================================================================
  for (const [width, height] of [[1440, 900], [1000, 640]] as const) {
    await resize(width, height)
    await loadGallery()

    const rail = setOf('rail').locator('.g-rail')
    const compact = setOf('compact').locator('.ui-popover')
    await shot(rail, 'filters-rail')
    await shot(compact, 'filters-compact')

    // 把第二章、长章节名都展开，看整棵树（含 0 题变淡、30 字长名省略）
    await blockOf(setOf('rail'), '章节').getByRole('button', { name: '展开第二章 整式的加减' }).click()
    await blockOf(setOf('rail'), '章节').getByRole('button', { name: /^展开第四章/ }).click()
    await shot(blockOf(setOf('rail'), '章节'), 'chapters-expanded-rail')
    await blockOf(setOf('compact'), '章节').getByRole('button', { name: '展开第二章 整式的加减' }).click()
    await blockOf(setOf('compact'), '章节').getByRole('button', { name: /^展开第四章/ }).click()
    await shot(blockOf(setOf('compact'), '章节'), 'chapters-expanded-compact')

    // 真实悬停 + 键盘聚焦
    await chipOf(blockOf(setOf('rail'), '标签'), '压轴').focus()
    await window.keyboard.press('Shift+Tab')
    await window.keyboard.press('Tab')
    await itemOf(blockOf(setOf('rail'), '知识点'), '倒数').hover()
    await shot(rail, 'filters-rail-hover-focus')
    await window.mouse.move(700, 4)

    // 200 个知识点展开
    for (const id of ['big-rail', 'big-compact']) {
      const set = setOf(id)
      await set.getByRole('button', { name: '展开全部（共 200 个）' }).click()
      await settle(80)
      await shot(set.locator(id === 'big-rail' ? '.g-rail' : '.ui-popover'), 'knowledge-200-' + id.replace('big-', ''))
    }
    // 滚到底再截一张，看到底部与滚动条
    await setOf('big-rail').locator('.cf-scroll--capped').evaluate((el) => { el.scrollTop = el.scrollHeight })
    await shot(setOf('big-rail').locator('.g-rail'), 'knowledge-200-rail-bottom')

    await shot(setOf('sort-rail').locator('.g-rail'), 'tags-sorted-rail')
    await shot(setOf('sort-compact').locator('.ui-popover'), 'tags-sorted-compact')
    await shot(setOf('wrap-rail').locator('.g-rail'), 'knowledge-wrap-rail')
    await shot(setOf('filtered-rail').locator('.g-rail'), 'empty-filtered-rail')
    await shot(setOf('empty-rail').locator('.g-rail'), 'empty-rail')
    await shot(setOf('empty-compact').locator('.ui-popover'), 'empty-compact')

    // 真实 Popover 里的「更多筛选」：窗口放不下时浮层自己滚动
    await window.getByTestId('open-more').scrollIntoViewIfNeeded()
    await window.getByTestId('open-more').click()
    await window.locator('.ui-popover[role="dialog"]').waitFor()
    await settle(100)
    await window.screenshot({ path: join(evidence, `more-filters-popover-window-${sizeTag}.png`) })
    await window.keyboard.press('Escape')
    await window.locator('.ui-popover[role="dialog"]').waitFor({ state: 'detached' })

    // ---- TagPicker 五种状态 ----
    const popover = window.locator('.ui-popover[role="dialog"]')
    const openPicker = async (testId: string): Promise<void> => {
      await window.getByTestId(testId).scrollIntoViewIfNeeded()
      await window.getByTestId(testId).click()
      await popover.waitFor()
      await settle(80)
    }
    const closePicker = async (): Promise<void> => {
      await window.keyboard.press('Escape')
      await popover.waitFor({ state: 'detached' })
    }
    const pickerInput = (): Locator => popover.getByRole('combobox', { name: '搜索或新建标签' })

    await openPicker('open-picker-empty')
    await shot(popover, 'picker-1-empty')
    await closePicker()

    await openPicker('open-picker')
    await shot(popover, 'picker-2-batch-mixed')
    await pickerInput().fill('期中复习')
    await settle(60)
    await shot(popover, 'picker-3-searching')
    await pickerInput().fill('易')
    await settle(60)
    await shot(popover, 'picker-4-create')
    await pickerInput().fill('二十一个字二十一个字二十一个字二十一个字二十一')
    await settle(60)
    await shot(popover, 'picker-5-too-long')
    await window.screenshot({ path: join(evidence, `picker-window-${sizeTag}.png`) })
    await closePicker()

    await openPicker('open-picker-many')
    await shot(popover, 'picker-6-many')
    await closePicker()

    // ---- TagManagerModal 四种状态 ----
    const dialog = window.getByRole('dialog', { name: '管理标签', exact: true })
    await window.getByTestId('open-manager').scrollIntoViewIfNeeded()
    await window.getByTestId('open-manager').click()
    await dialog.waitFor()
    await settle(80)
    await shot(window, 'manager-1-list')
    await dialog.getByRole('button', { name: '改名：压轴' }).click()
    await settle(60)
    await shot(window, 'manager-2-rename')
    await dialog.getByRole('textbox', { name: '标签「压轴」的新名称' }).fill('易错')
    await dialog.getByRole('textbox', { name: '标签「压轴」的新名称' }).press('Enter')
    await window.getByRole('dialog', { name: '并入标签「易错」' }).waitFor()
    await settle(60)
    await shot(window, 'manager-3-merge-confirm')
    await window.getByRole('dialog', { name: '并入标签「易错」' }).getByRole('button', { name: '取消' }).click()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.getByRole('button', { name: '删除：易错' }).click()
    await window.getByRole('dialog', { name: '删除标签「易错」' }).waitFor()
    await settle(60)
    await shot(window, 'manager-4-delete-confirm')
    await window.getByRole('dialog', { name: '删除标签「易错」' }).getByRole('button', { name: '取消' }).click()
    await window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
  }
  ok('样张截图：两个窗口尺寸各一遍（筛选块 × 左栏 / compact 宽度、200 个知识点、空状态、TagPicker 六种状态、TagManagerModal 四种状态）')

  // =====================================================================================
  // 二、行为断言（1440×900，每次从头加载）
  // =====================================================================================
  await resize(1440, 900)
  await loadGallery()

  // ---------- 章节 ----------
  {
    const rail = setOf('rail')
    const chapters = blockOf(rail, '章节')
    const texts = await rowTexts(chapters)
    assert.equal(texts[0], '未归章节', '最上面一项是「未归章节」')
    assert.deepEqual(texts, ['未归章节', '第一章 有理数', '1.1 正数和负数', '1.2 有理数', '1.3 数轴', '第二章 整式的加减', '第三章 一元一次方程', LONG_CHAPTER_TEXT()], '选中了 1.2 所以第一章默认展开，第二章（只选了章本身）与第四章收起')
    assert.equal(await chapters.getByRole('button', { name: '收起第一章 有理数' }).getAttribute('aria-expanded'), 'true')
    assert.equal(await chapters.getByRole('button', { name: '展开第二章 整式的加减' }).getAttribute('aria-expanded'), 'false')
    assert.equal(await itemOf(chapters, '1.2 有理数').getAttribute('aria-pressed'), 'true')
    assert.equal(await itemOf(chapters, '第二章 整式的加减').getAttribute('aria-pressed'), 'true', '选中章本身（不展开）也是蓝黑')
    assert.equal(await itemOf(chapters, '1.1 正数和负数').getAttribute('aria-pressed'), 'false')
    // 题数
    const count = async (name: string): Promise<string> => itemOf(chapters, name).locator('em').innerText()
    assert.equal(await count('未归章节'), '7')
    assert.equal(await count('第一章 有理数'), '18')
    assert.equal(await count('1.2 有理数'), '8')
    ok('章节：未归章节在最上，选中节的章默认展开，章 / 节 / 题数显示正确')

    // 点击切换发出的数组
    await itemOf(chapters, '1.1 正数和负数').click()
    assert.equal(await lastLog(), 'rail:chapters:[13,21,12]', '点一个节：追加到已选之后')
    await itemOf(chapters, '1.2 有理数').click()
    assert.equal(await lastLog(), 'rail:chapters:[21,12]', '再点已选的节：取消')
    // 0 题的章：变淡但可点
    const third = itemOf(chapters, '第三章 一元一次方程').locator('xpath=..')
    assert.ok(await hasClass(third, 'is-zero'), '当前条件下 0 题的章变淡')
    assert.ok(!(await hasClass(itemOf(chapters, '第一章 有理数').locator('xpath=..'), 'is-zero')))
    await itemOf(chapters, '第三章 一元一次方程').click()
    assert.equal(await lastLog(), 'rail:chapters:[21,12,31]', '0 题的章照样可以选')
    assert.ok(await hasClass(third, 'is-on') && !(await hasClass(third, 'is-zero')), '选中后是蓝黑，不再是淡色')
    await itemOf(chapters, '未归章节').click()
    assert.equal(await lastLog(), 'rail:chapters:[21,12,31,0]', '「未归章节」(id 0) 也在数组里')
    // 清除
    await chapters.getByRole('button', { name: '清除章节的选择' }).click()
    assert.equal(await lastLog(), 'rail:chapters:[]')
    assert.equal(await chapters.getByRole('button', { name: '清除章节的选择' }).count(), 0, '没有选中项时不出现「清除」')
    ok('章节：切换发出的数组正确（追加、取消、未归章节 id 0、0 题的章可选），清除后「清除」消失')

    // 展开 / 收起：手动展开的章，收起后不会被强行再展开
    await chapters.getByRole('button', { name: '展开第二章 整式的加减' }).click()
    assert.deepEqual((await rowTexts(chapters)).slice(5, 8), ['第二章 整式的加减', '2.1 整式', '2.2 整式的加减'])
    await chapters.getByRole('button', { name: '收起第二章 整式的加减' }).click()
    assert.ok(!(await rowTexts(chapters)).includes('2.1 整式'))
    // 外部改了选中（如恢复上次的筛选）：选中的节把它的章展开
    await window.getByTestId('ext-chapter').click()
    assert.ok((await rowTexts(chapters)).includes('2.2 整式的加减'), '外部选中 2.2 后第二章自动展开')
    // 手动收起第二章，再点别的项：不会又被展开
    await chapters.getByRole('button', { name: '收起第二章 整式的加减' }).click()
    await itemOf(chapters, '第三章 一元一次方程').click()
    assert.ok(!(await rowTexts(chapters)).includes('2.2 整式的加减'), '手动收起后，选中其它项不会把它强行展开')
    ok('章节：外部改选中会展开对应的章；手动收起的章不会被强行再展开')

    // 30 字长名：省略号 + title，不撑破栏宽
    const long = itemOf(chapters, LONG_CHAPTER_TEXT())
    assert.equal((await long.getAttribute('title'))?.length, 30, '30 字章节名带完整 title')
    assert.ok(await overflowing(long.locator('span')), '30 字章节名在 216px 栏里被省略号截断')
    await assertNoHorizontalScroll(rail.locator('.g-rail'), '左栏宽度')
    await assertNoHorizontalScroll(setOf('compact').locator('.ui-popover'), 'compact 宽度')
    await chapters.getByRole('button', { name: /^展开第四章/ }).click()
    await assertNoHorizontalScroll(rail.locator('.g-rail'), '左栏宽度（长章节展开）')
    const compactChapters = blockOf(setOf('compact'), '章节')
    await compactChapters.getByRole('button', { name: /^展开第四章/ }).click()
    await assertNoHorizontalScroll(setOf('compact').locator('.ui-popover'), 'compact 宽度（长章节展开）')
    ok('章节：30 字长名省略号截断并带 title；左栏与 compact 宽度都没有横向滚动')

    // 空目录
    const emptyChapters = blockOf(setOf('empty-rail'), '章节')
    assert.equal((await emptyChapters.locator('.cf-note').innerText()).trim(), '还没有章节')
    await emptyChapters.getByRole('button', { name: '管理章节' }).click()
    assert.equal(await lastLog(), 'empty-rail:manage-chapter')
    ok('章节：没有章节时写「还没有章节」并给「管理章节」')
  }

  // ---------- 难度 ----------
  {
    const rail = setOf('rail')
    const difficulty = blockOf(rail, '难度')
    const tiles = difficulty.locator('button.cf-chip')
    assert.deepEqual(await tiles.locator('span').allInnerTexts(), ['容易', '适中', '困难'], '档位名与顺序取自 DIFFICULTY_TIERS')
    assert.deepEqual(await tiles.locator('em').allInnerTexts(), ['24', '31', '3'])
    assert.equal(await chipOf(difficulty, '适中').getAttribute('aria-pressed'), 'true')
    await chipOf(difficulty, '容易').click()
    assert.equal(await lastLog(), 'rail:difficulty:["medium","easy"]')
    await chipOf(difficulty, '适中').click()
    assert.equal(await lastLog(), 'rail:difficulty:["easy"]')
    await chipOf(difficulty, '困难').click()
    assert.equal(await lastLog(), 'rail:difficulty:["easy","hard"]')
    await difficulty.getByRole('button', { name: '清除难度的选择' }).click()
    assert.equal(await lastLog(), 'rail:difficulty:[]')
    // L11：困难不标红、容易不标绿——未选中时三档计算样式完全相同；选中时也完全相同
    const style = (loc: Locator): Promise<Record<string, string>> =>
      loc.evaluate((el) => {
        const cs = getComputedStyle(el)
        const em = getComputedStyle(el.querySelector('em')!)
        return { color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor, em: em.color }
      })
    await window.mouse.move(700, 4)
    const [easy, medium, hard] = [await style(chipOf(difficulty, '容易')), await style(chipOf(difficulty, '适中')), await style(chipOf(difficulty, '困难'))]
    assert.deepEqual(easy, medium, '未选中：容易与适中样式一致')
    assert.deepEqual(hard, medium, '未选中：困难与适中样式一致（不标红）')
    await chipOf(difficulty, '困难').click()
    await chipOf(difficulty, '容易').click()
    await window.mouse.move(700, 4)
    const [easyOn, hardOn] = [await style(chipOf(difficulty, '容易')), await style(chipOf(difficulty, '困难'))]
    assert.deepEqual(easyOn, hardOn, '选中：容易与困难样式一致（不标绿、不标红）')
    assert.equal(hardOn.background, 'rgb(31, 58, 104)', '选中态是蓝黑 #1F3A68')
    // 没有任何难度
    assert.equal((await blockOf(setOf('empty-rail'), '难度').locator('.cf-note').innerText()).trim(), '暂无难度信息')
    ok('难度：档位名与顺序取自 DIFFICULTY_TIERS，切换数组正确，困难 / 容易的计算样式完全一致（蓝黑选中，无红绿），无难度写「暂无难度信息」')
  }

  // ---------- 知识点 ----------
  {
    const rail = setOf('rail')
    const knowledge = blockOf(rail, '知识点')
    // 默认 10 行：选中的 1 个 + 其余 9 个；两个学科分组
    assert.equal(await knowledge.locator('.cf-item').count(), 10, '默认共列 10 行')
    assert.deepEqual(await knowledge.locator('.cf-group-name').allInnerTexts(), ['初中数学', '初中英语'], '两个学科：按 subjectName 分组，数学在前')
    const pinned = knowledge.locator('.cf-pinned')
    assert.deepEqual(await rowTexts(pinned), ['求一个数的绝对值'], '选中的单独排在最前')
    assert.equal(await knowledge.getByRole('button', { name: '展开全部（共 23 个）' }).count(), 1, '展开全部带总数')
    assert.ok((await rowTexts(knowledge.locator('.cf-scroll'))).includes('细节理解'), '默认的 10 行里就有英语知识点，英语组也看得到')
    // 选中：数组、排到最前
    await itemOf(knowledge, '倒数').click()
    assert.equal(await lastLog(), 'rail:knowledge:[4718,4740]')
    assert.deepEqual(await rowTexts(pinned), ['求一个数的绝对值', '倒数'], '后选中的接在已选之后')
    assert.equal(await knowledge.locator('.cf-item').count(), 10, '选中的占名额，整体仍是 10 行')
    // 搜索：包含过滤；选中的始终可见
    const search = knowledge.getByRole('textbox', { name: '搜索知识点' })
    await search.fill('绝对值')
    assert.deepEqual(await rowTexts(knowledge), ['求一个数的绝对值', '倒数', '绝对值的几何意义', '绝对值非负性'], '搜索「绝对值」：已选中的（含不匹配的倒数）在最前，其余为匹配项')
    assert.equal(await knowledge.locator('.cf-group-name').count(), 1, '只剩数学时英语组标题随之消失')
    await search.fill('xyz不存在')
    assert.deepEqual(await rowTexts(knowledge), ['求一个数的绝对值', '倒数'], '没有匹配时仍保留已选中的')
    await search.fill('')
    await knowledge.getByRole('button', { name: '清除知识点的选择' }).click()
    assert.equal(await lastLog(), 'rail:knowledge:[]')
    await search.fill('xyz不存在')
    assert.equal((await knowledge.locator('.cf-note').innerText()).trim(), '没有匹配的知识点')
    await search.fill('')
    // 展开全部
    await knowledge.getByRole('button', { name: '展开全部（共 23 个）' }).click()
    assert.equal(await knowledge.locator('.cf-item').count(), 23)
    assert.equal(await knowledge.getByRole('button', { name: '收起' }).count(), 1)
    await knowledge.getByRole('button', { name: '收起' }).click()
    assert.equal(await knowledge.locator('.cf-item').count(), 10)
    ok('知识点：按学科分组、默认 10 行、选中的排最前不受搜索影响、搜索包含过滤、展开全部 / 收起')

    // 200 个：展开后内部滚动，选中的固定在上方
    const big = setOf('big-rail')
    const bigKnowledge = blockOf(big, '知识点')
    assert.equal(await bigKnowledge.locator('.cf-item').count(), 10)
    await bigKnowledge.getByRole('button', { name: '展开全部（共 200 个）' }).click()
    const scroller = big.locator('.cf-scroll--capped')
    const dims = await scroller.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    assert.ok(dims.client <= 320 && dims.scroll > dims.client * 5, '200 个知识点：列表高度封顶 320px，内部滚动 ' + JSON.stringify(dims))
    assert.equal(await bigKnowledge.locator('.cf-item').count(), 200)
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
    const lastName = (await rowTexts(scroller)).at(-1)!
    await itemOf(scroller, lastName).click()
    const picked = JSON.parse((await lastLog()).replace('big-rail:knowledge:', '')) as number[]
    assert.equal(picked.length, 1)
    assert.deepEqual(await rowTexts(bigKnowledge.locator('.cf-pinned')), [lastName], '滚到底选中的那条，立刻出现在上方固定的已选区，不用滚回去找')
    const pinnedBox = await bigKnowledge.locator('.cf-pinned').boundingBox()
    const scrollBox = await scroller.boundingBox()
    assert.ok(pinnedBox && scrollBox && pinnedBox.y + pinnedBox.height <= scrollBox.y + 1, '已选区在滚动区上方，不跟着滚动')
    await assertNoHorizontalScroll(big.locator('.g-rail'), '200 个知识点（左栏宽度）')
    await bigKnowledge.getByRole('button', { name: '收起' }).click()
    // compact
    const bigCompact = setOf('big-compact')
    await blockOf(bigCompact, '知识点').getByRole('button', { name: '展开全部（共 200 个）' }).click()
    const compactDims = await bigCompact.locator('.cf-scroll--capped').evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    assert.ok(compactDims.client <= 220 && compactDims.scroll > compactDims.client * 5, 'compact：列表高度封顶 220px ' + JSON.stringify(compactDims))
    await assertNoHorizontalScroll(bigCompact.locator('.ui-popover'), '200 个知识点（compact 宽度）')
    ok('知识点：200 个展开后封顶高度内部滚动（左栏 320px / compact 220px），滚到底选中的出现在固定的已选区，无横向滚动')

    // 空
    assert.equal((await blockOf(setOf('empty-rail'), '知识点').locator('.cf-note').innerText()).trim(), '暂无知识点信息')
  }

  // ---------- 标签筛选 ----------
  {
    const rail = setOf('rail')
    const tags = blockOf(rail, '标签')
    assert.deepEqual(await tags.locator('button.cf-chip > span').allInnerTexts(), ['易错', '期中复习', '压轴', LONG_TAG_TEXT(), '培优'], '题多的在前，0 题的在后')
    assert.deepEqual(await tags.locator('button.cf-chip > em').allInnerTexts(), ['12', '9', '5', '2', '0'], '题数取自 counts，没有的当 0')
    assert.equal(await tags.locator('.cf-scroll').count(), 0, '左栏里的标签区不设内部滚动框')
    assert.equal(await tags.getByRole('textbox', { name: '搜索标签' }).count(), 0, '不多于 12 个标签没有搜索框')
    assert.ok(await hasClass(chipOf(tags, '培优'), 'is-zero'), '0 题的标签变淡')
    assert.equal(await chipOf(tags, '易错').getAttribute('aria-pressed'), 'true')
    await chipOf(tags, '期中复习').click()
    assert.equal(await lastLog(), 'rail:tags:[1,3]')
    await chipOf(tags, '易错').click()
    assert.equal(await lastLog(), 'rail:tags:[3]')
    await chipOf(tags, '培优').click()
    assert.equal(await lastLog(), 'rail:tags:[3,5]', '0 题的标签照样可选')
    await tags.getByRole('button', { name: '清除标签的选择' }).click()
    assert.equal(await lastLog(), 'rail:tags:[]')
    const longChip = chipOf(tags, LONG_TAG_TEXT())
    assert.equal((await longChip.getAttribute('title'))?.length, 20)
    assert.ok(await overflowing(longChip.locator('span')), '20 字标签在栏内被省略号截断')
    const chipBox = await longChip.boundingBox()
    const railBox = await rail.locator('.g-rail').boundingBox()
    assert.ok(chipBox && railBox && chipBox.x + chipBox.width <= railBox.x + railBox.width - 17 + 0.5, '长标签不撑破栏宽')
    await tags.getByRole('button', { name: '管理标签' }).click()
    assert.equal(await lastLog(), 'rail:manage-tag')
    assert.equal((await blockOf(setOf('empty-rail'), '标签').locator('.cf-note').innerText()).trim(), '还没有标签')
    await assertNoHorizontalScroll(rail.locator('.g-rail'), '标签（左栏宽度）')
    await assertNoHorizontalScroll(setOf('compact').locator('.ui-popover'), '标签（compact 宽度）')
    await assertNoHorizontalScroll(setOf('empty-rail').locator('.g-rail'), '空状态（左栏宽度）')
    await assertNoHorizontalScroll(setOf('empty-compact').locator('.ui-popover'), '空状态（compact 宽度）')
    ok('标签筛选：切换数组正确、0 题变淡可选、20 字名称省略号截断不撑破栏宽、管理标签入口、空状态')
  }

  // ---------- 标签块：排序、搜索、不设内框（compact 保留 120px 内框） ----------
  {
    const rail = setOf('sort-rail')
    const tags = blockOf(rail, '标签')
    const counts = async (): Promise<number[]> => (await tags.locator('button.cf-chip > em').allInnerTexts()).map(Number)
    const names = async (): Promise<string[]> => tags.locator('button.cf-chip > span').allInnerTexts()
    assert.deepEqual(await counts(), [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0], '有题的在前、题多的在前、0 题在后')
    assert.deepEqual((await names()).slice(5, 8), ['子', '乙', '丁'], '同题数保持传入顺序')
    assert.equal(await tags.locator('.cf-scroll').count(), 0, '左栏里不设内部滚动框')
    assert.equal(await setOf('sort-compact').locator('.cf-scroll--chips').count(), 1, 'compact 保留 120px 内框')
    const search = tags.getByRole('textbox', { name: '搜索标签' })
    await search.fill('庚')
    assert.deepEqual(await names(), ['庚'])
    // 选中的标签不受搜索影响；搜不到别的时写「没有匹配的标签」，选中的仍保留
    await search.fill('')
    await chipOf(tags, '己').click()
    assert.equal(await lastLog(), 'sort-rail:tags:[26]')
    await search.fill('庚')
    assert.deepEqual((await names()).sort(), ['己', '庚'].sort())
    await search.fill('没有这个')
    assert.deepEqual(await names(), ['己'])
    assert.equal((await tags.locator('.cf-note').innerText()).trim(), '没有匹配的标签')
    await search.fill('')
    await tags.getByRole('button', { name: '清除标签的选择' }).click()
    // compact 里也有搜索框，同样排序
    assert.equal(await blockOf(setOf('sort-compact'), '标签').getByRole('textbox', { name: '搜索标签' }).count(), 1)
    assert.deepEqual((await blockOf(setOf('sort-compact'), '标签').locator('button.cf-chip > em').allInnerTexts()).map(Number).slice(0, 3), [9, 8, 7])
    await assertNoHorizontalScroll(rail.locator('.g-rail'), '标签排序（左栏宽度）')
    ok('标签块：有题的在前（题多在前）、0 题在后；多于 12 个带搜索框，选中的不受搜索影响；左栏不设内框、compact 保留内框')
  }

  // ---------- 章节树不设内框 ----------
  {
    for (const id of ['rail', 'compact']) {
      const chapters = blockOf(setOf(id), '章节')
      assert.equal(await chapters.locator('.cf-scroll, .cf-scroll--tree').count(), 0, id + '：章节树不设内部滚动框')
      const tree = await chapters.locator('ul.cf-list').first().evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el.parentElement!).overflowY }))
      assert.ok(tree.client === tree.scroll && !/auto|scroll/.test(tree.overflow), id + '：章节树完整展开，由外层滚：' + JSON.stringify(tree))
    }
    ok('章节：左栏与 compact 里的章节树都不设内部滚动框（嵌套滚动难操作）')
  }

  // ---------- 知识点名称换行 ----------
  {
    const rail = setOf('wrap-rail')
    const item = blockOf(rail, '知识点').locator('button.cf-item').filter({ hasText: '含有多个符号' })
    const info = await item.evaluate((el) => {
      const span = el.querySelector('span')!
      return { h: el.getBoundingClientRect().height, text: span.textContent, fits: span.scrollHeight <= span.clientHeight + 1, overflow: getComputedStyle(span).textOverflow }
    })
    assert.equal(info.text, '含有多个符号的有理数混合运算与绝对值化简综合应用')
    assert.ok(info.h > 36 && info.h < 70 && info.fits && info.overflow !== 'ellipsis', '24 个字：两行放得下，后缀不被省略号截掉：' + JSON.stringify(info))
    const short = await blockOf(rail, '知识点').locator('button.cf-item').filter({ hasText: /^倒数/ }).evaluate((el) => el.getBoundingClientRect().height)
    assert.ok(short <= 31, '短名称仍是一行 30px：' + short)
    await assertNoHorizontalScroll(rail.locator('.g-rail'), '知识点换行（左栏宽度）')
    ok('知识点：名称最多两行换行，短名称仍是一行，不用省略号截掉后缀')
  }

  // ---------- 被筛空时的文案 ----------
  {
    assert.equal((await blockOf(setOf('filtered-rail'), '难度').locator('.cf-note').innerText()).trim(), '当前条件下没有可选的难度')
    assert.equal((await blockOf(setOf('filtered-rail'), '知识点').locator('.cf-note').innerText()).trim(), '当前条件下没有可选的知识点')
    ok('难度、知识点：页面有其他条件时被筛空写「当前条件下没有可选的…」，不写「暂无…信息」')
  }

  // ---------- TagPicker ----------
  {
    const popover = window.locator('.ui-popover[role="dialog"]')
    const input = (): Locator => popover.getByRole('combobox', { name: '搜索或新建标签' })
    const names = (): Promise<string[]> => popover.locator('.cf-prow:not(.cf-prow--new) .cf-prow-name').allInnerTexts()
    const rowOf = (name: string): Locator => popover.locator('.cf-prow').filter({ has: window.locator(`.cf-prow-name:text-is("${name}")`) })
    const openMain = async (): Promise<void> => {
      await window.getByTestId('open-picker').scrollIntoViewIfNeeded()
      await window.getByTestId('open-picker').click()
      await popover.waitFor()
    }
    const closeIt = async (): Promise<void> => {
      await window.keyboard.press('Escape')
      await popover.waitFor({ state: 'detached' })
    }
    await openMain()
    assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('aria-label')), '搜索或新建标签', '打开后焦点在输入框')
    assert.deepEqual(await names(), ['易错', '压轴', '期中复习', LONG_TAG_TEXT(), 'Mock', '培优'])
    // 勾选 / 半选
    assert.equal(await rowOf('易错').locator('input').isChecked(), true)
    assert.equal(await rowOf('压轴').locator('input').evaluate((el: HTMLInputElement) => el.indeterminate), true, '批量时部分题已有的标签显示半选')
    assert.equal(await popover.locator('.cf-prow').filter({ hasText: '压轴' }).getAttribute('aria-checked'), 'mixed')
    // 半选是空心框 + 蓝黑横杠，全选是实心蓝黑：一眼分得开
    const boxStyle = (name: string) => rowOf(name).locator('input').evaluate((el) => { const cs = getComputedStyle(el); return [cs.backgroundColor, cs.borderTopColor] })
    assert.deepEqual(await boxStyle('压轴'), ['rgb(255, 255, 255)', 'rgb(31, 58, 104)'], '半选：白底空心')
    assert.deepEqual(await boxStyle('易错'), ['rgb(31, 58, 104)', 'rgb(31, 58, 104)'], '全选：实心蓝黑')
    assert.equal(await rowOf('期中复习').locator('input').isChecked(), false)
    // 点击：半选 → 全选；已选 → 取消；未选 → 选中
    await rowOf('压轴').click()
    assert.equal(await lastLog(), 'picker:toggle:2:true', '点半选的标签：变成全选')
    assert.equal(await rowOf('压轴').locator('input').evaluate((el: HTMLInputElement) => el.indeterminate), false)
    assert.equal(await rowOf('压轴').locator('input').isChecked(), true)
    await rowOf('易错').click()
    assert.equal(await lastLog(), 'picker:toggle:1:false')
    await rowOf('期中复习').click()
    assert.equal(await lastLog(), 'picker:toggle:3:true')
    assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('aria-label')), '搜索或新建标签', '鼠标点行后焦点仍在输入框，键盘不断')
    ok('TagPicker：全选 / 半选 / 未选三种显示（半选空心、全选实心）；点击切换发出正确的 (id, next)，半选点一下变全选')
    await closeIt()

    // 批量：行上的数字是所选里有几道，悬停写明；去标签：没有「新建」行，输入框只用来搜索
    await window.getByTestId('open-picker-bulk').scrollIntoViewIfNeeded()
    await window.getByTestId('open-picker-bulk').click()
    await popover.waitFor()
    assert.deepEqual(await popover.locator('.cf-prow em').allInnerTexts(), ['12', '4', '0', '0', '1', '0'], '行上是所选 12 道里有几道（易错 12、压轴 4、期中复习 0、长名 0、Mock 1、培优 0）')
    assert.equal(await popover.locator('.cf-prow em').nth(1).getAttribute('title'), '所选 12 道中 4 道已有')
    await closeIt()
    await window.getByTestId('open-picker-remove').scrollIntoViewIfNeeded()
    await window.getByTestId('open-picker-remove').click()
    await popover.waitFor()
    assert.equal(await popover.getByRole('combobox').getAttribute('placeholder'), '搜索标签', '去标签：输入框写「搜索标签」')
    await popover.getByRole('combobox').fill('不存在')
    assert.equal(await popover.locator('.cf-prow--new').count(), 0, '去标签没有「新建」行')
    assert.equal((await popover.locator('.cf-picker-empty').innerText()).trim(), '没有匹配的标签')
    await popover.getByRole('combobox').press('Enter')
    await closeIt()
    ok('TagPicker：批量时行上是所选里的题数；去标签（allowCreate=false）没有新建行')
    await openMain()

    // 搜索过滤
    await input().fill('错')
    assert.deepEqual(await names(), ['易错', LONG_TAG_TEXT()], '搜索「错」：列出名称包含「错」的标签')
    assert.equal(await popover.locator('.cf-prow--new').count(), 1, '「错」不是现有标签的完整名称，所以顶部有「新建」')
    await input().fill('期中复习')
    assert.equal(await popover.locator('.cf-prow--new').count(), 0, '与已有标签同名：不出现「新建」')
    assert.ok(await hasClass(rowOf('期中复习'), 'is-active'), '同名标签默认高亮，回车直接作用在它上面')
    await input().fill('zzz没有这个')
    assert.deepEqual(await names(), [])
    assert.equal((await popover.locator('.cf-prow--new').innerText()).trim(), '新建「zzz没有这个」')
    ok('TagPicker：按包含过滤；非完整同名时顶部出现「新建」，同名时不出现并高亮那一个')

    // 键盘：↑↓ 回车
    await input().fill('')
    await input().press('ArrowDown')
    assert.ok(await hasClass(rowOf('易错'), 'is-active'), '↓：第一行')
    await input().press('ArrowDown')
    assert.ok(await hasClass(rowOf('压轴'), 'is-active'))
    await input().press('ArrowUp')
    await input().press('ArrowUp')
    assert.ok(await hasClass(rowOf('培优'), 'is-active'), '↑ 越过第一行回到最后一行')
    await input().press('ArrowDown')
    assert.ok(await hasClass(rowOf('易错'), 'is-active'), '↓ 越过最后一行回到第一行')
    await input().press('Enter')
    assert.equal(await lastLog(), 'picker:toggle:1:true', '回车切换高亮行（易错此前被点掉，这次勾上）')
    await input().press('ArrowDown')
    await input().press('Enter')
    assert.equal(await lastLog(), 'picker:toggle:2:false', '压轴此时已全选，回车取消')
    ok('TagPicker：↑↓ 循环移动高亮、回车切换高亮行')

    // 新建流程
    const before = await logCount()
    await input().fill('必刷题')
    assert.equal((await popover.locator('.cf-prow--new').innerText()).trim(), '新建「必刷题」')
    assert.ok(await hasClass(popover.locator('.cf-prow--new'), 'is-active'), '新建行默认高亮')
    await input().press('Enter')
    await rowOf('必刷题').waitFor()
    const afterCreate = (await logOf()).slice(before)
    assert.deepEqual(afterCreate, ['picker:create:必刷题', 'picker:toggle:100:true'], '新建：先 onCreate，拿到标签后立刻 onToggle(tag, true)')
    assert.equal(await input().inputValue(), '', '新建完成后清空输入框')
    assert.equal(await rowOf('必刷题').locator('input').isChecked(), true, '新建的标签出现在列表里并已勾上')
    // 点击「新建」行
    await input().fill('冲刺班')
    await popover.locator('.cf-prow--new').click()
    await rowOf('冲刺班').waitFor()
    assert.equal(await lastLog(), 'picker:toggle:101:true', '点击「新建」行与回车等效')
    // 首尾空白、全角空格、连续空白
    await input().fill('  　期中　　复习二  ')
    assert.equal((await popover.locator('.cf-prow--new').innerText()).trim(), '新建「期中 复习二」', '去首尾空白、全角空格按半角、连续空白合一')
    await input().fill('   　 ')
    assert.equal(await popover.locator('.cf-prow--new').count(), 0, '只有空白：不出现「新建」')
    ok('TagPicker：新建流程（回车 / 点击）先 onCreate 再 onToggle(tag, true)、清空输入；首尾空白与全角空格按规则规整，空白不能新建')

    // 同名（不分英文大小写）
    const n1 = await logCount()
    await input().fill('mock')
    assert.equal(await popover.locator('.cf-prow--new').count(), 0, '「mock」与已有「Mock」同名（不分大小写）：不新建')
    assert.ok(await hasClass(rowOf('Mock'), 'is-active'))
    await input().press('Enter')
    assert.deepEqual((await logOf()).slice(n1), ['picker:toggle:5:true'], '回车直接勾上已有的「Mock」，不调 onCreate')
    await input().fill('MOCK')
    await input().press('Enter')
    assert.deepEqual((await logOf()).slice(n1), ['picker:toggle:5:true'], '「Mock」已经勾着：再对着完整名字回车不取消、不新建')
    assert.equal(await input().inputValue(), '', '同名回车后输入框清空')
    await input().fill('培优')
    await input().press('Enter')
    assert.equal((await logOf()).slice(n1).at(-1), 'picker:toggle:6:true', '输入已有名字回车：勾上它')
    await input().fill('培优')
    await input().press('Enter')
    assert.equal((await logOf()).slice(n1).at(-1), 'picker:toggle:6:true', '已经勾着的，再对着完整名字回车不取消')
    ok('TagPicker：同名（不分英文大小写）不新建，回车直接勾上已有标签；已勾着的不被回车取消')

    // 超长
    const n2 = await logCount()
    const twenty = '一二三四五六七八九十一二三四五六七八九十'
    await input().fill(twenty)
    assert.equal(await popover.locator('.cf-warn').count(), 0, '恰好 20 字不提示')
    assert.equal((await popover.locator('.cf-prow--new').innerText()).trim(), '新建「' + twenty + '」')
    await input().fill(twenty + '一')
    assert.equal((await popover.locator('.cf-warn').innerText()).trim(), '标签名最多 20 字', '21 字：红色提示')
    assert.equal(await popover.locator('.cf-prow--new').count(), 0, '21 字：不出现「新建」')
    const warnColor = await popover.locator('.cf-warn').evaluate((el) => { const cs = getComputedStyle(el); return [cs.color, cs.backgroundColor, cs.borderTopColor] })
    assert.deepEqual(warnColor, ['rgb(195, 50, 43)', 'rgb(252, 239, 236)', 'rgb(195, 50, 43)'], '阻止保存的提示是红色（--red / --red-bg）：方向 C 里红用于错误')
    await input().press('Enter')
    assert.equal(await logCount(), n2, '21 字回车：什么都不发生')
    const emoji20 = '😀'.repeat(20)
    await input().fill(emoji20)
    assert.equal(await popover.locator('.cf-warn').count(), 0, '20 个表情按 20 字计（按字符数，不按 UTF-16 长度）')
    await input().fill('😀'.repeat(21))
    assert.equal(await popover.locator('.cf-warn').count(), 1)
    await input().fill(twenty + '一')
    await input().fill(twenty)
    assert.equal(await popover.locator('.cf-warn').count(), 0, '改回 20 字后提示消失')
    ok('TagPicker：20 字可新建，21 字红色提示且禁止新建；20 个表情按 20 字计')

    // 输入法组词中的回车不算
    const n3 = await logCount()
    await input().fill('组词中的名字')
    await input().evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
    await settle(120)
    assert.equal(await logCount(), n3, '输入法组词中按回车不触发新建')
    await input().evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true, cancelable: true })))
    ok('TagPicker：输入法组词中的回车、方向键不触发新建或移动')

    // 新建报错：中文原因进 toast，不勾选
    const n4 = await logCount()
    await input().fill('出错')
    await input().press('Enter')
    const toastText = await window.getByTestId('toast').filter({ hasText: '暂不可用' }).innerText()
    assert.ok(toastText.includes('标签名「出错」暂不可用') && !toastText.includes('Error invoking'), 'toast 只显示中文原因：' + toastText)
    assert.deepEqual((await logOf()).slice(n4), ['picker:create:出错'], '新建失败：不调 onToggle')
    assert.equal(await input().inputValue(), '出错', '失败时保留输入，方便改')
    await window.evaluate(() => (window as unknown as { __toast: { dismissAll(): void } }).__toast.dismissAll())
    ok('TagPicker：onCreate 失败时 toast 显示去掉 IPC 前缀的中文原因，不勾选、保留输入')

    // 管理标签入口 + Esc
    await input().fill('')
    await popover.getByRole('button', { name: '管理标签' }).click()
    assert.equal(await lastLog(), 'picker:manage')
    await popover.waitFor({ state: 'detached' })
    ok('TagPicker：「管理标签」回调并关闭浮层')

    // 空列表文案
    await window.getByTestId('open-picker-empty').click()
    await popover.waitFor()
    assert.equal((await popover.locator('.cf-picker-empty').innerText()).trim(), '还没有标签，输入名称回车新建')
    assert.equal(await popover.getByRole('button', { name: '管理标签' }).count(), 1)
    await closeIt()

    // 列表过长内部滚动
    await window.getByTestId('open-picker-many').scrollIntoViewIfNeeded()
    await window.getByTestId('open-picker-many').click()
    await popover.waitFor()
    const list = popover.locator('.cf-picker-list')
    const listDims = await list.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    assert.ok(listDims.client <= 216 && listDims.scroll > listDims.client * 4, '80 个标签：列表封顶后内部滚动 ' + JSON.stringify(listDims))
    const popBox = await popover.boundingBox()
    const viewport = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    assert.ok(popBox && popBox.y >= 0 && popBox.y + popBox.height <= viewport.h, '浮层整体在窗口内')
    // 键盘一路 ↓ 到底：高亮行始终在可视区内
    for (let i = 0; i < 30; i++) await input().press('ArrowDown')
    const activeVisible = await popover.evaluate((root) => {
      const row = root.querySelector('.cf-prow.is-active') as HTMLElement
      const box = (root.querySelector('.cf-picker-list') as HTMLElement).getBoundingClientRect()
      const r = row.getBoundingClientRect()
      return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5
    })
    assert.ok(activeVisible, '↓ 移到第 30 行：高亮行滚进可视区')
    await assertNoHorizontalScroll(popover, '80 个标签浮层')
    await closeIt()
    // 试卷标签：单位
    await window.getByTestId('open-picker-paper').click()
    await popover.waitFor()
    assert.equal(await popover.locator('.cf-prow em').first().getAttribute('title'), '4 份试卷')
    await closeIt()
    ok('TagPicker：空列表文案、80 个标签内部滚动且键盘高亮跟随、浮层不出窗口、unit 决定计数单位')
  }

  // ---------- TagManagerModal ----------
  {
    const dialog = window.getByRole('dialog', { name: '管理标签', exact: true })
    const rowOf = (name: string): Locator => dialog.locator('.cf-mrow').filter({ has: window.locator(`.cf-mname:text-is("${name}")`) })
    const names = (): Promise<string[]> => dialog.locator('.cf-mname').allInnerTexts()
    const editBox = (name: string): Locator => dialog.getByRole('textbox', { name: `标签「${name}」的新名称` })
    const openIt = async (): Promise<void> => {
      await window.getByTestId('open-manager').scrollIntoViewIfNeeded()
      await window.getByTestId('open-manager').click()
      await dialog.waitFor()
    }
    await openIt()
    assert.deepEqual(await names(), ['易错', '压轴', '好题', '期中复习', LONG_TAG_TEXT(), '培优', 'Mock'])
    assert.deepEqual(await dialog.locator('.cf-mcount').allInnerTexts(), ['3 道题', '5 道题', '2 道题', '9 道题', '2 道题', '0 道题', '1 道题'])
    // 改名：回车保存；重读比回调晚，行不会闪回旧名
    await dialog.getByRole('button', { name: '改名：压轴' }).click()
    assert.equal(await editBox('压轴').inputValue(), '压轴')
    assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('aria-label')), '标签「压轴」的新名称', '进入改名后焦点在输入框')
    assert.equal(await editBox('压轴').evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length), true, '输入框内容全选')
    await editBox('压轴').fill('难题')
    await editBox('压轴').press('Enter')
    await window.waitForFunction(() => (window as unknown as { __log: string[] }).__log.at(-1) === 'q:rename:2:难题')
    await settle(100) // 回调已结束，但样张里的页面要再过 250ms 才重读数据：这段时间里行必须已经是新名
    assert.deepEqual((await names()).slice(0, 3), ['易错', '难题', '好题'], '重读完成前就显示新名，不闪回旧名')
    assert.equal(await rowOf('难题').locator('.cf-mcount').innerText(), '5 道题')
    await settle(500) // 页面重读数据之后仍是新名
    assert.equal((await names())[1], '难题')
    assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('aria-label')), '改名：难题', '改名完成后焦点回到该行的「改名」按钮')
    ok('管理标签：行内改名回车保存，回调后立即显示新名（重读完成前不闪回旧名），焦点回到「改名」')

    // Esc 只取消改名，不关弹窗
    await dialog.getByRole('button', { name: '改名：难题' }).click()
    await editBox('难题').fill('随便改')
    await editBox('难题').press('Escape')
    assert.equal(await dialog.count(), 1, 'Esc 取消改名时弹窗不关')
    assert.equal(await dialog.locator('.cf-mname-input').count(), 0)
    assert.equal((await names())[1], '难题', '取消后保持原名')
    assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('aria-label')), '改名：难题')
    // 不在改名时 Esc 关弹窗
    const nRename = await logCount()
    // 名称没变：直接退出，不调 onRename
    await dialog.getByRole('button', { name: '改名：难题' }).click()
    await editBox('难题').press('Enter')
    assert.equal(await logCount(), nRename, '名称没变：不调 onRename')
    assert.equal(await dialog.locator('.cf-mname-input').count(), 0)
    ok('管理标签：Esc 只取消改名并保持原名，名称没变时回车直接退出不调接口')

    // 合并确认
    await dialog.getByRole('button', { name: '改名：好题' }).click()
    await editBox('好题').fill('易错')
    const nMerge = await logCount()
    await editBox('好题').press('Enter')
    const merge = window.getByRole('dialog', { name: '并入标签「易错」' })
    await merge.waitFor()
    assert.equal((await merge.locator('.ui-confirm-body').innerText()).trim(), '「好题」将并入「易错」，原来带「好题」的 2 道题都会带上「易错」，「好题」随后删除。')
    assert.equal(await logCount(), nMerge, '确认之前不调 onRename')
    assert.equal(await window.evaluate(() => document.activeElement?.textContent?.trim()), '取消', '合并是危险操作：默认焦点在「取消」')
    await merge.getByRole('button', { name: '取消' }).click()
    assert.equal(await editBox('好题').inputValue(), '易错', '取消后回到改名状态，草稿保留')
    assert.equal(await logCount(), nMerge)
    await editBox('好题').press('Enter')
    await window.getByRole('dialog', { name: '并入标签「易错」' }).getByRole('button', { name: '并入' }).click()
    await rowOf('好题').waitFor({ state: 'detached' })
    assert.equal(await lastLog(), 'q:rename:3:易错', '确认后才调 onRename(好题的 id, "易错")')
    await window.getByTestId('toast').filter({ hasText: '已将「好题」并入「易错」' }).waitFor({ timeout: 3000 })
    await settle(500)
    const merged = await dialog.locator('.cf-mrow').filter({ has: window.locator('.cf-mname:text-is("易错")') }).locator('.cf-mcount').innerText()
    assert.equal(merged, '5 道题', '重读后「易错」的题数合并为 3 + 2')
    // 不分大小写的同名也先确认
    await dialog.getByRole('button', { name: '改名：培优' }).click()
    await editBox('培优').fill('MOCK')
    await editBox('培优').press('Enter')
    const merge2 = window.getByRole('dialog', { name: '并入标签「Mock」' })
    await merge2.waitFor()
    assert.equal((await merge2.locator('.ui-confirm-body').innerText()).trim(), '「培优」将并入「Mock」，原来带「培优」的 0 道题都会带上「Mock」，「培优」随后删除。', '不分英文大小写')
    await merge2.getByRole('button', { name: '取消' }).click()
    await editBox('培优').press('Escape')
    ok('管理标签：改成已有名称（含大小写不同）先确认并入，取消保留草稿，确认后才调接口，并入后行消失、题数合并')

    // 超长 / 空
    await dialog.getByRole('button', { name: '改名：易错' }).click()
    await editBox('易错').fill('一二三四五六七八九十一二三四五六七八九十一')
    assert.equal((await dialog.locator('.cf-warn').innerText()).trim(), '标签名最多 20 字')
    assert.equal(await dialog.locator('.cf-warn').evaluate((el) => getComputedStyle(el).color), 'rgb(195, 50, 43)', '超长提示是红色')
    assert.equal(await editBox('易错').evaluate((el) => el.closest('.ui-input')!.classList.contains('is-invalid')), true, '超长：输入框标红')
    assert.equal(await dialog.getByRole('button', { name: '保存' }).isDisabled(), true, '超长：保存禁用')
    const nLong = await logCount()
    await editBox('易错').press('Enter')
    assert.equal(await logCount(), nLong, '超长：回车不保存')
    await editBox('易错').fill('   ')
    assert.equal(await dialog.getByRole('button', { name: '保存' }).isDisabled(), true, '空白：保存禁用')
    assert.equal(await editBox('易错').evaluate((el) => el.closest('.ui-input')!.classList.contains('is-invalid')), true, '空白：输入框标红')
    await editBox('易错').press('Enter')
    assert.equal(await logCount(), nLong, '空白：回车不保存')
    await editBox('易错').press('Escape')
    ok('管理标签：超长（红色提示、输入框标红）与空白都不能保存')

    // 报错：toast 中文原因，行保持改名状态
    await dialog.getByRole('button', { name: '改名：易错' }).click()
    await editBox('易错').fill('出错')
    await editBox('易错').press('Enter')
    const err = await window.getByTestId('toast').filter({ hasText: '暂不可用' }).innerText()
    assert.ok(err.includes('标签名「出错」暂不可用') && !err.includes('Error invoking'), 'toast 只显示中文原因：' + err)
    await settle(150)
    assert.equal(await editBox('易错').inputValue(), '出错', '报错后仍在改名状态，保留输入')
    assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('aria-label')), '标签「易错」的新名称', '报错后焦点回到输入框')
    await editBox('易错').press('Escape')
    await window.evaluate(() => (window as unknown as { __toast: { dismissAll(): void } }).__toast.dismissAll())
    ok('管理标签：接口报错用 toast 显示中文原因，保持改名状态')

    // 删除
    await dialog.getByRole('button', { name: '删除：易错' }).click()
    const del = window.getByRole('dialog', { name: '删除标签「易错」' })
    await del.waitFor()
    assert.equal((await del.locator('.ui-confirm-body').innerText()).trim(), '5 道题会去掉这个标签，题目本身不受影响。')
    assert.equal(await window.evaluate(() => document.activeElement?.textContent?.trim()), '取消', '默认焦点在「取消」')
    await window.keyboard.press('Escape')
    await del.waitFor({ state: 'detached' })
    assert.equal(await dialog.count(), 1, 'Esc 只关确认框')
    assert.ok((await names()).includes('易错'))
    await dialog.getByRole('button', { name: '删除：易错' }).click()
    const nDel = await logCount()
    await window.getByRole('dialog', { name: '删除标签「易错」' }).getByRole('button', { name: '删除', exact: true }).click()
    await rowOf('易错').waitFor({ state: 'detached' })
    assert.deepEqual((await logOf()).slice(nDel), ['q:delete:1'])
    await settle(500)
    assert.ok(!(await names()).includes('易错'))
    // 0 道题的标签
    await dialog.getByRole('button', { name: '删除：培优' }).click()
    assert.equal((await window.getByRole('dialog', { name: '删除标签「培优」' }).locator('.ui-confirm-body').innerText()).trim(), '这个标签没有用在任何题目上，删除不影响其他标签。')
    await window.keyboard.press('Escape')
    // Esc 关弹窗
    await window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    ok('管理标签：删除先确认并写明题数，Esc 只关确认框，确认后行立即消失；0 道题的标签文案；不在改名时 Esc 关弹窗')

    // 试卷标签：单位与措辞
    await window.getByTestId('open-manager-papers').scrollIntoViewIfNeeded()
    await window.getByTestId('open-manager-papers').click()
    const paperDialog = window.getByRole('dialog', { name: '管理试卷标签', exact: true })
    await paperDialog.waitFor()
    assert.deepEqual(await paperDialog.locator('.cf-mcount').allInnerTexts(), ['4 份试卷', '3 份试卷', '2 份试卷'])
    await paperDialog.getByRole('button', { name: '删除：月考' }).click()
    assert.equal((await window.getByRole('dialog', { name: '删除标签「月考」' }).locator('.ui-confirm-body').innerText()).trim(), '2 份试卷会去掉这个标签，试卷本身不受影响。')
    await window.keyboard.press('Escape')
    await paperDialog.getByRole('button', { name: '改名：月考' }).click()
    await paperDialog.getByRole('textbox', { name: '标签「月考」的新名称' }).fill('第一章')
    await paperDialog.getByRole('textbox', { name: '标签「月考」的新名称' }).press('Enter')
    assert.equal((await window.getByRole('dialog', { name: '并入标签「第一章」' }).locator('.ui-confirm-body').innerText()).trim(), '「月考」将并入「第一章」，原来带「月考」的 2 份试卷都会带上「第一章」，「月考」随后删除。')
    await window.keyboard.press('Escape')
    await paperDialog.getByRole('textbox', { name: '标签「月考」的新名称' }).press('Escape')
    await window.keyboard.press('Escape')
    // 空列表
    await window.getByTestId('open-manager-empty').click()
    await dialog.waitFor()
    assert.equal(await dialog.getByText('还没有标签', { exact: true }).count(), 1)
    await window.keyboard.press('Escape')
    ok('管理标签：试卷标签用「份试卷」「试卷本身」措辞，空列表有提示')
  }

  assert.deepEqual(pageErrors, [], '页面不应有报错：' + pageErrors.join('\n'))
  ok('页面没有 pageerror / console.error')
} finally {
  await app.close()
}
console.log('classify-kit e2e 通过，证据目录：' + evidence)

// 样张里的长名（与 harness 里的构造一致）
function LONG_CHAPTER_TEXT(): string {
  return Array.from('第四章 一元一次方程在行程问题工程问题销售问题中的应用综合训练专题').slice(0, 30).join('')
}
function LONG_TAG_TEXT(): string {
  return Array.from('七年级上册第一单元月考易错题整理汇总再加一点').slice(0, 20).join('')
}
