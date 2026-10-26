// 把页面拆题结果整理成入库预览：去重、下载图片、计算内容指纹。不依赖 Electron，下载函数由调用方注入。
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { KnowledgeRef } from '../../shared/classify.ts'
import { classifyZujuanUrl, ZUJUAN_HOST, type ImportPreview } from '../../shared/library.ts'
import { metaGaps, sanitizeMeta } from './classify.ts'
import { duplicateId, fingerprintOf, qidExists, SeenQuestions } from './dedupe.ts'
import type { ExtractedPage, ExtractedQuestion } from './extract-script.ts'
import { downloadImages, type DownloadedImage, type ImageFetcher } from './images.ts'

export interface PreparedQuestion {
  tempId: string
  qid: string | null
  questionType: string
  sourceLabel: string
  sourceOrder: number
  numberCount: number
  stemHtml: string // 图片地址仍是 ewb-pending:<下标>，提交时才写入数据目录
  stemText: string
  answerHtml: string | null
  imageRefs: number[]
  failedImages: number
  fingerprint: string
  duplicate: boolean
  repeatInJob: boolean // 重复是因为本次入库里前面已出现过同一道题：这种重复不补知识点与难度
  knowledge: KnowledgeRef[] // 经 sanitizeMeta 规整后的页面读数，入库时原样写入
  difficulty: number | null
  fill: boolean // 已在库，库里那道题缺知识点或难度而这次读到了
}

export interface PreparedPage {
  declaredCount: number | null // 页面自己标明的题数
  requestedUrl: string
  sourceUrl: string | null // 写入 source_papers 的链接；单题页没有出处时为 null
  sourceTitle: string
  questions: PreparedQuestion[]
  images: (DownloadedImage | null | undefined)[] // 与页面图片下标对齐；undefined 表示没有下载（已在库的题）
  imageUrls: string[]
}

export interface PrepareDeps {
  db: DatabaseSync
  fetchImage: ImageFetcher
  seen: SeenQuestions
  pageIndex: number
  shouldStop?: () => boolean
}

const PENDING = /src="ewb-pending:(\d+)"/g

function imageRefsOf(imageCount: number, ...htmls: (string | null)[]): number[] {
  const refs = new Set<number>()
  for (const html of htmls) {
    if (!html) continue
    for (const m of html.matchAll(PENDING)) if (Number(m[1]) < imageCount) refs.add(Number(m[1]))
  }
  return [...refs]
}

const clamp = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text)

// 来源卷链接：试卷页取规范路径；智能组卷预览页所有人共用同一路径，用题目编号的哈希区分
export function sourcePaperUrl(pageUrl: string, qids: (string | null)[]): string | null {
  const kind = classifyZujuanUrl(pageUrl)
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }
  if (url.hostname !== ZUJUAN_HOST) return null
  if (kind === 'paper') return `https://${ZUJUAN_HOST}${url.pathname}`
  const digest = createHash('sha1').update(qids.filter(Boolean).sort().join(',')).digest('hex').slice(0, 12)
  return `https://${ZUJUAN_HOST}${url.pathname}#sp-${digest}`
}

