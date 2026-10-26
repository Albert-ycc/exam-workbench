import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { IPC, type Bounds, type ChangeFolderResult, type DataDirInfo } from '@shared/api'
import { handleAssetProtocol, registerAssetScheme } from './asset-protocol'
import { CollectBrowser, collectSession, persistLoginCookies, prepareCollectSession } from './browser'
import { defaultDataDir, readConfig, resolveDataDir, writeConfig } from './config'
import type { AppContext } from './context'
import { countRows, DB_FILE, openDatabase, SCHEMA_VERSION } from './db'
import { registerExportIpc } from './export/ipc'
import { registerLibraryIpc } from './library/ipc'
import { registerPapersIpc } from './papers/ipc'

// 测试时用独立的用户目录，避免影响真实登录状态
if (process.env.EWB_USER_DATA) app.setPath('userData', process.env.EWB_USER_DATA)
const selftestMode = process.argv.find((arg) => arg.startsWith('--selftest='))?.split('=')[1]
registerAssetScheme()

let mainWindow: BrowserWindow | null = null
let browser: CollectBrowser | null = null
let db: DatabaseSync | null = null
let dataDir = ''

// 安装程序更新前用它请正在运行的程序保存并退出：带这个参数再启动一份，单实例通道把参数转给已在跑的那份，本进程不开窗口
const QUIT_FLAG = '--quit'
const quitRequested = process.argv.includes(QUIT_FLAG)
// 自检与自动化测试可以多开，正常使用保持单实例
const gotLock = selftestMode || process.env.EWB_E2E ? true : app.requestSingleInstanceLock()
if (!gotLock || quitRequested) {
  // 没拿到锁：已有一份在跑，参数（含 --quit）已经转交给它；拿到了锁却带着 --quit：没有程序在跑，没什么可退的
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes(QUIT_FLAG)) {
      app.quit()
      return
    }
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => app.quit())

  // 退出前保存登录 Cookie 并关闭数据库，最多等 3 秒
  let cleanedUp = false
  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    cleanedUp = true
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000))
    // 编辑器在 beforeunload 里同步保存草稿；主动退出（Cmd+Q、app.quit）不会触发它，这里补发一次
    const flushEdits = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('beforeunload'))").catch(() => undefined)
      : Promise.resolve()
    Promise.race([flushEdits.then(() => persistLoginCookies()).then((n) => console.log(`[quit] 保存登录 Cookie ${n} 个`)), timeout])
      .catch((error) => console.error('[quit] 保存登录 Cookie 失败', error))
      .finally(() => {
        db?.close()
        db = null
        // 生成 PDF、量字宽用的隐藏窗口直接销毁，不等它们自己关；退出再卡住（渲染进程没响应）就 5 秒后强制结束，不留后台进程
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy()
        setTimeout(() => app.exit(0), 5000)
        app.quit()
      })
  })

  app.whenReady().then(start)
}

async function start(): Promise<void> {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  await prepareCollectSession().catch((error) => console.error('[start] 内置浏览器会话设置失败', error))
  if (selftestMode) return runSelftest(selftestMode)
  if (!(await openDataDir())) return
  handleAssetProtocol(() => dataDir)
  registerIpc()
  createWindow()
}

async function openDataDir(): Promise<boolean> {
  for (;;) {
    try {
      dataDir = resolveDataDir()
      db = openDatabase(dataDir)
      return true
    } catch (error) {
      const usingCustom = Boolean(readConfig().dataDir)
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: '组卷工作台',
        message: '数据目录无法打开',
        detail: `${dataDir || readConfig().dataDir || defaultDataDir()}\n\n${errorText(error)}`,
        buttons: usingCustom ? ['改用默认位置', '退出'] : ['退出'],
        defaultId: 0
      })
      if (usingCustom && response === 0) {
        writeConfig({ ...readConfig(), dataDir: undefined })
        continue
      }
      app.exit(1)
      return false
    }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: '组卷工作台',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win
  browser = new CollectBrowser(win, (state) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.browserState, state)
  })

  win.once('ready-to-show', () => win.show())
  // 主窗口关了程序就退出：导出用的隐藏窗口可能还开着，不能靠 window-all-closed，否则程序留在后台，安装程序会报「正在运行」
  win.on('closed', () => {
    mainWindow = null
    browser = null
    app.quit()
  })
  // 界面本身不跳转；界面里的外部链接交给系统浏览器
  // file: 页面的 origin 都是 "null"，不能按 origin 比较；开发模式只放行开发服务器自身
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.ELECTRON_RENDERER_URL
    if (!devServer || new URL(url).origin !== new URL(devServer).origin) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const fromMainWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    Boolean(mainWindow) && event.sender === mainWindow?.webContents
  const ctx: AppContext = {
    db: () => {
      if (!db) throw new Error('数据库未打开')
      return db
    },
    dataDir: () => dataDir,
    mainWindow: () => mainWindow,
    collectBrowser: () => browser,
    fromMainWindow
  }
  registerLibraryIpc(ctx)
  registerPapersIpc(ctx)
  registerExportIpc(ctx)

  ipcMain.on(IPC.browserShow, (event, bounds: Bounds) => {
    if (fromMainWindow(event) && isBounds(bounds)) browser?.show(bounds)
  })
  ipcMain.on(IPC.browserHide, (event) => fromMainWindow(event) && browser?.hide())
  ipcMain.on(IPC.browserNavigate, (event, url: unknown) => {
    if (fromMainWindow(event) && typeof url === 'string') browser?.navigate(url)
  })
  ipcMain.on(IPC.browserBack, (event) => fromMainWindow(event) && browser?.back())
  ipcMain.on(IPC.browserForward, (event) => fromMainWindow(event) && browser?.forward())
  ipcMain.on(IPC.browserReload, (event) => fromMainWindow(event) && browser?.reload())
  ipcMain.on(IPC.browserHome, (event) => fromMainWindow(event) && browser?.home())
  ipcMain.handle(IPC.browserGetState, (event) => (fromMainWindow(event) ? browser?.state() : undefined))

  ipcMain.handle(IPC.dataInfo, (event): DataDirInfo | undefined => {
    if (!fromMainWindow(event) || !db) return undefined
    return {
      dataDir,
      dbPath: join(dataDir, DB_FILE),
      isDefault: dataDir === defaultDataDir(),
      schemaVersion: SCHEMA_VERSION,
      questionCount: countRows(db, 'questions'),
      paperCount: countRows(db, 'papers'),
      appVersion: app.getVersion()
    }
  })
  ipcMain.handle(IPC.dataOpenFolder, async (event) => {
    if (fromMainWindow(event)) await shell.openPath(dataDir)
  })
  ipcMain.handle(IPC.dataChangeFolder, (event) => (fromMainWindow(event) ? changeDataDir() : { changed: false }))
}

