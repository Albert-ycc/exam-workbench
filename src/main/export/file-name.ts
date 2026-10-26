// 下载文件的命名与落盘路径。纯函数，不依赖 Electron。
import { basename, extname, join, resolve } from 'node:path'
import { editionOf, type ExportKind, type ExportOptions } from '../../shared/domain.ts'

// Windows 文件名不允许的字符，加上控制字符、格式字符（零宽字符、U+202E 等双向控制符，能让文件名在资源管理器里显示成别的样子）和行 / 段分隔符
const INVALID_CHARS = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu
export const MAX_TITLE_CHARS = 60

export function safeFileTitle(title: string): string {
  const cleaned = title.replace(INVALID_CHARS, '').replace(/\s+/g, ' ').trim()
  const limited = [...cleaned].slice(0, MAX_TITLE_CHARS).join('').replace(/[. ]+$/, '')
  return limited || '试卷'
}

// Windows 的设备名：文件名第一个「.」之前的部分是它们（不分大小写、不论后面接什么扩展名）就创建不了文件，
// 例如「LPT9.txt_v1_学生版.pdf」。前面加「_」避开
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i
export function avoidDeviceName(fileName: string): string {
  const first = fileName.split('.')[0].replace(/ +$/, '')
  return DEVICE_NAME.test(first) ? `_${fileName}` : fileName
}

// 「试卷标题_vN_学生版.pdf」「试卷标题_vN_答题卡.pdf」
export function exportFileName(title: string, versionNo: number, options: ExportOptions, kind: ExportKind): string {
  const suffix = kind === 'answer-sheet' ? '答题卡' : editionOf(options)
  return avoidDeviceName(`${safeFileTitle(title)}_v${versionNo}_${suffix}.${options.format}`)
}

// 区分同一版本里不同配置的文件名用词，与下载弹窗的选项原词一致（答案位置「卷尾」「题后」，来源「题文前」「答案处」，作答区域「留作答区域」）。
// 默认配置（答案卷尾、来源不显示、不留作答区域）没有词，文件名不变。
// 传了 against（已有文件的配置）时，只写与它不同的几项，包括「不留作答区域」「来源不显示」这类回到默认的词；
// 版别（学生版 / 教师版）与格式（扩展名）已在文件名里，不在这里
const POSITION_WORD = { end: '卷尾', after: '题后' } as const
const SOURCE_WORD = { none: '来源不显示', 'before-stem': '来源在题文前', answer: '来源在答案处' } as const
export function configWords(options: ExportOptions, against?: ExportOptions): string[] {
  const words: string[] = []
  if (options.answerPosition !== 'none' && (!against || against.answerPosition !== 'none')) {
    const differs = against ? options.answerPosition !== against.answerPosition : options.answerPosition !== 'end'
    if (differs) words.push(POSITION_WORD[options.answerPosition])
  }
  if (against ? options.sourcePosition !== against.sourcePosition : options.sourcePosition !== 'none') words.push(SOURCE_WORD[options.sourcePosition])
  if (against ? options.answerArea !== against.answerArea : options.answerArea) words.push(options.answerArea ? '留作答区域' : '不留作答区域')
  return words
}

// 在扩展名前加「_词」：「标题_v1_学生版.pdf」→「标题_v1_学生版_留作答区域.pdf」
export function withWords(fileName: string, words: string[]): string {
  const ext = extname(fileName)
  return `${basename(fileName, ext)}_${words.join('_')}${ext}`
}

// Windows 与 macOS 默认不区分大小写
export function samePath(a: string, b: string): boolean {
  const x = resolve(a)
  const y = resolve(b)
  return process.platform === 'linux' ? x === y : x.toLowerCase() === y.toLowerCase()
}

// 选一个不会静默覆盖别人的路径：目标不存在，或者已有的就是同一版本同一配置的下载结果（reusable）时直接用。
// fileNames 是按优先顺序排好的候选名（第一个是基础文件名，后面是带配置词的名字）；都被别的文件占着时，
// 在基础文件名上依次加「 (2)」「 (3)」
export function pickTargetPath(dir: string, fileNames: string | string[], exists: (path: string) => boolean, reusable: (path: string) => boolean): string {
  const names = Array.isArray(fileNames) ? fileNames : [fileNames]
  for (const name of names) {
    const candidate = join(dir, name)
    if (!exists(candidate) || reusable(candidate)) return candidate
  }
  const ext = extname(names[0])
  const stem = basename(names[0], ext)
  for (let n = 2; n <= 999; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`)
    if (!exists(candidate) || reusable(candidate)) return candidate
  }
  throw new Error(`保存位置里已有太多同名文件：${names[0]}`)
}
