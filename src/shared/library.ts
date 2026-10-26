// 试题库与入库接口
import type { LibraryQuestion, SourcePaper } from './domain'

export interface QuestionFilter {
  // 题型：等于该值，或以「该值-」开头（组卷网题型标签形如「解答题-计算题」，按「解答题」筛选时包含其子类）
  questionType?: string
  sourcePaperId?: number
  keyword?: string
  // 只取这些题：「本次入库」筛选用
  ids?: number[]
  limit?: number
  offset?: number
}

// 题型分布用的筛选条件：题型本身不参与（各题型的题数要在其他条件不变时一起列出来）
export type FacetFilter = Pick<QuestionFilter, 'sourcePaperId' | 'keyword' | 'ids'>

export interface TypeCount {
  type: string // 题型标签原文，如「解答题」「解答题-计算题」
  count: number
}

export interface LibraryFacets {
  total: number // 全库题数（不受筛选影响）
  withAnswer: number // 全库有答案的题数；为 0 时界面只在顶部提示一次，卡片不逐个标「无答案」
  types: TypeCount[] // 在 FacetFilter 条件下，各题型标签的题数（没有题型的题 type 为空串）
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
}

export interface ImportPreview {
  url: string
  title: string
  questions: ImportPreviewQuestion[]
  imageTotal: number // 需要保存的图片数（已在库的题不下载）
  imageFailed: number
  declaredCount: number | null // 页面自己标明的题数；与 questions.length 不一致说明页面结构可能变了
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
  questionUsage: 'library:question-usage'
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
