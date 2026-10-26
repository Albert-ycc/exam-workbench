// 领域模型：试题库原题、试卷草稿、版本快照、下载配置。三条开发线共用，改动需主线统一调整。
import type { KnowledgeRef, TagRef } from './classify'

// ---------- 题目内容约定 ----------
// 1. stemHtml 不含题目开头的题号（如「1．」），题号由界面与导出按顺序生成。
// 2. 一个题目块含多道小题（完形填空、阅读理解等）时，块内每个小题号替换为占位符
//    <span data-ewb-qno="k"></span>，k 为相对本块第一题的偏移（0、1、2…），numberCount 为小题数。
//    单题的 numberCount 为 1，内容里没有占位符。
// 3. 图片一律本地化为 <img src="ewb-asset://<sha256>.<ext>">，原图地址不保留在内容里。
//
// ---------- 分值约定 ----------
// 分值按「每个题号」计：多小题块（完形填空 15 空）的块合计 = 每小题分值 × numberCount。
// 有效分值 = 题目自己的 score ?? 所在大题的 defaultScore ?? 未设。步长 0.5，范围 0–999。
// 计数一律按题号数（Σ numberCount），不按题目块数。统一算法在 shared/numbering.ts 的 structureOf。

export interface LibraryQuestion {
  id: number
  zujuanQid: string | null
  sourcePaperId: number | null
  sourcePaperTitle: string // 来源卷完整标题
  sourceLabel: string // 题目来源标签，如「26-27七年级上·山东德州·阶段检测」，用于「试题来源」配置
  sourceOrder: number // 在来源卷中的顺序，从 0 开始
  questionType: string // 组卷网题型标签原文，如「单选题」「完形填空-15空」「解答题-计算题」；大类在「-」之前（primaryQuestionType）
  numberCount: number
  stemHtml: string
  answerHtml: string | null
  createdAt: string
  // 归类（见 shared/classify.ts）：章节与标签由老师维护，知识点与难度入库时从组卷网读取
  chapterId: number | null
  knowledge: KnowledgeRef[] // 页面上的顺序
  difficulty: number | null // 组卷网难度系数，档位用 difficultyTier 换算
  tags: TagRef[] // 按名称排序
}

export interface SourcePaper {
  id: number
  url: string
  title: string
  fetchedAt: string
  questionCount: number
}

// ---------- 试卷 ----------
// 试卷标题只存在 papers.title；草稿 draft_json 只存大题与题目副本。
// 大题标题不含「一、」这类序号，序号由界面与导出生成。

export interface PaperItem {
  id: string // 草稿内唯一，crypto.randomUUID()
  originQuestionId: number | null // 原题指针，只用于显示出处，不回写原题
  sourceLabel: string // 复制时写入
  questionType: string
  numberCount: number
  stemHtml: string
  answerHtml: string | null
  score?: number | null // 单独设置的每小题分值；未设时跟随大题的 defaultScore
}

export interface DraftSection {
  id: string
  title: string
  defaultScore?: number | null // 本大题每小题的默认分值
  items: PaperItem[]
}

export interface PaperDraft {
  sections: DraftSection[]
  targetScore?: number | null // 目标满分：只用于提示「还差 N 分」，不进版本快照
}

export interface PaperSnapshot {
  title: string
  sections: DraftSection[]
}

// 试卷结构摘要：试卷库、版本历史共用
export interface StructureSummary {
  sectionCount: number
  questionCount: number // 题号数
  totalScore: number | null // 已设分值的合计；一题都没设为 null
  unscoredCount: number // 未设分值的题号数
}

export interface PaperSummary {
  id: number
  title: string
  latestVersionNo: number | null
  draftDirty: boolean
  structure: StructureSummary
  updatedAt: string
  categoryId: number | null // 试卷库分类；null 为「未分类」。分类与标签只用于整理，不进版本快照，改了不动 updatedAt
  tags: TagRef[] // 按名称排序
}

export interface PaperDetail {
  id: number
  title: string
  draft: PaperDraft
  latestVersionNo: number | null
  draftDirty: boolean // 草稿相对最新版本有改动（没有版本时为 true）
  updatedAt: string
}

export type VersionOrigin = 'manual' | 'download' | 'before_restore'

export interface VersionSummary {
  id: number
  paperId: number
  versionNo: number
  note: string
  origin: VersionOrigin
  createdAt: string
  structure: StructureSummary
  exports: ExportRecord[]
}

export interface VersionDetail extends VersionSummary {
  snapshot: PaperSnapshot
}

// ---------- 下载 ----------

export type AnswerPosition = 'end' | 'after' | 'none' // 卷尾 / 题后 / 不显示
export type SourcePosition = 'none' | 'before-stem' | 'answer' // 不显示 / 题文前 / 答案处
export type ExportFormat = 'pdf' | 'docx'
export type ExportKind = 'paper' | 'answer-sheet' // 试卷 / 答题卡（答题卡只出 PDF）

export interface ExportOptions {
  answerPosition: AnswerPosition
  sourcePosition: SourcePosition
  format: ExportFormat
  answerArea: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  answerPosition: 'none',
  sourcePosition: 'none',
  format: 'pdf',
  answerArea: false
}

export interface ExportRecord {
  id: number
  versionId: number
  kind: ExportKind
  format: ExportFormat
  options: ExportOptions
  filePath: string
  createdAt: string
}

// 答案位置为「不显示」时为学生版，否则为教师版
export function editionOf(options: ExportOptions): '学生版' | '教师版' {
  return options.answerPosition === 'none' ? '学生版' : '教师版'
}

// 规整下载配置：答案不显示时来源不能放在答案处；答案在题后时不加作答区域
export function normalizeExportOptions(options: ExportOptions): ExportOptions {
  const next = { ...options }
  if (next.answerPosition === 'none' && next.sourcePosition === 'answer') next.sourcePosition = 'none'
  if (next.answerPosition === 'after') next.answerArea = false
  return next
}
