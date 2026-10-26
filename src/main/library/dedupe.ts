// 入库去重：有题目编号按编号；没有编号按内容指纹（题干纯文本加图片内容哈希）。不依赖 Electron。
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export function fingerprintOf(stemText: string, imageTokens: string[]): string {
  return createHash('sha256').update(stemText.replace(/\s+/g, ' ').trim()).update('\u0000').update(imageTokens.join(',')).digest('hex')
}

export function qidExists(db: DatabaseSync, qid: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM questions WHERE zujuan_qid = ? LIMIT 1').get(qid))
}

// 库里是否已有这道题：有编号的题，编号相同或与「无编号入库的同内容题」相同算重复；无编号的题，内容指纹相同算重复
export function isDuplicate(db: DatabaseSync, qid: string | null, fingerprint: string): boolean {
  if (qid && qidExists(db, qid)) return true
  const row = db.prepare('SELECT 1 FROM questions WHERE fingerprint = ? AND (? IS NULL OR zujuan_qid IS NULL) LIMIT 1').get(fingerprint, qid)
  return Boolean(row)
}

// 同一次入库任务里已经出现过的题（尚未写入库，也要算重复）
export class SeenQuestions {
  private qids = new Set<string>()
  private fingerprints = new Map<string, boolean>() // 指纹 → 先出现的那道题是否有编号

  hasQid(qid: string): boolean {
    return this.qids.has(qid)
  }

  has(qid: string | null, fingerprint: string): boolean {
    if (qid && this.qids.has(qid)) return true
    const seenWithQid = this.fingerprints.get(fingerprint)
    return seenWithQid !== undefined && (qid === null || !seenWithQid)
  }

  add(qid: string | null, fingerprint: string): void {
    if (qid) this.qids.add(qid)
    if (!this.fingerprints.has(fingerprint)) this.fingerprints.set(fingerprint, Boolean(qid))
  }
}
