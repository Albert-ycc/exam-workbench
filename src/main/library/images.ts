// 入库时的图片下载：只取组卷网域名下的图片，单张不超过 4MB，按文件头判断格式。
// 不依赖 Electron：下载函数由调用方注入（真实运行用内置浏览器会话的 fetch，测试用假实现）。
import { createHash } from 'node:crypto'

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_HOST = /(^|\.)(xkw\.com|zxxk\.com)$/i

export interface FetchedImage {
  status: number
  contentType: string
  bytes: Uint8Array
}
export type ImageFetcher = (url: string) => Promise<FetchedImage>

export interface DownloadedImage {
  bytes: Uint8Array
  ext: string // png / jpg / gif / svg / webp / bmp
  sha: string // 内容哈希，用于内容指纹
}

// 按文件头判断图片格式；不是图片（如验证页返回的 HTML）返回 null
export function sniffImageExt(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  const head = Buffer.from(b.subarray(0, 600)).toString('utf8').replace(/^﻿/, '').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg'
  return null
}

export function isAllowedImageUrl(raw: string): boolean {
  if (raw.startsWith('data:image/')) return true
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && IMAGE_HOST.test(url.hostname)
  } catch {
    return false
  }
}

function decodeDataUrl(raw: string): Uint8Array | null {
  const comma = raw.indexOf(',')
  if (comma < 0) return null
  const meta = raw.slice(5, comma)
  const body = raw.slice(comma + 1)
  if (meta.endsWith(';base64')) return Buffer.from(body, 'base64')
  // 内联 SVG 常带裸 %（如 width="100%"），解不开按这一张图下载失败处理
  try {
    return Buffer.from(decodeURIComponent(body), 'utf8')
  } catch {
    return null
  }
}

function finish(bytes: Uint8Array): DownloadedImage | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null
  const ext = sniffImageExt(bytes)
  if (!ext) return null
  return { bytes, ext, sha: createHash('sha256').update(bytes).digest('hex') }
}

export async function downloadImage(raw: string, fetcher: ImageFetcher): Promise<DownloadedImage | null> {
  if (!isAllowedImageUrl(raw)) return null
  if (raw.startsWith('data:')) return finish(decodeDataUrl(raw) ?? new Uint8Array())
  // 网络抖动重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(raw)
      if (res.status < 200 || res.status >= 300) {
        if (res.status >= 400 && res.status < 500) return null
        continue
      }
      return finish(res.bytes)
    } catch {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  return null
}

// 并发下载一批图片，返回下标 → 结果（失败为 null）
export async function downloadImages(
  urls: string[],
  indices: number[],
  fetcher: ImageFetcher,
  options: { concurrency?: number; shouldStop?: () => boolean } = {}
): Promise<Map<number, DownloadedImage | null>> {
  const result = new Map<number, DownloadedImage | null>()
  const queue = [...indices]
  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.shouldStop?.()) return
      const index = queue.shift()
      if (index === undefined) return
      result.set(index, await downloadImage(urls[index], fetcher))
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, Math.max(queue.length, 1)) }, worker))
  return result
}
