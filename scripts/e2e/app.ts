// 端到端测试工具：构建到独立目录，用 Playwright 启动应用（独立的用户目录与数据目录，互不干扰）。
// 各开发线的测试脚本放在 test/e2e/<名称>.e2e.ts，用 node 直接运行。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

export const ROOT = resolve(import.meta.dirname, '../..')

// outDir 用各自的目录（如 out-library），避免多人同时构建互相覆盖 out/
export function buildTo(outDir: string): void {
  execFileSync(join(ROOT, 'node_modules/.bin/electron-vite'), ['build', '--outDir', outDir, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' })
}

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  dataDir: string
  userDataDir: string
}

export async function launchApp(options: { outDir: string; dataDir?: string; userDataDir?: string }): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'ewb-e2e-user-'))
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'ewb-e2e-data-'))
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'config.json'), JSON.stringify({ dataDir }))
  const electronPath = createRequire(import.meta.url)('electron') as unknown as string
  const app = await electron.launch({
    executablePath: electronPath,
    args: [join(resolve(ROOT, options.outDir), 'main/index.js')],
    env: { ...process.env, EWB_USER_DATA: userDataDir, EWB_E2E: '1' }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window, dataDir, userDataDir }
}
