// 端到端测试工具：构建到独立目录，用 Playwright 启动应用（独立的用户目录与数据目录，互不干扰）。
// 各开发线的测试脚本放在 test/e2e/<名称>.e2e.ts，用 node 直接运行。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { makeTempDir } from '../temp-dir.ts'

export const ROOT = resolve(import.meta.dirname, '../..')

const LOCK_RETRY_MS = 2000
const LOCK_MAX_WAIT_MS = 20 * 60 * 1000
const heldLocks = new Set<string>()

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function lockOwner(lockDir: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

// 先改名再删：两个进程同时接管同一把陈旧锁时，只有一个改名成功
function takeOverStale(lockDir: string, stalePid: number | undefined): void {
  if (lockOwner(lockDir) !== stalePid) return
  const grave = `${lockDir}.stale-${process.pid}`
  try {
    renameSync(lockDir, grave)
  } catch {
    return
  }
  rmSync(grave, { recursive: true, force: true })
}

function acquireLock(outDir: string): void {
  const lockDir = `${resolve(ROOT, outDir)}.lock`
  if (heldLocks.has(lockDir)) return
  const deadline = Date.now() + LOCK_MAX_WAIT_MS
  let announced: number | undefined
  for (;;) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, 'pid'), String(process.pid))
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const owner = lockOwner(lockDir)
    if (owner !== undefined && !isAlive(owner)) {
      takeOverStale(lockDir, owner)
      continue
    }
    if (Date.now() > deadline) throw new Error(`等待 ${outDir} 的锁超过 20 分钟（pid ${owner ?? '未知'}）`)
    if (owner !== announced) {
      console.log(`等待 ${outDir} 的锁（pid ${owner ?? '未知'}）`)
      announced = owner
    }
    sleepSync(LOCK_RETRY_MS)
  }
  heldLocks.add(lockDir)
  const release = (): void => {
    if (!heldLocks.delete(lockDir)) return
    rmSync(lockDir, { recursive: true, force: true })
  }
  process.on('exit', release)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(130))
}

// outDir 用各自的目录（如 out-library），避免多人同时构建互相覆盖 out/。
// 同一个 outDir 同时只允许一个进程构建并使用：锁从构建开始持有到本进程退出，所以整套测试跑完才轮到下一个。
export function buildTo(outDir: string): void {
  acquireLock(outDir)
  execFileSync(join(ROOT, 'node_modules/.bin/electron-vite'), ['build', '--outDir', outDir, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' })
}

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  dataDir: string
  userDataDir: string
}

export interface LaunchOptions {
  outDir: string
  dataDir?: string
  userDataDir?: string
  // 默认屏蔽除 127.0.0.1 外的所有域名解析，采集页在拦截生效前发出的请求也出不了网；true 才真正访问外网
  online?: boolean
}

export async function launchApp(options: LaunchOptions): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? makeTempDir('ewb-e2e-user-')
  const dataDir = options.dataDir ?? makeTempDir('ewb-e2e-data-')
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'config.json'), JSON.stringify({ dataDir }))
  const executablePath = createRequire(import.meta.url)('electron') as unknown as string
  // main 目录里有 package.json 时按应用目录启动，app.getVersion() 才是应用的版本号（按脚本路径启动读到的是 Electron 的）
  const mainDir = join(resolve(ROOT, options.outDir), 'main')
  const entry = existsSync(join(mainDir, 'package.json')) ? mainDir : join(mainDir, 'index.js')
  const app = await electron.launch({
    executablePath,
    args: options.online ? [entry] : ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', entry],
    env: { ...process.env, EWB_USER_DATA: userDataDir, EWB_E2E: '1' }
  })
  // 应用导出 PDF 时在系统临时目录建 ewb-pdf-*，进程被杀就留下了；改到本次测试的临时目录里，退出时一起删。
  // macOS 上 app.getPath('temp') 不认 TMPDIR 环境变量，只能启动后改
  await app.evaluate(({ app: electronApp }, dir) => electronApp.setPath('temp', dir), makeTempDir('ewb-e2e-temp-'))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window, dataDir, userDataDir }
}
