// 确认入库：事务内写 source_papers 与 questions，图片此时才写入数据目录。不依赖 Electron。
import type { DatabaseSync } from 'node:sqlite'
import type { ImportResult } from '../../shared/library.ts'
import { assetUrl, saveAsset } from '../assets.ts'
import { isDuplicate } from './dedupe.ts'
import type { PreparedPage } from './prepare.ts'

const IMG_PENDING = /<img\b[^>]*?\bsrc="ewb-pending:(\d+)"[^>]*>/g

// 把内容里的待保存图片换成数据目录里的本地图片；下载失败的图片直接去掉
function localize(html: string, page: PreparedPage, saved: Map<number, string>, db: DatabaseSync, dataDir: string): string {
  return html.replace(IMG_PENDING, (tag, raw: string) => {
    const index = Number(raw)
    const image = page.images[index]
    if (!image) return ''
    let name = saved.get(index)
    if (!name) {
      name = saveAsset(db, dataDir, image.bytes, image.ext)
      saved.set(index, name)
    }
    return tag.replace(`ewb-pending:${index}`, assetUrl(name))
  })
}

export function commitPages(db: DatabaseSync, dataDir: string, pages: PreparedPage[]): ImportResult {
  const now = new Date().toISOString()
  let added = 0
  let skipped = 0
  const findPaper = db.prepare('SELECT id FROM source_papers WHERE url = ?')
  const insertPaper = db.prepare('INSERT INTO source_papers (url, title, fetched_at) VALUES (?, ?, ?)')
  const insertQuestion = db.prepare(
    `INSERT INTO questions (zujuan_qid, source_paper_id, source_label, source_order, question_type, number_count, stem_html, answer_html, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  db.exec('BEGIN')
  try {
    for (const page of pages) {
      const saved = new Map<number, string>()
      let paperId: number | null = null
      for (const q of page.questions) {
        // 预览之后库里可能又多了这道题，写入前再核对一次
        if (q.duplicate || isDuplicate(db, q.qid, q.fingerprint)) {
          skipped++
          continue
        }
        if (paperId === null && page.sourceUrl) {
          const found = findPaper.get(page.sourceUrl) as { id: number } | undefined
          paperId = found ? found.id : Number(insertPaper.run(page.sourceUrl, page.sourceTitle || page.sourceUrl, now).lastInsertRowid)
        }
        insertQuestion.run(
          q.qid,
          paperId,
          q.sourceLabel,
          q.sourceOrder,
          q.questionType,
          q.numberCount,
          localize(q.stemHtml, page, saved, db, dataDir),
          q.answerHtml === null ? null : localize(q.answerHtml, page, saved, db, dataDir),
          q.fingerprint,
          now
        )
        added++
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { added, skipped }
}
