import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BrowserState, LoginState } from '@shared/api'
import { IconBack, IconForward, IconHome, IconReload } from '../icons'
import ImportPanel from '../components/library/ImportPanel'
import { canImportPage, importActions, useImportState } from '../components/library/importStore'
import { Button, IconButton, Tag } from '../components/ui'
import './CollectPage.css'

const LOGIN_LABEL: Record<LoginState, string> = {
  'logged-in': '组卷网已登录',
  'logged-out': '组卷网未登录',
  unknown: '登录状态检测中'
}

const LOGIN_TONE = { 'logged-in': 'plain', 'logged-out': 'warn', unknown: 'plain' } as const

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: true,
  login: 'unknown',
  error: null
}

export default function CollectPage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const importState = useImportState()
  const importBusy = importState.stage !== 'idle' && importState.stage !== 'done'

  // 内置浏览器是盖在界面上的原生视图，位置跟随占位区域
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sync = (): void => {
      const rect = host.getBoundingClientRect()
      window.workbench.browser.show({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.workbench.browser.hide()
    }
  }, [])

  useEffect(() => {
    void window.workbench.browser.getState().then((s) => s && setState(s))
    return window.workbench.browser.onState(setState)
  }, [])

  useEffect(() => {
    if (!editing) setAddress(state.url)
  }, [state.url, editing])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    window.workbench.browser.navigate(address)
    setEditing(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const { browser } = window.workbench
  return (
    <div className="cl-page">
      <div className="cl-toolbar">
        <IconButton label="后退" icon={<IconBack size={18} />} disabled={!state.canGoBack} onClick={browser.back} />
        <IconButton label="前进" icon={<IconForward size={18} />} disabled={!state.canGoForward} onClick={browser.forward} />
        <IconButton label="刷新" icon={<IconReload size={18} />} onClick={browser.reload} />
        <IconButton label="组卷网首页" icon={<IconHome size={18} />} onClick={browser.home} />
        <form className="cl-address" onSubmit={submit}>
          <input
            value={address}
            spellCheck={false}
            placeholder="输入网址后按回车"
            aria-label="网址"
            onFocus={(e) => {
              setEditing(true)
              e.currentTarget.select()
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
          />
          {state.loading && <span className="cl-loading" aria-label="加载中" />}
        </form>
        <Tag tone={LOGIN_TONE[state.login]} size="md" className="cl-login">
          {LOGIN_LABEL[state.login]}
        </Tag>
        <div className="toolbar-actions">
          <Button
            variant="primary"
            disabled={importBusy || !canImportPage(state.url)}
            title={canImportPage(state.url) ? '把当前页面的题目拆出来入库' : '当前页面不是组卷网的试卷页或试题页'}
            onClick={() => void importActions.startCurrentPage()}
          >
            整页入库
          </Button>
          <Button disabled={importBusy} onClick={() => setPasteOpen(true)}>
            粘贴链接入库
          </Button>
        </div>
      </div>
      {state.login === 'logged-out' && (
        <div className="notice">点页面右上角的「登录」登录组卷网。登录状态保存在本机，下次打开程序无需重新登录。</div>
      )}
      {state.error && (
        <div className="notice error">
          页面打开失败：{state.error}
          <Button variant="link" size="sm" onClick={browser.reload}>
            重新加载
          </Button>
        </div>
      )}
      {importState.error && !pasteOpen && (
        <div className="notice error">
          {importState.error}
          <Button variant="link" size="sm" onClick={importActions.dismiss}>
            关闭
          </Button>
        </div>
      )}
      <div className="cl-body">
        <div ref={hostRef} className="browser-host" />
        <ImportPanel pasteOpen={pasteOpen} onClosePaste={() => setPasteOpen(false)} />
      </div>
    </div>
  )
}