export async function preparePage(extracted: ExtractedPage, requestedUrl: string, deps: PrepareDeps): Promise<PreparedPage> {
  const { db, seen } = deps
  let sourceUrl: string | null
  let sourceTitle: string
  if (extracted.kind === 'question') {
    const origin = extracted.origin
    sourceUrl = origin && classifyZujuanUrl(origin.url) === 'paper' ? `https://${ZUJUAN_HOST}${new URL(origin.url).pathname}` : null
    sourceTitle = clamp(origin?.title ?? '', 300)
  } else {
    sourceUrl = sourcePaperUrl(extracted.url, extracted.questions.map((q) => q.qid))
    sourceTitle = clamp(extracted.title, 300)
  }

  // 编号已在库的题不下载图片；其余题的图片去重后统一下载
  const needed = new Set<number>()
  for (const q of extracted.questions) {
    if (q.qid && (qidExists(db, q.qid) || seen.hasQid(q.qid))) continue
    for (const index of imageRefsOf(extracted.images.length, q.stemHtml, q.answerHtml)) needed.add(index)
  }
  const downloaded = await downloadImages(extracted.images, [...needed], deps.fetchImage, { shouldStop: deps.shouldStop })
  const images: (DownloadedImage | null | undefined)[] = extracted.images.map((_, i) => downloaded.get(i))

  const questions: PreparedQuestion[] = extracted.questions.map((q: ExtractedQuestion, i) => {
    const imageRefs = imageRefsOf(extracted.images.length, q.stemHtml, q.answerHtml)
    const stemRefs = imageRefsOf(extracted.images.length, q.stemHtml)
    const tokens = stemRefs.map((index) => images[index]?.sha ?? `url:${extracted.images[index]}`)
    const fingerprint = fingerprintOf(q.stemText, tokens)
    const repeatInJob = Boolean(q.qid && seen.hasQid(q.qid)) || seen.has(q.qid, fingerprint)
    const meta = sanitizeMeta({ knowledge: q.knowledge, difficulty: q.difficulty })
    const libraryId = repeatInJob ? null : duplicateId(db, q.qid, fingerprint)
    const duplicate = repeatInJob || libraryId !== null
    let fill = false
    if (libraryId !== null) {
      const gaps = metaGaps(db, libraryId)
      fill = (gaps.knowledge && meta.knowledge.length > 0) || (gaps.difficulty && meta.difficulty !== null)
    }
    // 要补齐的题也登记：同一次入库里再出现的同一道题只算重复，不再重复补
    if (!duplicate || fill) seen.add(q.qid, fingerprint)
    return {
      tempId: `${deps.pageIndex}-${i}`,
      qid: q.qid,
      questionType: clamp(q.questionType, 60),
      sourceLabel: clamp(q.sourceLabel, 120),
      sourceOrder: q.order,
      numberCount: q.numberCount,
      stemHtml: q.stemHtml,
      stemText: q.stemText,
      answerHtml: q.answerHtml,
      imageRefs,
      failedImages: duplicate ? 0 : imageRefs.filter((index) => images[index] === null).length,
      fingerprint,
      duplicate,
      repeatInJob,
      knowledge: meta.knowledge,
      difficulty: meta.difficulty,
      fill
    }
  })
  return { declaredCount: extracted.declaredCount, requestedUrl, sourceUrl, sourceTitle, questions, images, imageUrls: extracted.images }
}

const PREVIEW_CHARS = 40

export function toPreview(page: PreparedPage, title: string): ImportPreview {
  const used = new Set<number>()
  for (const q of page.questions) if (!q.duplicate) q.imageRefs.forEach((index) => used.add(index))
  const imageFailed = [...used].filter((index) => page.images[index] === null).length
  return {
    url: page.requestedUrl,
    title,
    imageTotal: used.size,
    imageFailed,
    declaredCount: page.declaredCount,
    noKnowledge: page.questions.filter((q) => q.knowledge.length === 0).length,
    noDifficulty: page.questions.filter((q) => q.difficulty === null).length,
    error: null,
    questions: page.questions.map((q) => {
      const chars = [...q.stemText]
      return {
        tempId: q.tempId,
        questionType: q.questionType,
        sourceLabel: q.sourceLabel,
        numberCount: q.numberCount,
        previewText: chars.length > PREVIEW_CHARS ? chars.slice(0, PREVIEW_CHARS).join('') + '…' : q.stemText || (q.stemHtml.includes('<img') ? '（仅图片）' : ''),
        hasAnswer: q.answerHtml !== null,
        duplicate: q.duplicate,
        failedImages: q.failedImages,
        knowledgeCount: q.knowledge.length,
        difficulty: q.difficulty,
        fill: q.fill
      }
    })
  }
}
