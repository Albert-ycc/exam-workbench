// 主进程与界面之间共享的类型和常量
import type { ExportApi } from './export'
import type { LibraryApi } from './library'
import type { PapersApi } from './papers'

export const HOME_URL = 'https://zujuan.xkw.com/'

export type LoginState = 'logged-in' | 'logged-out' | 'unknown'

export interface BrowserState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  login: LoginState
  error: string | null
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DataDirInfo {
  dataDir: string
  dbPath: string
  isDefault: boolean
  schemaVersion: number
  questionCount: number
  paperCount: number
  appVersion: string
}

export interface ChangeFolderResult {
  changed: boolean
}

export interface WorkbenchApi {
  browser: {
    show(bounds: Bounds): void
    hide(): void
    navigate(url: string): void
    back(): void
    forward(): void
    reload(): void
    home(): void
    getState(): Promise<BrowserState>
    onState(listener: (state: BrowserState) => void): () => void
  }
  data: {
    info(): Promise<DataDirInfo>
    openFolder(): Promise<void>
    changeFolder(): Promise<ChangeFolderResult>
  }
  library: LibraryApi
  papers: PapersApi
  exporter: ExportApi
}

export const IPC = {
  browserShow: 'browser:show',
  browserHide: 'browser:hide',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserHome: 'browser:home',
  browserGetState: 'browser:get-state',
  browserState: 'browser:state',
  dataInfo: 'data:info',
  dataOpenFolder: 'data:open-folder',
  dataChangeFolder: 'data:change-folder'
} as const
