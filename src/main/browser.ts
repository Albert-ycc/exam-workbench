// 采集用的内置浏览器：嵌在主窗口里的 WebContentsView，使用持久化会话分区保存组卷网登录状态。
import { BrowserWindow, WebContentsView, session, type Cookie, type Session } from 'electron'
import { HOME_URL, type Bounds, type BrowserState, type LoginState } from '@shared/api'

export const COLLECT_PARTITION = 'persist:zujuan'

// 学科网单点登录涉及的域名（组卷网 zujuan.xkw.com、登录页 sso.zxxk.com）
const LOGIN_COOKIE_DOMAIN = /(^|\.)(xkw\.com|zxxk\.com)$/
const KEEP_LOGIN_DAYS = 30

// 组卷网页头（「会员购买」「邀请有礼」等入口）在登录前后都有；未登录时页头显示「登录」按钮（.user-entry .login-btn）。
// 页头不存在（错误页、尚未渲染、别的页面）时不下结论
const DETECT_LOGIN_SCRIPT = `(() => {
  if (!document.querySelector('.item.join-member, .item.invite-award, .item.user-entry')) return 'unknown';
  const btn = document.querySelector('.user-entry .login-btn');
  return btn && btn.offsetParent !== null ? 'logged-out' : 'logged-in';
})()`

export function collectSession(): Session {
  return session.fromPartition(COLLECT_PARTITION)
}

// 去掉 UA 里的 Electron 与程序名标记，让内置浏览器以普通 Chrome 身份访问网站；
// 组卷网按 devicePixelRatio Cookie 决定公式图格式（1 为低清 PNG，2 为 SVG 矢量图），
// 固定为 2 让入库的公式图是矢量图，打印清晰
export async function prepareCollectSession(): Promise<void> {
  const ses = collectSession()
  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    const host = (cookie.domain ?? '').replace(/^\./, '')
    if (removed || !cookie.session || !LOGIN_COOKIE_DOMAIN.test(host)) return
    const expirationDate = Math.floor(Date.now() / 1000) + KEEP_LOGIN_DAYS * 24 * 3600
    ses.cookies.set({ ...cookieToDetails(cookie, host), expirationDate }).catch((error) => console.error('[cookies] 转为持久失败', error))
  })
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|exam-workbench|组卷工作台)\/\S+/g, ''))
  await ses.cookies.set({
    url: 'https://zujuan.xkw.com/',
    name: 'devicePixelRatio',
    value: '2',
    domain: '.xkw.com',
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  })
}

// 会话 Cookie（无过期时间）在程序重启后会丢失。写入时已即时转换（prepareCollectSession），
// 退出前再扫一遍兜底，并把 Cookie 刷到磁盘
export async function persistLoginCookies(): Promise<number> {
  const ses = collectSession()
  const cookies = await ses.cookies.get({})
  const expirationDate = Math.floor(Date.now() / 1000) + KEEP_LOGIN_DAYS * 24 * 3600
  let converted = 0
  for (const cookie of cookies) {
    const host = (cookie.domain ?? '').replace(/^\./, '')
    if (!cookie.session || !LOGIN_COOKIE_DOMAIN.test(host)) continue
    await ses.cookies.set({ ...cookieToDetails(cookie, host), expirationDate })
    converted++
  }
  await ses.cookies.flushStore()
  return converted
}

function cookieToDetails(cookie: Cookie, host: string): Electron.CookiesSetDetails {
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.hostOnly ? undefined : cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite
  }
}

export function normalizeAddress(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function isWebUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://')
}

export class CollectBrowser {
  private view: WebContentsView | null = null
  private login: LoginState = 'unknown'
  private error: string | null = null
  private loadSeq = 0 // 每次开始加载加一，用来丢弃过期页面的登录判断结果

  constructor(
    private readonly win: BrowserWindow,
    private readonly emit: (state: BrowserState) => void
  ) {}

  show(bounds: Bounds): void {
    const view = this.ensureView()
    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    })
    view.setVisible(true)
  }

  hide(): void {
    this.view?.setVisible(false)
  }

  // 当前采集页面的 webContents（整页入库用）；尚未打开过内置浏览器时为 null
  webContents(): Electron.WebContents | null {
    return this.view?.webContents ?? null
  }

  navigate(input: string): void {
    const url = normalizeAddress(input)
    if (url) this.ensureView().webContents.loadURL(url)
  }

  home(): void {
    this.ensureView().webContents.loadURL(HOME_URL)
  }

  back(): void {
    const history = this.view?.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  forward(): void {
    const history = this.view?.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  reload(): void {
    this.view?.webContents.reload()
  }

  state(): BrowserState {
    const contents = this.view?.webContents
    return {
      url: contents?.getURL() ?? '',
      title: contents?.getTitle() ?? '',
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
      loading: contents?.isLoading() ?? false,
      login: this.login,
      error: this.error
    }
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: {
        partition: COLLECT_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.view = view
    this.win.contentView.addChildView(view)
    const contents = view.webContents
    const push = (): void => this.emit(this.state())

    contents.on('did-start-loading', () => {
      this.loadSeq++
      this.error = null
      push()
    })
    contents.on('did-stop-loading', push)
    contents.on('did-navigate', push)
    contents.on('did-navigate-in-page', push)
    contents.on('page-title-updated', push)
    contents.on('did-finish-load', () => void this.detectLogin())
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3 为用户主动中断或页面跳转打断，不算失败
      if (!isMainFrame || code === -3) return
      this.error = `${description}（${url}）`
      this.login = 'unknown'
      push()
    })

    // 只允许打开网页地址，拦截 weixin:// 等外部协议
    contents.on('will-navigate', (event, url) => {
      if (!isWebUrl(url)) event.preventDefault()
    })
    // 普通新标签链接在当前视图打开；带窗口尺寸的弹窗（多见于第三方登录）作为独立窗口打开，共用同一会话
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isWebUrl(url)) return { action: 'deny' }
      if (disposition === 'new-window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.win,
            width: 900,
            height: 720,
            autoHideMenuBar: true,
            webPreferences: { partition: COLLECT_PARTITION, sandbox: true, contextIsolation: true }
          }
        }
      }
      contents.loadURL(url)
      return { action: 'deny' }
    })

    contents.loadURL(HOME_URL)
    return view
  }

  private async detectLogin(): Promise<void> {
    const contents = this.view?.webContents
    if (!contents) return
    let host = ''
    try {
      host = new URL(contents.getURL()).hostname
    } catch {
      return
    }
    // 只在正常加载的组卷网页面上判断；登录页等其他页面保持上一次的结果，加载失败的页面不判断
    if (host !== 'zujuan.xkw.com' || this.error) return
    const seq = this.loadSeq
    try {
      const result = (await contents.executeJavaScript(DETECT_LOGIN_SCRIPT, false)) as LoginState
      // 判断期间页面又跳转或加载失败了，结果作废
      if (seq !== this.loadSeq || this.error || result === 'unknown') return
      if (result !== this.login) {
        this.login = result
        this.emit(this.state())
      }
    } catch {
      // 页面在判断过程中跳转，等下一次加载完成再判断
    }
  }
}
