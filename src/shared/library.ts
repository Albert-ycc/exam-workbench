// 试题库与入库接口
import type { Chapter, DifficultyKey, KnowledgeRef, Tag, TagChange, TagRenameResult } from './classify'
import type { LibraryQuestion, SourcePaper } from './domain'

export interface QuestionFilter {
  // 题型：等于该值，或以「该值-」开头（组卷网题型标签形如「解答题-计算题」，按「解答题」筛选时包含其子类）
  questionType?: string
  sourcePaperId?: number
  keyword?: string
  // 只取这些题：「本次入库」筛选用
  ids?: number[]
  // 归类条件：同一项内多选取并集，不同项之间取交集；空数组等于不设
  chapterIds?: number[] // 选章包含其下各节；NO_CHAPTER（0）为「未归章节」
  knowledgeIds?: number[]
  difficulties?: DifficultyKey[]
  tagIds?: number[]
  limit?: number
  offset?: number
}

// 题数统计用的筛选条件：每一项的题数按其他条件计算、本项不参与
export type FacetFilter = Omit<QuestionFilter, 'limit' | 'offset'>

// 批量操作的对象：勾选的题，或「全选筛出的 N 道」时的筛选条件（由主进程按条件取题，不受分页影响）
export type QuestionTarget = { ids: number[] } | { filter: FacetFilter }

export interface TypeCount {
  type: string // 题型标签原文，如「解答题」「解答题-计算题」
  count: number
}

export interface KnowledgeCount extends KnowledgeRef {
  count: number
}

export interface LibraryFacets {
  total: number // 全库题数（不受筛选影响）
  withAnswer: number // 全库有答案的题数；为 0 时界面只在顶部提示一次，卡片不逐个标「无答案」
  types: TypeCount[] // 在 FacetFilter 条件下，各题型标签的题数（没有题型的题 type 为空串）
  // 以下各项同样按「其他条件」计算；题数为 0 的不列，当前选中的除外（以 0 列出，筛选栏里要看得到自己选了什么）
  chapters: { id: number; count: number }[] // 章包含其下各节；id 为 NO_CHAPTER 的是「未归章节」
  knowledge: KnowledgeCount[] // 题多的在前
  difficulties: { key: DifficultyKey; count: number }[] // 按 DIFFICULTY_TIERS 的顺序
  tags: { id: number; count: number }[]
}

export interface QuestionPage {
  total: number
  items: LibraryQuestion[]
}

export interface ImportPreviewQuestion {
  tempId: string
  questionType: string
  sourceLabel: string
  numberCount: number
  previewText: string // 题干纯文本前若干字
  hasAnswer: boolean
  duplicate: boolean // 试题库里已有同一道题（或本次入库里已出现），确认入库时跳过
  failedImages: number // 本题下载失败的图片数
  knowledgeCount: number // 本题读到的知识点数
  difficulty: number | null // 本题读到的难度系数
  fill: boolean // 已在库、库里那道题缺知识点或难度而这次读到了，确认入库时补上（L3）
}

export interface ImportPreview {
  url: string
  title: string
  questions: ImportPreviewQuestion[]
  imageTotal: number // 需要保存的图片数（已在库的题不下载）
  imageFailed: number
  declaredCount: number | null // 页面自己标明的题数；与 questions.length 不一致说明页面结构可能变了
  noKnowledge: number // 本页没取到知识点的题数（含已在库的题）；组卷网改版导致读不到时这里会接近总题数（L2）
  noDifficulty: number // 本页没取到难度的题数（含已在库的题），用途同上
  error: string | null // 本条链接失败的原因
}

export interface ImportProgress {
  jobId: string
  total: number // 本次链接条数（整页入库为 1）
  done: number
  current: string // 正在处理的链接
  waitingForUser: string | null // 遇到验证码等需要用户在内置浏览器里处理时的提示
  previews: ImportPreview[]
  finished: boolean
}

export interface ImportResult {
  added: number
  skipped: number
  filled: number // 已在库的题补上了知识点或难度的题数
}

// 界面拿到的入库结果：带上本次新增的题号，「去试题库看本次入库」据此筛选
export interface ImportCommitResult extends ImportResult {
  addedIds: number[]
}

export interface LibraryApi {
  listQuestions(filter: QuestionFilter): Promise<QuestionPage>
  getQuestion(id: number): Promise<LibraryQuestion | null>
  listSourcePapers(): Promise<SourcePaper[]>
  listQuestionTypes(): Promise<string[]>
  deleteQuestion(id: number): Promise<void>
  importUrls(urls: string[]): Promise<{ jobId: string }>
  importCurrentPage(): Promise<{ jobId: string }>
  onImportProgress(listener: (progress: ImportProgress) => void): () => void
  commitImport(jobId: string): Promise<ImportCommitResult>
  cancelImport(jobId: string): Promise<void>
  facets(filter: FacetFilter): Promise<LibraryFacets>
  // 每道题被多少份试卷的草稿用到（草稿里 originQuestionId 等于该题）；没有用到的题不出现在结果里
  questionUsage(ids: number[]): Promise<Record<number, number>>
  // 按条件取全部题号（「全选筛出的 N 道」的计数与勾选用），按列表顺序
  listQuestionIds(filter: FacetFilter): Promise<number[]>

