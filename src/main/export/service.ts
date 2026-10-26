// 下载流程：先生成到临时文件，再存版本，再记下载记录并改名落盘，最后记住本次配置。
// 渲染器（PDF / Word）由外部注入，所以这里不依赖 Electron，版本、命名、覆盖保护的逻辑可以在 node 里直接测。
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ExportKind, ExportOptions, PaperSnapshot } from '../../shared/domain.ts'
import type { ExportCheck, ExportDefaults, ExportRequest, ExportResult } from '../../shared/export.ts'
import { assetPath } from '../assets.ts'
import { ensureVersionForDownload, getExport, getPaper, getVersion, recordExport, transaction } from '../papers/repo.ts'
import { buildCardDocument, type CardDocument } from './card.ts'
import { checkDraft } from './check.ts'
import { buildExportDocument, documentNodes, type ExportDocument } from './document.ts'
import { configWords, exportFileName, pickTargetPath, samePath, withWords } from './file-name.ts'
import { collectImages } from './html-tree.ts'
import { parseImageSource } from './image-src.ts'
import { countPdfPages } from './pdf-pages.ts'
import { checkDirectory, isDirectory, parseTarget, readExportDefaults, writeExportDefaults } from './settings.ts'
import { isAbsolute } from 'node:path'

export interface Renderers {
  pdf(doc: ExportDocument): Promise<Uint8Array>
  docx(doc: ExportDocument): Promise<Uint8Array>
  card(doc: CardDocument): Promise<Uint8Array>
}

export interface ExportServiceDeps {
  db(): DatabaseSync
  dataDir(): string
  settingsFile(): string
  defaultDirectory(): string
  renderers: Renderers
}

// 下载时自动存的版本说明：不写格式与版别，同一个版本后面还会挂别的下载
const AUTO_VERSION_NOTE = '下载时自动保存'
const MAX_ATTEMPTS = 3

// 事务内发现草稿已不是生成时的样子：只用来让事务回滚，不外抛
class SnapshotChanged extends Error {}

function optionsKey(kind: ExportKind, o: ExportOptions): string {
  return [kind, o.answerPosition, o.sourcePosition, o.format, o.answerArea].join('|')
}

// 一次下载要生成的东西：内容检查已通过，render 才真正排版
interface Prepared {
  missingAnswers: string[]
  render(): Promise<Uint8Array>
}

function friendlyWriteError(error: unknown, target: string): Error {
  const code = (error as NodeJS.ErrnoException)?.code
  const name = basename(target)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return new Error(`无法保存「${name}」：文件正在被其他程序打开，或没有写入权限`)
  if (code === 'ENOSPC') return new Error('磁盘空间不足，无法保存文件')
  if (code === 'ENOENT') return new Error(`保存位置不存在：${dirname(target)}`)
  if (code === 'ENAMETOOLONG') return new Error('保存位置的路径太长，请换一个较浅的文件夹或缩短试卷标题')
  return error instanceof Error ? error : new Error(String(error))
}

