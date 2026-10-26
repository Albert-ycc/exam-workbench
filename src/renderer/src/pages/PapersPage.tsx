// 试卷库：试卷列表。搜索标题，一眼看到题数分值、最新版本和草稿有没有改动，按修改时间排序；
// 新建、打开、继续上次编辑、重命名、另存为新试卷、删除（8 秒内可撤销）。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PaperSummary } from '@shared/domain'
import { IconEdit, IconMore, IconPlus, IconSearch } from '../icons'
import { clip, errorMessage, formatTime, structureLine } from '../components/library/format'
import { paperTrash, useExecutedDeletes, useHiddenPapers } from '../components/library/paperTrash'
import { Button, EmptyState, IconButton, Menu, Modal, Tag, TextInput, toast } from '../components/ui'
import './PapersPage.css'

interface Props {
  onOpen(paperId: number): void
}

type Dialog = { kind: 'create' } | { kind: 'rename'; paper: PaperSummary }

// 搜索命中的字用荧光笔标出
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

function secondLine(paper: PaperSummary): string {
  const { sectionCount, questionCount, totalScore, unscoredCount } = paper.structure
  if (questionCount === 0) return ''
  return `${sectionCount} 个大题${unscoredCount > 0 && totalScore != null ? `，${unscoredCount} 题未设分` : ''}`
}

export default function PapersPage({ onOpen }: Props) {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const hidden = useHiddenPapers()
  const executedDeletes = useExecutedDeletes()

  const load = useCallback(async (): Promise<PaperSummary[]> => {
    try {
      const list = await window.workbench.papers.list()
      setPapers(list)
      setLoadError(null)
      return list
    } catch (e) {
      setLoadError(errorMessage(e))
      return []
    }
  }, [])

  // 挂载时读一次；藏起来的试卷真正删除后再读一次
  useEffect(() => {
    void load()
  }, [load, executedDeletes])

  // 按修改时间排，新改的在前；等待删除的试卷不显示
  const live = useMemo(() => (papers ?? []).filter((p) => !hidden.has(p.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [papers, hidden])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? live.filter((p) => p.title.toLowerCase().includes(needle)) : live
  }, [live, query])
  const lastEdited = live[0]

  const openDialog = (next: Dialog): void => {
    setName(next.kind === 'rename' ? next.paper.title : '')
    setDialog(next)
  }

  const submit = async (): Promise<void> => {
    if (!dialog) return
    const title = name.trim()
    if (!title) return
    setBusy(true)
    try {
      if (dialog.kind === 'create') {
        const id = await window.workbench.papers.create(title)
        setDialog(null)
        onOpen(id)
        return
      }
      await window.workbench.papers.rename(dialog.paper.id, title)
      setDialog(null)
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async (paper: PaperSummary): Promise<void> => {
    try {
      const id = await window.workbench.papers.duplicate(paper.id)
      const list = await load()
      const copy = list.find((p) => p.id === id)
      toast.show(`已另存为新试卷「${clip(copy?.title ?? paper.title, 24)}」`, { action: { label: '打开', run: () => onOpen(id) } })
    } catch (e) {
      toast.error(`另存为新试卷失败：${errorMessage(e)}`)
    }
  }

  return (
    <div className="pp-page">
      <header className="pp-head">
        <h1>试卷库</h1>
        {papers && live.length > 0 && <span className="pp-count">{query.trim() ? `筛出 ${shown.length} 份，共 ${live.length} 份` : `共 ${live.length} 份`}</span>}
        <div className="pp-head-tools">
          {live.length > 0 && (
            <div className="pp-search">
              <TextInput value={query} onChange={setQuery} leading={<IconSearch size={16} />} clearable placeholder="搜索试卷标题" aria-label="搜索试卷" />
            </div>
          )}
          {lastEdited && (
            <Button icon={<IconEdit size={16} />} title={`继续编辑《${lastEdited.title}》`} onClick={() => onOpen(lastEdited.id)}>
              继续上次编辑
            </Button>
          )}
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => openDialog({ kind: 'create' })}>
            新建试卷
          </Button>
        </div>
      </header>

      {loadError && <div className="notice error">{loadError}</div>}

      {papers && live.length === 0 && (
        <EmptyState
          bordered
          className="pp-empty"
          title="还没有试卷"
          description="点「新建试卷」，再从试题库里把题加进来。"
          actions={
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => openDialog({ kind: 'create' })}>
              新建试卷
            </Button>
          }
        />
      )}

      {live.length > 0 && (
        <>
          <div className="pp-thead pp-grid" aria-hidden="true">
            <span>标题</span>
            <span>题数 · 分值</span>
            <span>最新版本</span>
            <span>修改时间</span>
            <span>操作</span>
          </div>
          <div className="pp-list">
            {shown.map((paper) => {
              // 没存过版本时没有可比对的版本，只写「未存为版本」；有版本且草稿改过，用编辑器同一状态的原词
              const dirty = paper.latestVersionNo !== null && paper.draftDirty
              const sub = secondLine(paper)
              return (
                <div key={paper.id} className="pp-row pp-grid" data-testid="paper-row">
                  <div className="pp-title-cell">
                    {/* 键盘走同一行的「打开」按钮；标题按钮只服务鼠标，不再多一个等效的 Tab 停靠点 */}
                    <button type="button" className="pp-title" title="打开" tabIndex={-1} onClick={() => onOpen(paper.id)}>
                      <Highlight text={paper.title} query={query} />
                    </button>
                  </div>
                  <div className="pp-structure">
                    <div className="pp-structure-main">{structureLine(paper)}</div>
                    {sub && <div className="pp-sub">{sub}</div>}
                  </div>
                  <div className="pp-version">
                    {paper.latestVersionNo == null ? <span className="pp-muted">未存为版本</span> : <span className="pp-vno">v{paper.latestVersionNo}</span>}
                    {dirty && <Tag tone="red">有改动未存为版本</Tag>}
                  </div>
                  <div className="pp-time">{formatTime(paper.updatedAt)}</div>
                  <div className="pp-ops">
                    <Button size="sm" onClick={() => onOpen(paper.id)}>
                      打开
                    </Button>
                    <Menu
                      label={`「${paper.title}」的更多操作`}
                      align="end"
                      trigger={<IconButton label={`「${paper.title}」的更多操作`} size="sm" icon={<IconMore size={16} />} />}
                      items={[
                        { label: '重命名', onSelect: () => openDialog({ kind: 'rename', paper }) },
                        { label: '另存为新试卷', onSelect: () => void duplicate(paper) },
                        'separator',
                        { label: '删除', danger: true, onSelect: () => paperTrash.schedule(paper) }
                      ]}
                    />
                  </div>
                </div>
              )
            })}
            {shown.length === 0 && (
              <EmptyState
                compact
                title={`没有标题含「${query.trim()}」的试卷`}
                actions={
                  <Button variant="link" onClick={() => setQuery('')}>
                    清除搜索
                  </Button>
                }
              />
            )}
          </div>
        </>
      )}

      {dialog && (
        <Modal
          title={dialog.kind === 'create' ? '新建试卷' : '重命名试卷'}
          size="sm"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>取消</Button>
              <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
                {dialog.kind === 'create' ? '创建并打开' : '保存'}
              </Button>
            </>
          }
        >
          <label className="pp-field">
            <span>试卷标题</span>
            <TextInput
              value={name}
              onChange={setName}
              placeholder="例如：七年级数学第一单元测试"
              data-autofocus=""
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) void submit()
              }}
            />
          </label>
        </Modal>
      )}
    </div>
  )
}
