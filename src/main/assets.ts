// 图片资源：按内容哈希存放在数据目录 assets/<sha256>.<ext>，内容里用 ewb-asset://<文件名> 引用。
// 本文件不依赖 Electron，可在 node 测试里直接用；协议注册在 asset-protocol.ts。
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export const ASSET_SCHEME = 'ewb-asset'
export const ASSET_NAME = /^[0-9a-f]{64}\.(png|jpg|gif|svg|webp|bmp)$/

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
}

export function extFromMime(mime: string | null | undefined): string | null {
  return EXT_BY_MIME[(mime ?? '').split(';')[0].trim().toLowerCase()] ?? null
}

export function assetPath(dataDir: string, name: string): string {
  if (!ASSET_NAME.test(name)) throw new Error(`非法的图片文件名：${name}`)
  return join(dataDir, 'assets', name)
}

export function assetUrl(name: string): string {
  return `${ASSET_SCHEME}://${name}`
}

// 从 ewb-asset://<文件名> 取出文件名；不是本地图片地址时返回 null
export function assetNameFromUrl(url: string): string | null {
  const match = /^ewb-asset:\/\/([^/?#]+)\/?$/.exec(url.trim())
  return match && ASSET_NAME.test(match[1]) ? match[1] : null
}

// 保存图片，返回文件名（<sha256>.<ext>）；同内容只存一份
export function saveAsset(db: DatabaseSync, dataDir: string, bytes: Uint8Array, ext: string): string {
  const normalized = ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase()
  const hash = createHash('sha256').update(bytes).digest('hex')
  const name = `${hash}.${normalized}`
  if (!ASSET_NAME.test(name)) throw new Error(`不支持的图片格式：${ext}`)
  const file = join(dataDir, 'assets', name)
  if (!existsSync(file)) writeFileSync(file, bytes)
  db.prepare('INSERT OR IGNORE INTO assets (hash, ext, bytes, created_at) VALUES (?, ?, ?, ?)').run(hash, normalized, bytes.byteLength, new Date().toISOString())
  return name
}
