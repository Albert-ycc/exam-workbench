// 下载测试共用的样例：把 seed-dev 的 6 道样例题组成一份试卷草稿。
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DraftSection, ExportOptions, PaperDraft } from '../src/shared/domain.ts'

// seed-dev.ts 里的样例 PNG 数据损坏（块校验与压缩流都不对，浏览器无法解码）。
// 端到端测试要真的把图印出来，所以在样例数据写好后，把样例库里的 PNG 文件换成同样内容的有效图片（192×96，按 96×48 显示）。
const VALID_NUMBER_LINE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAMAAAABgCAIAAADEouq+AAABTElEQVR42u3ZQQ6CMBCG0R6H+5/HuwwLNiSGpLQjI/C+uHLxa+iLUWwhTdRcAgEkgASQAJIAEkACSABJAAkgAdTdZ1mcCkCn0Rw9nBBAg3QwAihHD0MAzephCKBZPQwBNKuHIYAAAqhUD0MAAQQQQAJI9wOUoochn0D0AASQABJAehmgcCcaIIBUCSj8Gw9QiSGnBdC4IUcF0Lgh5wTQICMn9BZAbdckppSdrPdj52aA7ADkQj9kp+clALIDkJ3sne1JgOwAZOfanT0dgOwAZOeqnW86ANkByM7vd47oAGSnDlCTem42AiSABJAeBsiXTT/j/Qqz4060HYDshH/jXWiAALJzbgcgOwDZ+fOdkAASQAJIAEkACSABJIAkgASQABJAEkACSAAJIAkgASSABJAAkgASQAJIAEkACSABJIAkgASQABJAEkACSPWtkMPKy5LANgMAAAAASUVORK5CYII=',
  'base64'
)

export function fixSeedPng(dataDir: string): void {
  for (const name of readdirSync(join(dataDir, 'assets')).filter((n) => n.endsWith('.png'))) writeFileSync(join(dataDir, 'assets', name), VALID_NUMBER_LINE_PNG)
}

export interface SeedQuestion {
  id: number
  sourceLabel: string
  questionType: string
  numberCount: number
  stemHtml: string
  answerHtml: string | null
}

// 每种题型一个大题：单选、填空、计算、解答、完形填空、书面表达；全卷题号 1、2、3、4、5～7、8
export function sampleDraft(questions: SeedQuestion[]): PaperDraft {
  const sections: DraftSection[] = questions.map((q, index) => ({
    id: `sec-${index + 1}`,
    title: q.questionType === '单选题' ? '选择题（每题 3 分）' : q.questionType,
    items: [
      {
        id: `item-${q.id}`,
        originQuestionId: q.id,
        sourceLabel: q.sourceLabel,
        questionType: q.questionType,
        numberCount: q.numberCount,
        stemHtml: q.stemHtml,
        answerHtml: q.answerHtml
      }
    ]
  }))
  return { sections }
}

// 全部有效的下载配置（规整后去重）：答案位置 3 × 来源位置 3 × 作答区域 2 × 格式 2 去掉被规整掉的组合
export function allValidOptions(normalize: (o: ExportOptions) => ExportOptions): ExportOptions[] {
  const seen = new Map<string, ExportOptions>()
  for (const answerPosition of ['end', 'after', 'none'] as const) {
    for (const sourcePosition of ['none', 'before-stem', 'answer'] as const) {
      for (const answerArea of [false, true]) {
        for (const format of ['pdf', 'docx'] as const) {
          const o = normalize({ answerPosition, sourcePosition, answerArea, format })
          seen.set(JSON.stringify([o.answerPosition, o.sourcePosition, o.answerArea, o.format]), o)
        }
      }
    }
  }
  return [...seen.values()]
}

export function optionsLabel(o: ExportOptions): string {
  const answer = { end: '卷尾', after: '题后', none: '不显示' }[o.answerPosition]
  const source = { none: '不显示', 'before-stem': '题文前', answer: '答案处' }[o.sourcePosition]
  return `答案${answer}-来源${source}-作答区${o.answerArea ? '是' : '否'}`
}