// 先写到保存位置里的临时文件：保存位置不能写会在这一步暴露，此时还没存版本；写好再改名成正式文件名
function writeTemp(directory: string, bytes: Uint8Array): string {
  const tmp = join(directory, `.ewb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  try {
    writeFileSync(tmp, bytes)
  } catch (error) {
    rmSync(tmp, { force: true })
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new Error(`无法写入保存位置「${directory}」：没有写入权限，请换一个文件夹`)
    throw friendlyWriteError(error, join(directory, '下载文件'))
  }
  return tmp
}

function moveTemp(tmp: string, target: string): void {
  try {
    renameSync(tmp, target)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw friendlyWriteError(error, target)
  }
}

export function createExportService(deps: ExportServiceDeps) {
  // 同一时间只生成一份：避免两个隐藏窗口抢资源，也避免版本号竞争
  let tail: Promise<unknown> = Promise.resolve()
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }

  function prepare(kind: ExportKind, snapshot: PaperSnapshot, options: ExportOptions): Prepared {
    if (kind === 'answer-sheet') {
      const card = buildCardDocument(snapshot)
      return { missingAnswers: [], render: () => deps.renderers.card(card) }
    }
    const doc = buildExportDocument(snapshot, options)
    const missing = new Set<string>()
    for (const img of collectImages(documentNodes(doc))) {
      const source = parseImageSource(img.attrs.src ?? '')
      if (source?.kind === 'asset' && !existsSync(assetPath(deps.dataDir(), source.name))) missing.add(source.name)
    }
    if (missing.size > 0) throw new Error(`有 ${missing.size} 张图片的文件找不到，请在编辑器中删除或替换这些图片后再下载`)
    return { missingAnswers: doc.missingAnswers, render: () => (doc.options.format === 'pdf' ? deps.renderers.pdf(doc) : deps.renderers.docx(doc)) }
  }

  // 生成并写到保存位置里的临时文件
  async function produce(kind: ExportKind, snapshot: PaperSnapshot, options: ExportOptions, directory: string): Promise<{ tmp: string; prepared: Prepared; pageCount: number | null }> {
    const prepared = prepare(kind, snapshot, options)
    const bytes = await prepared.render()
    return { tmp: writeTemp(directory, bytes), prepared, pageCount: options.format === 'pdf' ? countPdfPages(bytes) : null }
  }

  // 同名文件已存在时：同一版本同一类型同一配置的下载结果可以原位覆盖；不同配置的用区分它的配置词（「_留作答区域」「_来源在题文前」）
  // 另起文件名，都区分不了才加序号。默认配置的文件名不变。
  // versionId 为 null 表示还没有对应的版本（草稿有改动，下载时才会存新版本），已有的同名文件一定是别的下载留下的
  function targetPathFor(directory: string, fileName: string, versionId: number | null, kind: ExportKind, options: ExportOptions): string {
    const key = optionsKey(kind, options)
    const rows = deps.db().prepare('SELECT file_path, version_id, kind, options_json FROM exports').all() as unknown as { file_path: string; version_id: number; kind: ExportKind; options_json: string }[]
    const recordAt = (path: string) => (versionId === null ? undefined : rows.find((r) => r.version_id === versionId && r.kind === kind && samePath(r.file_path, path)))
    const reusable = (path: string): boolean => {
      const record = recordAt(path)
      return record !== undefined && optionsKey(record.kind, JSON.parse(record.options_json) as ExportOptions) === key
    }
    const candidates = [fileName]
    if (kind === 'paper') {
      // 先写与占着基础文件名的那份下载的区别（它的配置有记录时），再写本次配置里所有非默认的项
      const occupant = recordAt(join(directory, fileName))
      for (const words of [configWords(options, occupant ? (JSON.parse(occupant.options_json) as ExportOptions) : undefined), configWords(options)]) {
        const named = words.length > 0 ? withWords(fileName, words) : null
        if (named && !candidates.includes(named)) candidates.push(named)
      }
    }
    return pickTargetPath(directory, candidates, existsSync, reusable)
  }

  // 临时文件改名成正式文件名并记下载记录；返回最终路径，以及是否盖掉了已有的同名文件
  function place(tmp: string, directory: string, snapshot: PaperSnapshot, versionNo: number, versionId: number, kind: ExportKind, options: ExportOptions): { filePath: string; overwritten: boolean } {
    const target = targetPathFor(directory, exportFileName(snapshot.title, versionNo, options, kind), versionId, kind, options)
    const overwritten = existsSync(target)
    // 记录先写、改名最后做：改名失败时记录随事务撤销
    transaction(deps.db(), () => {
      recordExport(deps.db(), versionId, options.format, options, target, kind)
      moveTemp(tmp, target)
    })
    return { filePath: target, overwritten }
  }

  return {
    getDefaults(): ExportDefaults {
      return readExportDefaults(deps.settingsFile(), deps.defaultDirectory())
    },

    // 设置页改默认保存位置：目录必须存在；上一次的试卷配置原样保留
    setDefaultDirectory(directory: string): ExportDefaults {
      checkDirectory(directory)
      const current = readExportDefaults(deps.settingsFile(), deps.defaultDirectory())
      writeExportDefaults(deps.settingsFile(), { options: current.options, directory })
      return { options: current.options, directory }
    },

    // 预览文件名。传了保存位置时给出重名后的实际名字（「…_学生版 (2).pdf」），与下载时落盘的名字一致
    previewFileName(paperId: number, rawOptions: unknown, rawKind: unknown, directory?: string): string {
      const { kind, options } = parseTarget(rawKind, rawOptions)
      const paper = getPaper(deps.db(), Number(paperId))
      const versionNo = paper.draftDirty ? (paper.latestVersionNo ?? 0) + 1 : paper.latestVersionNo!
      const name = exportFileName(paper.title, versionNo, options, kind)
      if (typeof directory !== 'string' || !isAbsolute(directory) || !isDirectory(directory)) return name
      const latest = paper.draftDirty ? undefined : (deps.db().prepare('SELECT id FROM paper_versions WHERE paper_id = ? AND version_no = ?').get(paper.id, versionNo) as { id: number } | undefined)
      return basename(targetPathFor(directory, name, latest?.id ?? null, kind, options))
    },

    // 检查当前草稿在这个下载类型与配置下的情况，弹窗据此提示、置灰与定位
    checkExport(paperId: number, rawOptions: unknown, rawKind: unknown): ExportCheck {
      const { kind, options } = parseTarget(rawKind, rawOptions)
      const paper = getPaper(deps.db(), Number(paperId))
      return checkDraft(paper.draft, options, kind)
    },

    exportPaper(request: ExportRequest): Promise<ExportResult> {
      return serial(async () => {
        const db = deps.db()
        const paperId = Number(request.paperId)
        const { kind, options } = parseTarget(request.kind, request.options)
        const directory = checkDirectory(request.directory)

        // 先用草稿生成文件并写到临时文件：内容有问题（没有题、没有答案、图片丢失）、生成失败、保存位置不能写，
        // 都发生在存版本之前。存版本、比对快照、改名与记下载记录在同一个事务里，任何一步失败版本一并撤销，不留孤儿版本
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const paper = getPaper(db, paperId)
          const draftSnapshot: PaperSnapshot = { title: paper.title, sections: paper.draft.sections }
          const made = await produce(kind, draftSnapshot, options, directory)
          try {
            const result = transaction(db, () => {
              const { version, created } = ensureVersionForDownload(db, paperId, AUTO_VERSION_NOTE)
              // 生成期间草稿又被改了：文件和存下的版本对不上，撤销重来
              if (JSON.stringify(version.snapshot) !== JSON.stringify(draftSnapshot)) throw new SnapshotChanged()
              const placed = place(made.tmp, directory, version.snapshot, version.versionNo, version.id, kind, options)
              return { version, created, ...placed }
            })
            // 答题卡没有可选项，不覆盖「上一次的试卷配置」，只记保存位置
            const remembered = kind === 'paper' ? options : readExportDefaults(deps.settingsFile(), deps.defaultDirectory()).options
            writeExportDefaults(deps.settingsFile(), { options: remembered, directory })
            return { kind, versionNo: result.version.versionNo, filePath: result.filePath, overwritten: result.overwritten, createdVersion: result.created, pageCount: made.pageCount, missingAnswers: made.prepared.missingAnswers }
          } catch (error) {
            rmSync(made.tmp, { force: true })
            if (!(error instanceof SnapshotChanged)) throw error
          }
        }
        throw new Error('生成期间试卷内容一直在变，请稍后再下载')
      })
    },

    // 按下载记录里的版本、类型与配置重新生成，文件放回原来的文件夹（原文件夹没了就放最近用过的保存位置）
    reexport(exportId: number): Promise<ExportResult> {
      return serial(async () => {
        const record = getExport(deps.db(), Number(exportId))
        const version = getVersion(deps.db(), record.versionId)
        const { kind, options } = parseTarget(record.kind, record.options)
        const original = dirname(record.filePath)
        const directory = isDirectory(original) ? original : readExportDefaults(deps.settingsFile(), deps.defaultDirectory()).directory
        const made = await produce(kind, version.snapshot, options, directory)
        const { filePath, overwritten } = place(made.tmp, directory, version.snapshot, version.versionNo, version.id, kind, options)
        return { kind, versionNo: version.versionNo, filePath, overwritten, createdVersion: false, pageCount: made.pageCount, missingAnswers: made.prepared.missingAnswers }
      })
    },

    // 只有下载记录里出现过的文件才允许在文件夹中显示
    isRecordedPath(path: string): boolean {
      const rows = deps.db().prepare('SELECT file_path FROM exports').all() as unknown as { file_path: string }[]
      return rows.some((r) => samePath(r.file_path, path))
    },
  }
}

export type ExportService = ReturnType<typeof createExportService>