  // 章节：两级目录。名称按 normalizeClassName(…, CLASS_NAME_MAX) 规整，同级重名报错；删除章连同其下各节，题回到「未归章节」
  listChapters(): Promise<Chapter[]> // 章在前、节紧跟其章，各按 position
  createChapter(name: string, parentId?: number | null): Promise<Chapter>
  renameChapter(id: number, name: string): Promise<void>
  moveChapter(id: number, toIndex: number): Promise<void> // 同级内调顺序
  deleteChapter(id: number): Promise<{ questions: number }> // 返回回到「未归章节」的题数
  // 归到章节：chapterId 为 null 时移出章节；一题只属于一个章节，再归一次即移动。返回涉及的题数
  assignChapter(target: QuestionTarget, chapterId: number | null): Promise<number>

  // 题目标签：名称按 normalizeClassName(…, TAG_NAME_MAX) 规整，同名（不分英文大小写）视为同一个
  listTags(): Promise<Tag[]> // 按名称排序
  createTag(name: string): Promise<Tag> // 已有同名标签时返回那一个
  renameTag(id: number, name: string): Promise<TagRenameResult>
  deleteTag(id: number): Promise<void>
  changeQuestionTags(target: QuestionTarget, change: TagChange): Promise<number> // 返回涉及的题数
}

export const LIBRARY_IPC = {
  listQuestions: 'library:list-questions',
  getQuestion: 'library:get-question',
  listSourcePapers: 'library:list-source-papers',
  listQuestionTypes: 'library:list-question-types',
  deleteQuestion: 'library:delete-question',
  importUrls: 'library:import-urls',
  importCurrentPage: 'library:import-current-page',
  importProgress: 'library:import-progress',
  commitImport: 'library:commit-import',
  cancelImport: 'library:cancel-import',
  facets: 'library:facets',
  questionUsage: 'library:question-usage',
  listQuestionIds: 'library:list-question-ids',
  listChapters: 'library:list-chapters',
  createChapter: 'library:create-chapter',
  renameChapter: 'library:rename-chapter',
  moveChapter: 'library:move-chapter',
  deleteChapter: 'library:delete-chapter',
  assignChapter: 'library:assign-chapter',
  listTags: 'library:list-tags',
  createTag: 'library:create-tag',
  renameTag: 'library:rename-tag',
  deleteTag: 'library:delete-tag',
  changeQuestionTags: 'library:change-question-tags'
} as const

// ---------- 组卷网链接规则（主进程校验与界面按钮可用性共用） ----------

export const ZUJUAN_HOST = 'zujuan.xkw.com'

// paper：试卷页 /2p3543573.html；question：单题页 /2q17150767.html；smart：智能组卷预览页（所有人共用同一网址，只能整页入库）
export type ZujuanPageKind = 'paper' | 'question' | 'smart'

export function classifyZujuanUrl(raw: string): ZujuanPageKind | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname !== ZUJUAN_HOST) return null
  if (/^\/\d+p\d+\.html$/.test(url.pathname)) return 'paper'
  if (/^\/\d+q\d+\.html$/.test(url.pathname)) return 'question'
  if (/^\/zhineng-view\/?$/.test(url.pathname)) return 'smart'
  return null
}

// 粘贴框里的文字拆成链接：空白分隔，去重，保持顺序
export function splitPastedLinks(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter(Boolean))]
}

// 粘贴链接入库只接受试卷页与单题页；统一成 https、去掉查询参数与锚点
export function normalizeImportUrl(raw: string): string | null {
  const kind = classifyZujuanUrl(raw)
  if (kind !== 'paper' && kind !== 'question') return null
  const url = new URL(raw.trim())
  return `https://${ZUJUAN_HOST}${url.pathname}`
}

// 题型标签「解答题-计算题」的大类部分
export function primaryQuestionType(type: string): string {
  const index = type.indexOf('-')
  return index > 0 ? type.slice(0, index) : type
}

// 题型的常用顺序：选择 → 填空 → 阅读 → 解答 → 写作。组卷网返回的题型原文按字母排，老师找起来不顺手；
// 不在表里的题型排在后面，按题数多的在前。大类与子类（「解答题-计算题」取「计算题」）各按自己的名字查表。
const TYPE_ORDER = [
  '单选题', '单项选择', '选择题', '多选题', '不定项选择', '判断题', '语音题',
  '填空题', '完形填空', '短文填空', '语法填空',
  '阅读理解', '任务型阅读', '七选五',
  '实验题', '作图题', '计算题', '解答题', '问答题', '应用题', '综合题',
  '书面表达'
]

export function typeRank(name: string): number {
  const index = TYPE_ORDER.indexOf(name)
  return index === -1 ? TYPE_ORDER.length : index
}

export function compareTypeNames(a: { name: string; count: number }, b: { name: string; count: number }): number {
  return typeRank(a.name) - typeRank(b.name) || b.count - a.count || a.name.localeCompare(b.name, 'zh')
}
