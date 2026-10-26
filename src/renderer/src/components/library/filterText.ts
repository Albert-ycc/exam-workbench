// 试题库筛选条件的文字：头部 chip 与「没有符合条件的题目」里写出的当前条件共用一处，两边不会各写各的。
// 名称一律用章节名、标签名、知识点名、来源卷标题，任何时候都不显示内部编号：名称还没读到（或对象已被删掉）的条件先不显示。
// 章节写「章名 › 节名」。
import { DIFFICULTY_TIERS, NO_CHAPTER } from '@shared/classify'
import type { LibraryFilterState } from './libraryFilterStore'

export interface FilterNames {
  chapters: ReadonlyMap<number, string> // 章节编号 → 「章名」或「章名 › 节名」
  knowledge: ReadonlyMap<number, string>
  tags: ReadonlyMap<number, string>
  sourceTitle: string
}

export interface FilterCondition {
  key: string
  chip: string // 头部 chip：「章节：1.2 数轴」「知识点：倒数 等 2 个」
  chipTitle: string // chip 悬停：全部名称
  empty: string // 无结果时写出的条件：「章节「1.2 数轴」」
  clear: Partial<LibraryFilterState>
}

// 一个名字写全，多个写第一个加「等 N 个」
const brief = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names[0]} 等 ${names.length} 个`)

function lookup(ids: readonly number[], map: ReadonlyMap<number, string>): string[] {
  return ids.flatMap((id) => {
    const name = id === NO_CHAPTER && !map.has(id) ? '未归章节' : map.get(id)
    return name ? [name] : []
  })
}

export function filterConditions(filter: LibraryFilterState, names: FilterNames): FilterCondition[] {
  const list: FilterCondition[] = []
  if (filter.batch) list.push({ key: 'batch', chip: '本次入库', chipTitle: '本次入库', empty: '只看本次入库的题', clear: { batch: null } })
  if (filter.type) list.push({ key: 'type', chip: `题型：${filter.type}`, chipTitle: `题型：${filter.type}`, empty: `题型「${filter.type}」`, clear: { type: '' } })
  if (filter.paperId !== null && names.sourceTitle) {
    const title = names.sourceTitle
    list.push({ key: 'paper', chip: `来源卷：${title}`, chipTitle: `来源卷：${title}`, empty: `来源卷「${title}」`, clear: { paperId: null } })
  }
  if (filter.keyword) list.push({ key: 'keyword', chip: `关键词：${filter.keyword}`, chipTitle: `关键词：${filter.keyword}`, empty: `关键词「${filter.keyword}」`, clear: { keyword: '' } })

  const group = (key: string, label: string, values: string[], chipText: string, clear: Partial<LibraryFilterState>): void => {
    if (values.length === 0) return
    const full = values.join('、')
    list.push({ key, chip: `${label}：${chipText}`, chipTitle: `${label}：${full}`, empty: `${label}「${full}」`, clear })
  }
  const chapters = lookup(filter.chapterIds, names.chapters)
  group('chapter', '章节', chapters, brief(chapters), { chapterIds: [] })
  const tiers = DIFFICULTY_TIERS.filter((t) => filter.difficulties.includes(t.key)).map((t) => t.label)
  group('difficulty', '难度', tiers, tiers.join('、'), { difficulties: [] })
  const knowledge = lookup(filter.knowledgeIds, names.knowledge)
  group('knowledge', '知识点', knowledge, brief(knowledge), { knowledgeIds: [] })
  const tags = lookup(filter.tagIds, names.tags)
  group('tag', '标签', tags, brief(tags), { tagIds: [] })
  return list
}
