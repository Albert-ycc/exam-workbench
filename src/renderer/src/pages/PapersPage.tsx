// 试卷库：左侧分类，上方标签筛选与标题搜索，中间试卷列表。一眼看到题数分值、最新版本和草稿有没有改动，按修改时间排序；
// 新建（在某个分类下新建直接归入）、打开、继续上次编辑、重命名、另存为新试卷（分类与标签一起复制）、移到分类、打标签（可勾选多份批量）、删除（8 秒内可撤销）。
// 分类与标签只用于整理：不改修改时间，不影响「继续上次编辑」，也不会让试卷出现「有改动未存为版本」。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PaperCategory, Tag, TagRef } from '@shared/classify'
import type { PaperSummary } from '@shared/domain'
import { IconEdit, IconPlus, IconSearch } from '../icons'
import { TagManagerModal } from '../components/classify'
import { paperTrash, useExecutedDeletes, useHiddenPapers } from '../components/library/paperTrash'
import { BulkBar } from '../components/papers/BulkBar'
import { CategoryDialog } from '../components/papers/CategoryDialog'
import { CategoryRail, isPaperView, type PaperView } from '../components/papers/CategoryRail'
import { PaperRow } from '../components/papers/PaperRow'
import { TagBar } from '../components/papers/TagBar'
import { Button, Checkbox, ConfirmDialog, EmptyState, Modal, TextInput, clip, errorMessage, toast, usePersistentState, type EmptyStateProps } from '../components/ui'
import { TITLE_MAX } from '../components/papers/titleMax'
import './PapersPage.css'

interface Props {
  onOpen(paperId: number): void
}

type Dialog = { kind: 'create' } | { kind: 'rename'; paper: PaperSummary }
type CategoryAsk = { kind: 'create' } | { kind: 'rename'; category: PaperCategory } | { kind: 'delete'; category: PaperCategory }

const isIdList = (value: unknown): value is number[] => Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isInteger(v))

