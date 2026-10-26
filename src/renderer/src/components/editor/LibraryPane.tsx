// 编辑器左栏：可筛选的试题库。题目一行一道（方向 C 的密排列表），点「加入试卷」、勾选后批量加入，或拖到右侧试卷。
// 筛选条件按试卷保存（S11）；换筛选回到列表顶部（M4）；已加入的题可以隐藏（F4）。
import { memo, useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { Chapter, Tag as TagItem } from '@shared/classify'
import { primaryQuestionType, type LibraryFacets } from '@shared/library'
import { hasVisibleContent } from '@shared/numbering'
import type { LibraryQuestion, SourcePaper } from '@shared/domain'
import { navigateTo } from '../../navigation'
import { IconChevronDown, IconPlus, IconScissors, IconSearch } from '../../icons'
import { Button, Checkbox, EmptyState, RedPen, RedTick, Select, Tag, TextInput, usePersistentState } from '../ui'
import { errorMessage } from './format'
import { IconPanelLeft } from './icons'
import { classFilter, classKey, describeClassFilters, isStoredFilters, NO_CLASS, NO_FILTERS, normalizeFilters, pruneMissing, withoutCondition, type ClassCondition, type Filters, type StoredFilters } from './libraryFilters'
import MemoQuestionHtml from './MemoQuestionHtml'
import { ActiveConditions, MoreFilters } from './MoreFilters'
import { useClamped } from './useOverflow'

const PAGE_SIZE = 60
const STEM_MAX_HEIGHT = 104

interface Props {
  paperId: number
  addedAt: ReadonlyMap<number, number[]> // 已经加入当前试卷的原题 → 所在题号
  draggingId: number | null
  collapsed: boolean
  onToggleCollapsed(): void
  onAdd(questions: LibraryQuestion[]): void
}

const stop = (event: { stopPropagation(): void }): void => event.stopPropagation()

interface RowProps {
  question: LibraryQuestion
  addedNos: number[] | undefined
  dragging: boolean
  selected: boolean
  selecting: boolean
  onPick(id: number, checked: boolean): void
  onAdd(question: LibraryQuestion): void
}

const LibraryRow = memo(function LibraryRow({ question, addedNos, dragging, selected, selecting, onPick, onAdd }: RowProps) {
  const [expanded, setExpanded] = useState(false)
  const stemRef = useRef<HTMLDivElement>(null)
  const clamped = useClamped(stemRef, STEM_MAX_HEIGHT, [question.stemHtml])
  const { setNodeRef, listeners } = useDraggable({ id: `lib:${question.id}`, data: { kind: 'lib', question } })
  const added = addedNos != null
  const hasAnswer = hasVisibleContent(question.answerHtml)
  return (
    <article
      ref={setNodeRef}
      className={`ed-lib-row${dragging ? ' is-dragging' : ''}${added ? ' is-added' : ''}${selected ? ' is-selected' : ''}${selecting ? ' is-selecting' : ''}`}
      data-testid="lib-card"
      data-question-id={question.id}
      {...listeners}
    >
      <div className="ed-lib-gutter" onMouseDown={stop} onTouchStart={stop}>
        {added && <RedTick className="ed-lib-tick" />}
        <Checkbox className="ed-lib-pick" checked={selected} onChange={(checked) => onPick(question.id, checked)} aria-label={`选择这道${question.questionType || ''}题`} />
      </div>
      <div className="ed-lib-line1">
        <Tag>{question.questionType || '未分类'}</Tag>
        {question.numberCount > 1 && <Tag tone="plain">{question.numberCount} 个小题</Tag>}
        {hasAnswer && <Tag tone="ok">有答案</Tag>}
        {added && (
          <RedPen className="ed-lib-added" title={`已在第 ${addedNos.join('、')} 题`}>
            已加入
          </RedPen>
        )}
        <span className="ed-lib-src" title={question.sourceLabel || question.sourcePaperTitle}>
          {question.sourceLabel || question.sourcePaperTitle}
        </span>
      </div>
      <div ref={stemRef} className={`ed-lib-stem${expanded ? ' is-open' : ''}${clamped ? ' is-clamped' : ''}`}>
        <MemoQuestionHtml html={question.stemHtml} firstNo={1} />
      </div>
      <footer className="ed-lib-foot" onMouseDown={stop} onTouchStart={stop}>
        <Button size="sm" icon={<IconPlus size={14} />} className="ed-lib-add" onClick={() => onAdd(question)} title={added ? '再加入一次' : '加入试卷'}>
          加入试卷
        </Button>
        {clamped && (
          <Button size="sm" variant="link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开'}
          </Button>
        )}
      </footer>
      {dragging && (
        <span className="ed-lib-cut" aria-hidden="true">
          <IconScissors size={16} />
          拖动中
        </span>
      )}
    </article>
  )
})

function LibraryPane({ paperId, addedAt, draggingId, collapsed, onToggleCollapsed, onAdd }: Props) {
  const [types, setTypes] = useState<string[]>([])
  const [sources, setSources] = useState<SourcePaper[]>([])
  // 记住的条件可能是升级前写的（没有「更多筛选」那四项）：按旧形状放行，读出来再补默认值，不让整份作废
  const [stored, setStored] = usePersistentState<StoredFilters>(`ewb.editor.filters.${paperId}`, NO_FILTERS, { validate: isStoredFilters })
  const filters = useMemo(() => normalizeFilters(stored), [stored])
  const setFilters = useCallback(
    (action: SetStateAction<Filters>): void =>
      setStored((prev) => {
        const base = normalizeFilters(prev)
        const next = typeof action === 'function' ? action(base) : action
        return next === base ? prev : next // 没改什么就不写回，旧形状的记录原样留着直到真的改了条件
      }),
    [setStored]
  )
  const [keywordInput, setKeywordInput] = useState(filters.keyword)
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [tags, setTags] = useState<TagItem[] | null>(null)
  const [facets, setFacets] = useState<LibraryFacets | null>(null)
  const [knowledgeNames, setKnowledgeNames] = useState<ReadonlyMap<number, string>>(new Map())
  const [moreOpen, setMoreOpen] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [facetsError, setFacetsError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const optionsLoaded = useRef(false)
  const facetRequest = useRef(0)
  const [items, setItems] = useState<LibraryQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const request = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 筛选项读不到时只是少了下拉选项，题目列表自己会报错
    void Promise.all([window.workbench.library.listQuestionTypes(), window.workbench.library.listSourcePapers()])
      .then(([t, s]) => {
        setTypes([...new Set(t.map(primaryQuestionType))])
        setSources(s)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((f) => (f.keyword === keywordInput ? f : { ...f, keyword: keywordInput })), 250)
    return () => window.clearTimeout(timer)
  }, [keywordInput, setFilters])

  // 章节与标签目录：进来读一次（条件小条要名称），每次打开弹层再读一次（可能刚在试题库页改过）
  useEffect(() => {
    if (!moreOpen && optionsLoaded.current) return
    let live = true
    void Promise.all([window.workbench.library.listChapters(), window.workbench.library.listTags()])
      .then(([c, t]) => {
        if (!live) return
        optionsLoaded.current = true
        setChapters(c)
        setTags(t)
        setOptionsError(null)
      })
      .catch((e) => live && setOptionsError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [moreOpen, retry])

  // 别处删掉的章节、标签从条件里去掉，否则会一直筛出 0 道题还说不清为什么
  useEffect(() => {
    if (chapters || tags) setFilters((f) => pruneMissing(f, chapters, tags))
  }, [chapters, tags, setFilters])

  // 各选项的题数按「当前全部条件」算；只在弹层打开、或有选中的知识点（要它的名称）时才读
  const ck = classKey(filters)
  const needFacets = moreOpen || filters.knowledgeIds.length > 0
  useEffect(() => {
    if (!needFacets) return
    const id = ++facetRequest.current
    void window.workbench.library
      .facets({
        questionType: filters.questionType || undefined,
        sourcePaperId: filters.sourcePaperId ? Number(filters.sourcePaperId) : undefined,
        keyword: filters.keyword || undefined,
        ...classFilter(filters)
      })
      .then((f) => {
        if (id !== facetRequest.current) return
        setFacets(f)
        setFacetsError(null)
        setKnowledgeNames((prev) => {
          const next = new Map(prev)
          for (const k of f.knowledge) next.set(k.id, k.name)
          return next
        })
      })
      .catch((e) => {
        if (id === facetRequest.current) setFacetsError(errorMessage(e))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needFacets, filters.questionType, filters.sourcePaperId, filters.keyword, ck, retry])

  const load = async (offset: number): Promise<void> => {
    const id = ++request.current
    setLoading(true)
    try {
      const page = await window.workbench.library.listQuestions({
        questionType: filters.questionType || undefined,
        sourcePaperId: filters.sourcePaperId ? Number(filters.sourcePaperId) : undefined,
        keyword: filters.keyword || undefined,
        ...classFilter(filters),
        limit: PAGE_SIZE,
        offset
      })
      if (id !== request.current) return
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
      setTotal(page.total)
      setError(null)
    } catch (e) {
      if (id === request.current) setError(errorMessage(e))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  // M4：换了筛选条件，新结果从列表顶部看起，否则停在旧列表的滚动位置上，像只有几道题
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
    setSelected(new Set())
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.questionType, filters.sourcePaperId, filters.keyword, ck])

  const visible = useMemo(() => (filters.hideAdded ? items.filter((q) => !addedAt.has(q.id)) : items), [items, filters.hideAdded, addedAt])

  // 隐藏已加入之后这一页可能只剩几道，接着往下取，避免列表看起来像到头了
  useEffect(() => {
    if (filters.hideAdded && !loading && !error && visible.length < 10 && items.length < total) void load(items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.hideAdded, loading, visible.length, items.length, total])

  const classConditions = useMemo(() => describeClassFilters(filters, { chapters, tags, knowledgeNames }), [filters, chapters, tags, knowledgeNames])
  // 无结果时写出的条件：「章节「第一章」「未归章节」」这样一项一组
  const classText = (['chapter', 'difficulty', 'knowledge', 'tag'] as const).flatMap((kind) => {
    const items = classConditions.filter((c) => c.kind === kind)
    return items.length ? [`${items[0].kindLabel}${items.map((c) => `「${c.label}」`).join('')}`] : []
  })
  const conditions = [
    filters.questionType && `题型「${filters.questionType}」`,
    filters.sourcePaperId && `来源卷「${sources.find((s) => String(s.id) === filters.sourcePaperId)?.title ?? '已选'}」`,
    filters.keyword && `关键词「${filters.keyword}」`,
    ...classText
  ].filter(Boolean) as string[]
  const filtered = conditions.length > 0

  const clearFilters = (): void => {
    setKeywordInput('')
    setFilters((f) => ({ ...NO_FILTERS, hideAdded: f.hideAdded }))
  }
  const patchClass = (next: Partial<Pick<Filters, 'chapterIds' | 'knowledgeIds' | 'difficulties' | 'tagIds'>>): void => setFilters((f) => ({ ...f, ...next }))
  const clearClass = (): void => setFilters((f) => ({ ...f, ...NO_CLASS }))
  const removeCondition = (item: ClassCondition): void => setFilters((f) => withoutCondition(f, item))

  const pick = (id: number, checked: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  const addSelected = (): void => {
    const chosen = items.filter((q) => selected.has(q.id))
    if (chosen.length === 0) return
    onAdd(chosen)
    setSelected(new Set())
  }

  // 当前筛选结果都读到了，就数结果里已加入的；没读完时只能给整份试卷用过的原题数
  const addedShown = items.length >= total ? items.filter((q) => addedAt.has(q.id)).length : addedAt.size
  const noAnswerAtAll = !error && total > 0 && items.length === total && items.every((q) => !hasVisibleContent(q.answerHtml))

  const sourceOptions = [{ value: '', label: '全部来源卷' }, ...sources.map((s) => ({ value: String(s.id), label: `${s.title}（${s.questionCount}）` }))]
  const typeOptions = [{ value: '', label: '全部题型' }, ...types.map((t) => ({ value: t, label: t }))]

  return (
    <aside className={`ed-lib${collapsed ? ' is-collapsed' : ''}`} aria-label="试题库">
      {collapsed && (
        <button type="button" className="ed-lib-rail" aria-label="展开试题库" title="展开试题库" onClick={onToggleCollapsed}>
          <IconPanelLeft />
          <span>试题库</span>
        </button>
      )}
      <div className="ed-lib-inner" hidden={collapsed} inert={collapsed}>
        <div className="ed-lib-head">
          <div className="ed-lib-selects">
            <Select aria-label="题型" value={filters.questionType} onChange={(v) => setFilters((f) => ({ ...f, questionType: v }))} options={typeOptions} />
            <Select aria-label="来源卷" value={filters.sourcePaperId} onChange={(v) => setFilters((f) => ({ ...f, sourcePaperId: v }))} options={sourceOptions} />
          </div>
          <div className="ed-lib-search">
            <TextInput className="ed-lib-kw" value={keywordInput} onChange={setKeywordInput} placeholder="题干关键词" aria-label="题干关键词" leading={<IconSearch size={16} />} clearable />
            <MoreFilters
              open={moreOpen}
              onOpenChange={setMoreOpen}
              filters={filters}
              patch={patchClass}
              clearClass={clearClass}
              chapters={chapters ?? []}
              tags={tags ?? []}
              facets={facets}
              error={facetsError ?? optionsError}
              onRetry={() => setRetry((n) => n + 1)}
              total={total}
              filtered={filtered}
            />
          </div>
          <ActiveConditions items={classConditions} onRemove={removeCondition} onClear={clearClass} />
          <div className="ed-lib-count">
            <span>
              <span data-testid="lib-total">{error ? '读取失败' : `共 ${total} 道题`}</span>
              <span className="ed-lib-added-count" data-testid="lib-added-count">
                {' '}
                · 已加入 {addedShown} 道
              </span>
            </span>
            <span className="ed-lib-count-tools">
              <Checkbox checked={filters.hideAdded} onChange={(hideAdded) => setFilters((f) => ({ ...f, hideAdded }))}>
                隐藏已加入
              </Checkbox>
              <button type="button" className="ed-lib-fold" aria-label="收起试题库" title="收起试题库" onClick={onToggleCollapsed}>
                <IconPanelLeft />
              </button>
            </span>
          </div>
        </div>
        {noAnswerAtAll && <div className="notice">当前列表的题目都没有答案。教师版需要答案，可在试卷里给题目「添加答案」。</div>}
        <div className="ed-lib-list" ref={listRef} data-testid="lib-list">
          {error && <p className="ed-lib-error">{error}</p>}
          {!error && !loading && total === 0 && !filtered && (
            <EmptyState
              compact
              title="试题库里还没有题目"
              description="先到「采集」页从组卷网入库题目，再回来组卷。"
              actions={
                <Button variant="primary" size="sm" onClick={() => navigateTo('collect')}>
                  去采集
                </Button>
              }
            />
          )}
          {!error && !loading && total === 0 && filtered && (
            <EmptyState
              compact
              title="没有符合条件的题目"
              description={`当前条件：${conditions.join('、')}`}
              actions={
                <Button size="sm" onClick={clearFilters}>
                  清除筛选
                </Button>
              }
            />
          )}
          {!error && !loading && total > 0 && visible.length === 0 && items.length >= total && filters.hideAdded && (
            <EmptyState
              compact
              title="符合条件的题目都已加入试卷"
              actions={
                <Button size="sm" onClick={() => setFilters((f) => ({ ...f, hideAdded: false }))}>
                  显示已加入的题
                </Button>
              }
            />
          )}
          {visible.map((q) => (
            <LibraryRow
              key={q.id}
              question={q}
              addedNos={addedAt.get(q.id)}
              dragging={draggingId === q.id}
              selected={selected.has(q.id)}
              selecting={selected.size > 0}
              onPick={pick}
              onAdd={(question) => onAdd([question])}
            />
          ))}
          {items.length < total && (
            <button type="button" className="ed-lib-more" disabled={loading} onClick={() => void load(items.length)}>
              {loading ? '加载中…' : `加载更多（还有 ${total - items.length} 道）`}
              <IconChevronDown size={14} />
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <div className="ed-lib-batch" role="region" aria-label="批量加入">
            <span>已选 {selected.size} 道</span>
            <span className="ed-lib-batch-actions">
              <Button size="sm" onClick={() => setSelected(new Set())}>
                取消选择
              </Button>
              <Button size="sm" variant="primary" onClick={addSelected}>
                加入试卷（{selected.size}）
              </Button>
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}

export default memo(LibraryPane)
