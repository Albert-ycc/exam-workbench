// ewb-asset:// 协议：界面与导出用它读取数据目录里的图片
import { net, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ASSET_NAME, ASSET_SCHEME, assetPath } from './assets'

// 必须在 app ready 之前调用
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

// app ready 之后调用；dataDir 用函数取，始终指向当前数据目录
export function handleAssetProtocol(dataDir: () => string): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = new URL(request.url).hostname
    if (!ASSET_NAME.test(name)) return new Response('bad asset name', { status: 400 })
    const file = assetPath(dataDir(), name)
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