export default function PapersPage({ onOpen }: Props) {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null)
  const [categories, setCategories] = useState<PaperCategory[] | null>(null)
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 当前分类与标签筛选放在页面外：打开试卷再回来仍是原来的范围
  const [view, setView] = usePersistentState<PaperView>('ewb.papers.view', 'all', { storage: 'session', validate: isPaperView })
  const [tagIds, setTagIds] = usePersistentState<number[]>('ewb.papers.tags', [], { storage: 'session', validate: isIdList })
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [categoryAsk, setCategoryAsk] = useState<CategoryAsk | null>(null)
  const [managingTags, setManagingTags] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const hidden = useHiddenPapers()
  const executedDeletes = useExecutedDeletes()

  // 几个请求交错返回时只认最后发出的那一次，避免旧数据盖掉新数据
  const requestSeq = useRef(0)
  const load = useCallback(async (): Promise<PaperSummary[]> => {
    const seq = ++requestSeq.current
    try {
      const api = window.workbench.papers
      const [list, cats, tagList] = await Promise.all([api.list(), api.listCategories(), api.listTags()])
      if (seq !== requestSeq.current) return list
      setPapers(list)
      setCategories(cats)
      setTags(tagList)
      setLoadError(null)
      return list
    } catch (e) {
      if (seq === requestSeq.current) setLoadError(errorMessage(e))
      return []
    }
  }, [])

  // 挂载时读一次；藏起来的试卷真正删除后再读一次
  useEffect(() => {
    void load()
  }, [load, executedDeletes])

  // 分类被删、标签被合并后，筛选里残留的编号不再生效
  const activeView: PaperView = typeof view === 'number' && categories && !categories.some((c) => c.id === view) ? 'all' : view
  const activeTagIds = useMemo(() => (tags ? tagIds.filter((id) => tags.some((t) => t.id === id)) : tagIds), [tagIds, tags])
  useEffect(() => {
    if (activeView !== view) setView(activeView)
    if (activeTagIds.length !== tagIds.length) setTagIds(activeTagIds)
  }, [activeView, view, setView, activeTagIds, tagIds, setTagIds])

  // 按修改时间排，新改的在前；等待删除的试卷不显示、不计入份数
  const live = useMemo(() => (papers ?? []).filter((p) => !hidden.has(p.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [papers, hidden])
  const needle = query.trim().toLowerCase()
  const inScope = useCallback((p: PaperSummary) => (activeView === 'all' ? true : activeView === 'none' ? p.categoryId === null : p.categoryId === activeView), [activeView])
  const matchesQuery = useCallback((p: PaperSummary) => !needle || p.title.toLowerCase().includes(needle), [needle])
  const shown = useMemo(
    () => live.filter((p) => inScope(p) && matchesQuery(p) && (activeTagIds.length === 0 || p.tags.some((t) => activeTagIds.includes(t.id)))),
    [live, inScope, matchesQuery, activeTagIds]
  )
  const lastEdited = live[0]

  // 份数：分类按全部试卷算；标签筛选里的份数按当前分类与搜索算（本项不参与），与试题库一致
  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const p of live) if (p.categoryId !== null) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1)
    return counts
  }, [live])
  const railCategories = useMemo(() => (categories ?? []).map((c) => ({ ...c, count: categoryCounts.get(c.id) ?? 0 })), [categories, categoryCounts])
  const uncategorized = useMemo(() => live.filter((p) => p.categoryId === null).length, [live])
  const tagTotals = useMemo(() => {
    const counts = new Map<number, number>()
    for (const p of live) for (const t of p.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
    return counts
  }, [live])
  const tagCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const p of live) if (inScope(p) && matchesQuery(p)) for (const t of p.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
    return counts
  }, [live, inScope, matchesQuery])
  const liveTags = useMemo(() => (tags ?? []).map((t) => ({ ...t, count: tagTotals.get(t.id) ?? 0 })), [tags, tagTotals])
  const categoryName = (id: number | null): string | null => (id === null ? null : (categories?.find((c) => c.id === id)?.name ?? null))

  // 勾选只对眼前列表里的试卷生效：换了分类、标签、搜索，看不见的试卷不会被误操作
  const chosen = useMemo(() => shown.filter((p) => selected.has(p.id)), [shown, selected])
  const chosenIds = useMemo(() => chosen.map((p) => p.id), [chosen])
  const tagUse = useMemo(() => {
    const use = new Map<number, number>()
    for (const p of chosen) for (const t of p.tags) use.set(t.id, (use.get(t.id) ?? 0) + 1)
    return use
  }, [chosen])
  const toggleSelected = (id: number, on: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const allChosen = shown.length > 0 && chosen.length === shown.length

  const tagFilterOn = activeTagIds.length > 0
  const filtering = needle !== '' || tagFilterOn || activeView !== 'all'
  const createCategoryId = typeof activeView === 'number' ? activeView : null

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
        // 在某个分类下新建直接归入；「全部」「未分类」下不归类
        const id = await window.workbench.papers.create(title, { categoryId: createCategoryId })
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

  // ---------- 分类 ----------
  const moveTo = async (ids: number[], categoryId: number | null): Promise<boolean> => {
    let moved = false
    try {
      await window.workbench.papers.setCategory(ids, categoryId)
      const target = categoryId === null ? '「未分类」' : `分类「${clip(categoryName(categoryId) ?? '', 20)}」`
      const what = ids.length === 1 ? `「${clip(papers?.find((p) => p.id === ids[0])?.title ?? '', 20)}」` : ` ${ids.length} 份试卷`
      toast.show(`已将${what}移到${target}`)
      moved = true
    } catch (e) {
      toast.error(`移到分类失败：${errorMessage(e)}`)
    }
    await load()
    return moved
  }

  const submitCategory = async (raw: string): Promise<void> => {
    if (categoryAsk?.kind === 'create') await window.workbench.papers.createCategory(raw)
    else if (categoryAsk?.kind === 'rename') await window.workbench.papers.renameCategory(categoryAsk.category.id, raw)
    setCategoryAsk(null)
    await load()
  }

  const shiftCategory = async (category: PaperCategory, delta: -1 | 1): Promise<void> => {
    const at = (categories ?? []).findIndex((c) => c.id === category.id)
    try {
      await window.workbench.papers.moveCategory(category.id, at + delta)
    } catch (e) {
      toast.error(`调整顺序失败：${errorMessage(e)}`)
    }
    await load()
  }

  const confirmDeleteCategory = async (category: PaperCategory): Promise<void> => {
    const inside = categoryCounts.get(category.id) ?? 0
    setDeleting(true)
    try {
      await window.workbench.papers.deleteCategory(category.id)
      if (view === category.id) setView('all')
      setCategoryAsk(null)
      toast.show(inside > 0 ? `已删除分类「${clip(category.name, 20)}」，${inside} 份试卷回到「未分类」` : `已删除分类「${clip(category.name, 20)}」`)
    } catch (e) {
      toast.error(errorMessage(e))
      setCategoryAsk(null)
    } finally {
      setDeleting(false)
    }
    await load()
  }

  // ---------- 标签 ----------
  // 打标签的小框开着时，每点一下只记下来、不弹提示；小框关上后汇总成一条（行上的小框与批量的小框都是）
  interface TagSession {
    ids: number[]
    start: Map<number, number> // 标签 → 打开时所选试卷里有几份带着它
    changes: Map<number, { tag: TagRef; to: boolean }> // 标签 → 小框里最后一次点成的状态
  }
  const tagSession = useRef<TagSession | null>(null)
  const startTagSession = (ids: number[]): void => {
    const start = new Map<number, number>()
    for (const p of papers ?? []) if (ids.includes(p.id)) for (const t of p.tags) start.set(t.id, (start.get(t.id) ?? 0) + 1)
    tagSession.current = { ids, start, changes: new Map() }
  }
  const endTagSession = (): void => {
    const session = tagSession.current
    tagSession.current = null
    if (!session) return
    const added: TagRef[] = []
    const removed: TagRef[] = []
    for (const { tag, to } of session.changes.values()) {
      const had = session.start.get(tag.id) ?? 0
      if (to && had < session.ids.length) added.push(tag)
      if (!to && had > 0) removed.push(tag)
    }
    if (added.length === 0 && removed.length === 0) return
    const names = (list: TagRef[]): string => (list.length > 3 ? `${list.slice(0, 3).map((t) => `「${clip(t.name, 12)}」`).join('')}等 ${list.length} 个标签` : list.map((t) => `「${clip(t.name, 12)}」`).join(''))
    const who = session.ids.length === 1 ? `「${clip(papers?.find((p) => p.id === session.ids[0])?.title ?? '', 16)}」` : ` ${session.ids.length} 份试卷`
    if (added.length > 0 && removed.length > 0) toast.show(`已给${who}打上${names(added)}，并去掉${names(removed)}`)
    else if (added.length > 0) toast.show(`已给${who}打上${names(added)}`)
    else toast.show(`已从${who}去掉标签${names(removed)}`)
  }
  const changeTags = async (ids: number[], tag: TagRef, to: boolean): Promise<void> => {
    tagSession.current?.changes.set(tag.id, { tag, to })
    try {
      await window.workbench.papers.changeTags(ids, to ? { add: [tag.id] } : { remove: [tag.id] })
    } catch (e) {
      tagSession.current?.changes.delete(tag.id) // 没成功的不进汇总
      toast.error(`修改标签失败：${errorMessage(e)}`)
    }
    await load()
  }
  const toggleTag = (ids: number[]) => (tag: TagRef, next: boolean): void => void changeTags(ids, tag, next)
  const createTag = async (tagName: string): Promise<TagRef> => {
    const tag = await window.workbench.papers.createTag(tagName)
    await load()
    return tag
  }

  // ---------- 列表为空时的说明 ----------
  const conditions: string[] = []
  if (typeof activeView === 'number') conditions.push(`分类「${categoryName(activeView) ?? ''}」`)
  if (activeView === 'none') conditions.push('未分类')
  if (tagFilterOn) conditions.push(`标签「${activeTagIds.map((id) => tags?.find((t) => t.id === id)?.name ?? '').join('」「')}」`)
  if (needle) conditions.push(`标题含「${query.trim()}」`)
  const clearFilters = (): void => {
    setQuery('')
    setTagIds([])
  }
  const emptyProps = (): EmptyStateProps => {
    if (needle && !tagFilterOn && activeView === 'all') {
      return {
        title: `没有标题含「${query.trim()}」的试卷`,
        actions: (
          <Button variant="link" onClick={() => setQuery('')}>
            清除搜索
          </Button>
        )
      }
    }
    if (!needle && !tagFilterOn && activeView === 'none') {
      return {
        title: '没有未分类的试卷',
        description: '所有试卷都已归入分类。',
        actions: (
          <Button variant="link" onClick={() => setView('all')}>
            查看全部试卷
          </Button>
        )
      }
    }
    if (!needle && !tagFilterOn && typeof activeView === 'number') {
      return {
        title: `「${categoryName(activeView) ?? ''}」里还没有试卷`,
        description: '点「新建试卷」直接建在这个分类里，或用试卷行「⋯」里的「移到分类」移进来。',
        actions: (
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => openDialog({ kind: 'create' })}>
            新建试卷
          </Button>
        )
      }
    }
    return {
      title: '没有符合条件的试卷',
      description: `当前条件：${conditions.join('，')}`,
      actions: (
        <Button variant="link" onClick={clearFilters}>
          清除筛选
        </Button>
      )
    }
  }

  return (
    <div className="pp-page">
      <CategoryRail
        categories={railCategories}
        total={live.length}
        uncategorized={uncategorized}
        view={activeView}
        onView={setView}
        onCreate={() => setCategoryAsk({ kind: 'create' })}
        onRename={(category) => setCategoryAsk({ kind: 'rename', category })}
        onMove={(category, delta) => void shiftCategory(category, delta)}
        onDelete={(category) => setCategoryAsk({ kind: 'delete', category })}
      />

      <section className="pp-main" aria-label="试卷列表">
        <header className="pp-head">
          <h1>试卷库</h1>
          {papers && live.length > 0 && <span className="pp-count">{filtering ? `筛出 ${shown.length} 份，共 ${live.length} 份` : `共 ${live.length} 份`}</span>}
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

        {live.length > 0 && tags && <TagBar tags={tags} counts={tagCounts} selected={activeTagIds} onChange={setTagIds} onManage={() => setManagingTags(true)} />}

        {live.length > 0 && (
          <>
            <div className={`pp-thead pp-grid${chosen.length > 0 ? ' is-bulk' : ''}`}>
              <span className="pp-check">
                <Checkbox
                  checked={allChosen}
                  indeterminate={chosen.length > 0 && !allChosen}
                  disabled={shown.length === 0}
                  onChange={(on) => setSelected(on ? new Set(shown.map((p) => p.id)) : new Set())}
                  aria-label="选择列表里的全部试卷"
                />
              </span>
              {chosen.length > 0 ? (
                <BulkBar
                  count={chosen.length}
                  categories={categories ?? []}
                  tags={liveTags}
                  tagUse={tagUse}
                  onMove={(id) => {
                    // 移成功才清勾选；失败留着，用户不用重新点选
                    void moveTo(chosenIds, id).then((moved) => moved && setSelected(new Set()))
                  }}
                  onToggleTag={toggleTag(chosenIds)}
                  onCreateTag={createTag}
                  onManageTags={() => setManagingTags(true)}
                  onClear={() => setSelected(new Set())}
                  onTagSessionStart={() => startTagSession(chosenIds)}
                  onTagSessionEnd={endTagSession}
                />
              ) : (
                <>
                  <span aria-hidden="true">标题</span>
                  <span aria-hidden="true">题数 · 分值</span>
                  <span aria-hidden="true">最新版本</span>
                  <span aria-hidden="true">修改时间</span>
                  <span aria-hidden="true">操作</span>
                </>
              )}
            </div>
            <div className="pp-list">
              {shown.map((paper) => (
                <PaperRow
                  key={paper.id}
                  paper={paper}
                  query={query}
                  selected={selected.has(paper.id)}
                  categoryName={activeView === 'all' ? categoryName(paper.categoryId) : null}
                  categories={categories ?? []}
                  tags={liveTags}
                  onSelect={(on) => toggleSelected(paper.id, on)}
                  onOpen={() => onOpen(paper.id)}
                  onRename={() => openDialog({ kind: 'rename', paper })}
                  onDuplicate={() => void duplicate(paper)}
                  onDelete={() => paperTrash.schedule(paper)}
                  onMove={(id) => void moveTo([paper.id], id)}
                  onToggleTag={toggleTag([paper.id])}
                  onTagsOpen={() => startTagSession([paper.id])}
                  onTagsClose={endTagSession}
                  onCreateTag={createTag}
                  onManageTags={() => setManagingTags(true)}
                  onNewCategory={() => setCategoryAsk({ kind: 'create' })}
                />
              ))}
              {shown.length === 0 && filtering && <EmptyState compact {...emptyProps()} />}
            </div>
          </>
        )}
      </section>

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
              maxLength={TITLE_MAX}
              placeholder="例如：七年级数学第一单元测试"
              data-autofocus=""
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) void submit()
              }}
            />
          </label>
          {dialog.kind === 'create' && createCategoryId !== null && <p className="pp-hint">新试卷归入分类「{categoryName(createCategoryId)}」。</p>}
        </Modal>
      )}

      {categoryAsk && categoryAsk.kind !== 'delete' && (
        <CategoryDialog
          category={categoryAsk.kind === 'rename' ? categoryAsk.category : undefined}
          existingNames={(categories ?? []).map((c) => c.name)}
          onSubmit={submitCategory}
          onClose={() => setCategoryAsk(null)}
        />
      )}

      {categoryAsk?.kind === 'delete' && (
        <ConfirmDialog
          title={`删除分类「${categoryAsk.category.name}」`}
          danger
          confirmLabel="删除"
          busy={deleting}
          onConfirm={() => void confirmDeleteCategory(categoryAsk.category)}
          onClose={() => setCategoryAsk(null)}
        >
          {(categoryCounts.get(categoryAsk.category.id) ?? 0) > 0
            ? `其中 ${categoryCounts.get(categoryAsk.category.id)} 份试卷回到「未分类」，试卷本身不受影响。`
            : '其中没有试卷，不影响其他分类。'}
        </ConfirmDialog>
      )}

      {managingTags && tags && (
        <TagManagerModal
          title="管理试卷标签"
          unit="份试卷"
          tags={liveTags}
          onClose={() => setManagingTags(false)}
          onRename={async (id, newName) => {
            const result = await window.workbench.papers.renameTag(id, newName)
            await load()
            return result
          }}
          onDelete={async (id) => {
            await window.workbench.papers.deleteTag(id)
            await load()
          }}
        />
      )}
    </div>
  )
}
