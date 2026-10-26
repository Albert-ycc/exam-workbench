// 记住上一次的下载配置与保存位置：用户目录下的独立设置文件，与数据目录无关。纯文件读写，不依赖 Electron。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { DEFAULT_EXPORT_OPTIONS, normalizeExportOptions, type ExportKind, type ExportOptions } from '../../shared/domain.ts'
import type { ExportDefaults } from '../../shared/export.ts'

const ANSWER = ['end', 'after', 'none']
const SOURCE = ['none', 'before-stem', 'answer']
const FORMAT = ['pdf', 'docx']

export function isExportOptions(value: unknown): value is ExportOptions {
  const o = value as Partial<ExportOptions> | null
  return (
    typeof o === 'object' &&
    o !== null &&
    ANSWER.includes(o.answerPosition as string) &&
    SOURCE.includes(o.sourcePosition as string) &&
    FORMAT.includes(o.format as string) &&
    typeof o.answerArea === 'boolean'
  )
}

// 只保留四项配置：界面传来的多余字段不写进下载记录与设置文件
export function pickOptions(value: ExportOptions): ExportOptions {
  return normalizeExportOptions({
    answerPosition: value.answerPosition,
    sourcePosition: value.sourcePosition,
    format: value.format,
    answerArea: value.answerArea
  })
}

// 界面传来的配置：校验后只留四项并规整
export function parseOptions(value: unknown): ExportOptions {
  if (!isExportOptions(value)) throw new Error('下载配置不正确')
  return pickOptions(value)
}

// 答题卡没有可选项：固定 PDF，答案、来源、作答区域都不适用。下载记录里存这一份固定配置，
// 这样「同版本同配置覆盖、不同配置加序号」的规则对答题卡同样成立（同一版本的答题卡永远是同一份配置）
export const ANSWER_SHEET_OPTIONS: ExportOptions = { answerPosition: 'none', sourcePosition: 'none', format: 'pdf', answerArea: false }

// 界面传来的下载类型与配置：类型必须认得；答题卡不看传来的配置
export function parseTarget(kind: unknown, options: unknown): { kind: ExportKind; options: ExportOptions } {
  if (kind === 'answer-sheet') return { kind, options: ANSWER_SHEET_OPTIONS }
  if (kind === 'paper') return { kind, options: parseOptions(options) }
  throw new Error('下载类型不正确')
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// 界面或设置文件传来的保存位置：必须是已存在文件夹的完整路径。相对路径（「.」「..」）会落到程序自己的工作目录里，一律拒绝
export function checkDirectory(path: unknown): string {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('请先选择保存位置')
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new Error('保存位置里有不能用的字符，请点「更改…」重新选择文件夹')
  if (!isAbsolute(path)) throw new Error(`保存位置必须是完整路径（如 C:\\Users\\你的用户名\\Downloads），「${path}」不是，请点「更改…」选择文件夹`)
  if (!isDirectory(path)) throw new Error(`保存位置不存在：${path}`)
  return path
}

// 读设置；文件不存在、损坏或保存位置已不存在时，对应项回到默认值
export function readExportDefaults(file: string, defaultDirectory: string): ExportDefaults {
  let raw: { options?: unknown; directory?: unknown } = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) raw = parsed as typeof raw
  } catch {
    // 首次使用或文件损坏
  }
  const options = isExportOptions(raw.options) ? pickOptions(raw.options) : DEFAULT_EXPORT_OPTIONS
  const directory = typeof raw.directory === 'string' && isAbsolute(raw.directory) && isDirectory(raw.directory) ? raw.directory : defaultDirectory
  return { options, directory }
}

export function writeExportDefaults(file: string, settings: ExportDefaults): void {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ options: pickOptions(settings.options), directory: settings.directory }, null, 2), 'utf8')
}