async function changeDataDir(): Promise<ChangeFolderResult> {
  const win = mainWindow
  if (!win) return { changed: false }
  const picked = await dialog.showOpenDialog(win, {
    title: '选择数据目录',
    defaultPath: dataDir,
    properties: ['openDirectory', 'createDirectory']
  })
  const next = picked.filePaths[0]
  if (picked.canceled || !next || next === dataDir) return { changed: false }

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: '组卷工作台',
    message: '切换数据目录',
    detail: `新位置：${next}\n\n新位置已有组卷工作台数据时直接使用，没有时新建空库。原位置的数据保留不动。切换后程序会重新启动。`,
    buttons: ['切换并重启', '取消'],
    defaultId: 0,
    cancelId: 1
  })
  if (response !== 0) return { changed: false }

  const probe = join(next, '.write-test')
  try {
    mkdirSync(next, { recursive: true })
    writeFileSync(probe, 'ok')
    rmSync(probe)
  } catch (error) {
    dialog.showErrorBox('无法使用该文件夹', `${next}\n\n${errorText(error)}`)
    return { changed: false }
  }

  writeConfig({ ...readConfig(), dataDir: next === defaultDataDir() ? undefined : next })
  app.relaunch()
  app.quit()
  return { changed: true }
}

function isBounds(value: unknown): value is Bounds {
  const b = value as Bounds
  return Boolean(b) && [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 登录保持自检：cookie-write 写入一个会话 Cookie 后正常退出（走退出前的转换），
// cookie-write-raw 写入后直接结束进程（不转换），cookie-check 检查重启后 Cookie 是否还在。
async function runSelftest(mode: string): Promise<void> {
  const ses = collectSession()
  if (mode === 'cookie-write' || mode === 'cookie-write-raw') {
    await ses.cookies.set({ url: 'https://zujuan.xkw.com/', name: 'ewb_selftest', value: 'session', secure: true, httpOnly: true })
    console.log('[selftest] 已写入会话 Cookie')
    if (mode === 'cookie-write-raw') {
      // 等写入时的即时转换完成，再跳过退出流程直接结束，模拟登录后崩溃或强制结束
      await new Promise((resolve) => setTimeout(resolve, 500))
      await ses.cookies.flushStore()
      app.exit(0)
    } else {
      app.quit()
    }
    return
  }
  if (mode === 'capture') {
    await captureFixture()
    return
  }
  if (mode === 'cookie-check') {
    const found = await ses.cookies.get({ name: 'ewb_selftest' })
    console.log(`[selftest] Cookie ${found.length ? '仍在' : '已丢失'}`, found.map((c) => ({ session: c.session, expirationDate: c.expirationDate })))
    app.exit(found.length ? 0 : 1)
    return
  }
  console.error(`[selftest] 未知模式：${mode}`)
  app.exit(2)
}

// 抓取测试样本：--selftest=capture --url=<试卷页> --out=<文件>，用内置浏览器的会话正常打开页面，
// 等题目渲染出来后保存去掉脚本的页面 HTML
async function captureFixture(): Promise<void> {
  const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
  const url = arg('url')
  const out = arg('out')
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:zujuan', sandbox: true } })
  await win.loadURL(url)
  let count = 0
  for (let i = 0; i < 40 && count === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    count = (await win.webContents.executeJavaScript("document.querySelectorAll('.tk-quest-item').length")) as number
  }
  const html = (await win.webContents.executeJavaScript(`(() => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('script, noscript, style, link, iframe').forEach((n) => n.remove());
    return '<!doctype html>\\n' + clone.outerHTML;
  })()`)) as string
  writeFileSync(out, html, 'utf8')
  console.log(`[selftest] 已保存 ${url}：题目 ${count} 道，${html.length} 字符 → ${out}`)
  app.exit(count > 0 ? 0 : 1)
}
