// 编辑器替换题目图片：选一张本地图片，按内容哈希存进数据目录，返回 ewb-asset 地址
import { dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { assetUrl, saveAsset } from '../assets'
import type { AppContext } from '../context'

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']
const MAX_BYTES = 10 * 1024 * 1024

export async function pickImage(ctx: AppContext): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: '选择图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: EXTENSIONS }]
  }
  const win = ctx.mainWindow()
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const file = picked.filePaths[0]
  if (picked.canceled || !file) return null

  const ext = extname(file).slice(1).toLowerCase()
  if (!EXTENSIONS.includes(ext)) throw new Error(`不支持的图片格式：.${ext || '无扩展名'}`)
  if ((await stat(file)).size > MAX_BYTES) throw new Error('图片超过 10MB，请压缩后再选')
  const bytes = await readFile(file)
  if (bytes.byteLength === 0) throw new Error('图片文件是空的')
  return assetUrl(saveAsset(ctx.db(), ctx.dataDir(), bytes, ext))
}
