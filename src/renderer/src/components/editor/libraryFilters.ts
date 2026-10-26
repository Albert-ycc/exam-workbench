// 编辑器题库栏的筛选条件：形状、旧值升级、传给接口的条件。纯函数，不依赖界面与 window，端到端测试直接引来断言。
// 共享类型用相对路径带 .ts 后缀引入，这样 Node 直接跑的测试也能加载这个文件。
import { DIFFICULTY_TIERS, NO_CHAPTER, isDifficultyKey, type Chapter, type DifficultyKey, type Tag } from '../../../../shared/classify.ts'
import type { FacetFilter } from '../../../../shared/library.ts'
import { chapterPath } from '../library/chapterPath.ts'

export interface Filters {
  questionType: string
  sourcePaperId: string
  keyword: string
  hideAdded: boolean
  // 「更多筛选」里的四项：同一项内多选取并集，不同项之间取交集
  chapterIds: number[]
  knowledgeIds: number[]
  difficulties: DifficultyKey[]
  tagIds: number[]
}

export const NO_FILTERS: Filters = {
  questionType: '',
  sourcePaperId: '',
  keyword: '',
  hideAdded: false,
  chapterIds: [],
  knowledgeIds: [],
  difficulties: [],
  tagIds: []
}

// localStorage 里记着的条件。升级前只有前四项，所以后四项缺失是正常的，按「没设」补上；
// 只有前四项本身不合格（被改坏、结构不对）才整份作废。
export interface StoredFilters extends Pick<Filters, 'questionType' | 'sourcePaperId' | 'keyword' | 'hideAdded'> {
  chapterIds?: unknown
  knowledgeIds?: unknown
  difficulties?: unknown
  tagIds?: unknown
}

export const isStoredFilters = (value: unknown): value is StoredFilters => {
  const v = value as Partial<StoredFilters> | null
  return !!v && typeof v === 'object' && typeof v.questionType === 'string' && typeof v.sourcePaperId === 'string' && typeof v.keyword === 'string' && typeof v.hideAdded === 'boolean'
}

const uniq = <T,>(list: T[]): T[] => [...new Set(list)]
// 缺失或类型不对的一项按空处理，不影响其余各项
const intList = (value: unknown): number[] => (Array.isArray(value) ? uniq(value.filter((v): v is number => Number.isInteger(v))) : [])
const difficultyList = (value: unknown): DifficultyKey[] => (Array.isArray(value) ? uniq(value.filter(isDifficultyKey)) : [])

export function normalizeFilters(stored: StoredFilters): Filters {
  return {
    questionType: stored.questionType,
    sourcePaperId: stored.sourcePaperId,
    keyword: stored.keyword,
    hideAdded: stored.hideAdded,
    chapterIds: intList(stored.chapterIds),
    knowledgeIds: intList(stored.knowledgeIds),
    difficulties: difficultyList(stored.difficulties),
    tagIds: intList(stored.tagIds)
  }
}

// 四项归类条件里选中的选项总数（「更多筛选」按钮上的数字、弹层外的条件小条都按它）
export const classCount = (f: Filters): number => f.chapterIds.length + f.knowledgeIds.length + f.difficulties.length + f.tagIds.length

// 四项归类条件的组合键：作为 effect 依赖，只在这四项真的变了时才重新读列表（数组引用每次更新都会换）
export const classKey = (f: Filters): string => JSON.stringify([f.chapterIds, f.knowledgeIds, f.difficulties, f.tagIds])

// 传给接口的归类条件：空的一项不传
export function classFilter(f: Filters): Pick<FacetFilter, 'chapterIds' | 'knowledgeIds' | 'difficulties' | 'tagIds'> {
  return {
    chapterIds: f.chapterIds.length ? f.chapterIds : undefined,
    knowledgeIds: f.knowledgeIds.length ? f.knowledgeIds : undefined,
    difficulties: f.difficulties.length ? f.difficulties : undefined,
    tagIds: f.tagIds.length ? f.tagIds : undefined
  }
}

export const NO_CLASS: Pick<Filters, 'chapterIds' | 'knowledgeIds' | 'difficulties' | 'tagIds'> = {
  chapterIds: [],
  knowledgeIds: [],
  difficulties: [],
  tagIds: []
}

// ---------- 生效条件的说明 ----------

export interface ClassCondition {
  kind: 'chapter' | 'difficulty' | 'knowledge' | 'tag'
  kindLabel: string
  id: number | DifficultyKey
  label: string
}

export interface ClassNames {
  chapters: Chapter[] | null // null：还没读到
  tags: Tag[] | null
  knowledgeNames: ReadonlyMap<number, string>
}

// 选中的每一项一条说明，顺序与「更多筛选」弹层一致（章节、难度、知识点、标签）。名称还没读到时写「已选」
export function describeClassFilters(f: Filters, names: ClassNames): ClassCondition[] {
  // 章节写法与试题库页同一处：节写「章名 › 节名」
  const chapterLabel = (id: number): string => (id === NO_CHAPTER ? '未归章节' : (chapterPath(names.chapters ?? [], id) ?? '已选'))
  return [
    ...f.chapterIds.map((id): ClassCondition => ({ kind: 'chapter', kindLabel: '章节', id, label: chapterLabel(id) })),
    ...f.difficulties.map((key): ClassCondition => ({ kind: 'difficulty', kindLabel: '难度', id: key, label: DIFFICULTY_TIERS.find((t) => t.key === key)?.label ?? key })),
    ...f.knowledgeIds.map((id): ClassCondition => ({ kind: 'knowledge', kindLabel: '知识点', id, label: names.knowledgeNames.get(id) ?? '已选' })),
    ...f.tagIds.map((id): ClassCondition => ({ kind: 'tag', kindLabel: '标签', id, label: names.tags?.find((t) => t.id === id)?.name ?? '已选' }))
  ]
}

// 去掉其中一项
export function withoutCondition(f: Filters, item: ClassCondition): Filters {
  switch (item.kind) {
    case 'chapter':
      return { ...f, chapterIds: f.chapterIds.filter((id) => id !== item.id) }
    case 'difficulty':
      return { ...f, difficulties: f.difficulties.filter((key) => key !== item.id) }
    case 'knowledge':
      return { ...f, knowledgeIds: f.knowledgeIds.filter((id) => id !== item.id) }
    case 'tag':
      return { ...f, tagIds: f.tagIds.filter((id) => id !== item.id) }
  }
}

// 题库已不存在的章节与标签（别处删除了）从条件里去掉，否则会一直筛出 0 道题还说不清为什么；「未归章节」不是真章节，保留
export function pruneMissing(f: Filters, chapters: Chapter[] | null, tags: Tag[] | null): Filters {
  const chapterIds = chapters ? f.chapterIds.filter((id) => id === NO_CHAPTER || chapters.some((c) => c.id === id)) : f.chapterIds
  const tagIds = tags ? f.tagIds.filter((id) => tags.some((t) => t.id === id)) : f.tagIds
  return chapterIds.length === f.chapterIds.length && tagIds.length === f.tagIds.length ? f : { ...f, chapterIds, tagIds }
}
