// 下载接口
import type { ExportKind, ExportOptions } from './domain'

export interface ExportRequest {
  paperId: number
  kind: ExportKind // 试卷 / 答题卡；答题卡固定出 PDF，options 里除保存位置外的配置不起作用
  options: ExportOptions
  directory: string
}

export interface ExportResult {
  kind: ExportKind
  versionNo: number
  filePath: string
  overwritten: boolean // 保存位置里原来就有同一个文件（同版本同配置的上次下载），这次把它覆盖了
  createdVersion: boolean // 本次下载是否新存了一个版本
  pageCount: number | null // PDF 的页数；Word 的页数要打开后才排得出来，为 null
  missingAnswers: string[] // 答案位置不是「不显示」时，没有答案的题的题号（如「4」「8～22」），界面据此提示
}

// ---------- 下载前自检 ----------

export type ExportIssueType =
  | 'empty-paper' // 试卷没有题目
  | 'no-answers' // 全部题都没有答案，却选了卷尾 / 题后
  | 'partial-answers' // 部分题没有答案（选了卷尾 / 题后）
  | 'unscored' // 有题没设分值
  | 'empty-section' // 空大题（下载时跳过，后面的大题序号顺延）
  | 'unnamed-section' // 大题没有名称
  | 'empty-stem' // 题干是空的
  | 'duplicate-question' // 同一道原题出现多次
  | 'score-mismatch' // 全卷分值合计与目标满分不符（草稿里设了目标满分才检查）

export interface ExportIssue {
  type: ExportIssueType
  blocking: boolean // 阻止按当前类型与配置下载；false 只是提示
  message: string // 可直接显示的说明
  questionNos: number[] // 相关题号（全卷题号），界面据此做可点击定位；没有相关题时为空
  questionLabel: string // questionNos 的紧凑写法，如「2、4、8～22」
  sectionIndex: number | null // 空大题所在的位置（从 0 起），其余为 null
}

export interface ExportCheck {
  kind: ExportKind
  questionCount: number // 题号数
  answerMissingCount: number // 没有答案的题号数；等于 questionCount 说明整卷没有答案，教师版不能下载
  issues: ExportIssue[] // 阻止项在前，提示在后；只含与当前下载类型和配置相关的问题
  blocked: boolean // 有阻止项：当前类型与配置不能下载
}

export interface ExportDefaults {
  options: ExportOptions // 上一次使用的试卷配置（答题卡不影响它）
  directory: string // 上一次的保存位置，首次为系统「下载」文件夹
}

export interface ExportApi {
  getDefaults(): Promise<ExportDefaults>
  chooseDirectory(current: string): Promise<string | null>
  // 把默认保存位置写进设置（目录必须存在），上一次的试卷配置原样保留；返回写入后的设置。设置页用
  setDefaultDirectory(directory: string): Promise<ExportDefaults>
  // 预览文件名，例如「七年级数学第一单元测试_v3_学生版.pdf」「七年级数学第一单元测试_v3_答题卡.pdf」。
  // 传了 directory 时，返回保存位置里重名后的实际文件名（「…_学生版 (2).pdf」）
  previewFileName(paperId: number, options: ExportOptions, kind: ExportKind, directory?: string): Promise<string>
  // 检查当前草稿；草稿里设了目标满分（draft.targetScore）时一并检查总分
  checkExport(paperId: number, options: ExportOptions, kind: ExportKind): Promise<ExportCheck>
  exportPaper(request: ExportRequest): Promise<ExportResult>
  // 用某条下载记录对应的版本、类型和配置重新生成文件
  reexport(exportId: number): Promise<ExportResult>
  showInFolder(filePath: string): Promise<void>
}

// 题号列表的紧凑写法：连续三个及以上写成范围，其余用顿号，如 [2,4,8,9,10,11] → 「2、4、8～11」
export function formatQuestionNos(nos: number[]): string {
  const sorted = [...new Set(nos)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    if (j - i >= 2) parts.push(`${sorted[i]}～${sorted[j]}`)
    else for (let k = i; k <= j; k++) parts.push(String(sorted[k]))
    i = j + 1
  }
  return parts.join('、')
}

// 作答区域：计算题、解答题题后留白的高度（毫米）。生成文件与下载弹窗的说明文字共用这一处
export const ANSWER_SPACE_MM = { calc: 36, solve: 32 } as const
// PDF 按页摊开作答空白时，其他题型的基础空白（毫米）：单题（选择、填空等）与多小题块；书面表达画横线不留白。
// 每页剩下的高度再按各题基础空白的比例摊进去（export/paginate.ts）。Word 只给计算、解答题留固定高度
export const PDF_FILL_MM = { single: 12, block: 6 } as const

export const EXPORT_IPC = {
  getDefaults: 'export:get-defaults',
  chooseDirectory: 'export:choose-directory',
  setDefaultDirectory: 'export:set-default-directory',
  previewFileName: 'export:preview-file-name',
  checkExport: 'export:check',
  exportPaper: 'export:export-paper',
  reexport: 'export:reexport',
  showInFolder: 'export:show-in-folder'
} as const
