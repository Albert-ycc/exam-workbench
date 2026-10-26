// 程序配置与数据目录。配置文件放在系统用户目录下的应用数据里，只记录数据目录位置。
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface AppConfig {
  dataDir?: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function defaultDataDir(): string {
  return join(app.getPath('documents'), '组卷工作台')
}

export function readConfig(): AppConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

export function writeConfig(config: AppConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

// 返回当前数据目录，并确保目录与 assets 子目录存在
export function resolveDataDir(): string {
  const dir = readConfig().dataDir || defaultDataDir()
  mkdirSync(join(dir, 'assets'), { recursive: true })
  return dir
}
