// 退出可靠性：主窗口关了程序就退出（导出用的隐藏窗口不拦）；安装程序用 --quit 请程序退出；单独带 --quit 启动的进程立即结束。
// 程序留在后台会让安装程序更新时报「正在运行」。用法：node test/e2e/quit.e2e.ts
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { buildTo, launchApp, ROOT } from '../../scripts/e2e/app.ts'

const OUT = 'out-smoke'
const EXIT_MS = 8000
buildTo(OUT)
let step = 0
const log = (text: string): void => console.log(`  ✓ ${++step}. ${text}`)

const exitsWithin = (app: ElectronApplication, what: string): Promise<void> =>
  new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${what}：${EXIT_MS}ms 内进程没有退出`)), EXIT_MS)
    app.once('close', () => {
      clearTimeout(timer)
      done()
    })
  })
// 触发退出的那次 evaluate 可能因为进程已经结束而报错，不算失败
const trigger = (p: Promise<unknown>): Promise<void> => p.then(() => undefined, () => undefined)

{
  const { app } = await launchApp({ outDir: OUT })
  await app.evaluate(({ BrowserWindow }) => {
    const hidden = new BrowserWindow({ show: false })
    void hidden.loadURL('about:blank')
  })
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2)
  const exited = exitsWithin(app, '隐藏窗口在场时关主窗口')
  // 主窗口按标题找：刚启动时 ready-to-show 可能还没到，isVisible 还是 false
  await trigger(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === '组卷工作台')!.close()))
  await exited
  log('隐藏窗口还开着，关掉主窗口后进程照样退出')
}

{
  const { app } = await launchApp({ outDir: OUT })
  const exited = exitsWithin(app, '--quit 转交给正在运行的实例')
  await trigger(app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance', {}, [process.execPath, '--quit'], process.cwd())))
  await exited
  log('收到第二个实例转来的 --quit 后退出')
}

{
  const electronPath = createRequire(import.meta.url)('electron') as unknown as string
  const child = spawn(electronPath, ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', join(resolve(ROOT, OUT), 'main/index.js'), '--quit'], {
    env: { ...process.env, EWB_E2E: '1' },
    stdio: 'ignore'
  })
  const code = await new Promise<number | null>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`单独带 --quit 启动：${EXIT_MS}ms 内进程没有退出`))
    }, EXIT_MS)
    child.once('exit', (c) => {
      clearTimeout(timer)
      done(c)
    })
  })
  assert.equal(code, 0)
  log('单独带 --quit 启动的进程不开窗口，直接结束')
}
console.log('退出可靠性测试通过')
