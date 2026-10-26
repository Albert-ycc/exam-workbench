import { useEffect, type ReactElement } from 'react'
import { ToastHost, usePersistentState } from './components/ui'
import CollectPage from './pages/CollectPage'
import EditorPage from './pages/EditorPage'
import LibraryPage from './pages/LibraryPage'
import PapersPage from './pages/PapersPage'
import SettingsPage from './pages/SettingsPage'
import { IconGlobe, IconLibrary, IconPaper, IconSettings, type IconProps } from './icons'
import { NAVIGATE_EVENT, type NavigateDetail } from './navigation'

type PageKey = NavigateDetail['page']

const NAV: { key: PageKey; label: string; icon: (props: IconProps) => ReactElement }[] = [
  { key: 'collect', label: '采集', icon: IconGlobe },
  { key: 'library', label: '试题库', icon: IconLibrary },
  { key: 'papers', label: '试卷库', icon: IconPaper },
  { key: 'settings', label: '设置', icon: IconSettings }
]

const isPageKey = (value: unknown): value is PageKey => NAV.some((item) => item.key === value)
const isStoredPage = (value: unknown): value is PageKey | null => value === null || isPageKey(value)
const isStoredPaperId = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isInteger(value))

export default function App() {
  // S10：记住上次所在页面。从没用过时 page 为 null，等读到题库是否为空再定落点，
  // 这段时间不渲染页面，避免先闪进采集页、让内置浏览器去加载组卷网
  const [page, setPage] = usePersistentState<PageKey | null>('ewb.ui.page', null, { validate: isStoredPage })
  // S11：打开中的试卷。只在本次运行内记住（重启回到试卷列表），切到别的页面再回来仍是这张试卷；
  // 编辑器自己的滚动位置与筛选由编辑器用 usePersistentState 保存
  const [openPaperId, setOpenPaperId] = usePersistentState<number | null>('ewb.ui.openPaperId', null, { storage: 'session', validate: isStoredPaperId })

  useEffect(() => {
    if (page !== null) return
    let cancelled = false
    window.workbench.data
      .info()
      .then((info) => {
        if (!cancelled) setPage(info.questionCount > 0 ? 'papers' : 'collect')
      })
      .catch(() => {
        if (!cancelled) setPage('papers')
      })
    return () => {
      cancelled = true
    }
  }, [page, setPage])

  // 页面里的跳转按钮（navigation.ts 的 navigateTo）
  useEffect(() => {
    const onNavigate = (event: Event): void => {
      const detail = (event as CustomEvent<NavigateDetail>).detail
      if (!detail || !isPageKey(detail.page)) return
      if (detail.page === 'papers' && detail.paperId !== undefined) setOpenPaperId(detail.paperId)
      setPage(detail.page)
    }
    window.addEventListener(NAVIGATE_EVENT, onNavigate)
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate)
  }, [setPage, setOpenPaperId])

  // 刷新后恢复的试卷可能已被删除：启动时核对一次
  useEffect(() => {
    if (openPaperId == null) return
    window.workbench.papers
      .list()
      .then((papers) => {
        if (!papers.some((paper) => paper.id === openPaperId)) setOpenPaperId(null)
      })
      .catch(() => undefined)
    // 只在启动时核对一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderPage = (): ReactElement | null => {
    switch (page) {
      case 'collect':
        return <CollectPage />
      case 'library':
        return <LibraryPage />
      case 'papers':
        return openPaperId != null ? (
          <EditorPage key={openPaperId} paperId={openPaperId} onBack={() => setOpenPaperId(null)} />
        ) : (
          <PapersPage onOpen={setOpenPaperId} />
        )
      case 'settings':
        return <SettingsPage />
      default:
        return null
    }
  }

  return (
    <div className="shell">
      <nav className="app-nav" aria-label="导航">
        <span className="app-brand">组卷工作台</span>
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`nav-item${page === key ? ' on' : ''}`}
            aria-current={page === key ? 'page' : undefined}
            title={key === 'papers' && openPaperId != null ? '回到正在编辑的试卷' : undefined}
            onClick={() => setPage(key)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="content">{renderPage()}</main>
      <ToastHost />
    </div>
  )
}
