// 试题库：按题型、来源卷、关键词筛选，浏览入库的原题，把题直接加入试卷，展开答案，删除原题。
// 筛选条件放在 libraryFilterStore：切页面再回来还在，入库完成后能直接跳到「只看本次入库」。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryQuestion, PaperSummary, SourcePaper } from '@shared/domain'
import { compareTypeNames, primaryQuestionType, type LibraryFacets, type QuestionFilter } from '@shared/library'
import { IconClose, IconSearch } from '../icons'
import { navigateTo } from '../navigation'
import { addQuestionToPaper } from '../components/library/addToPaper'
import { errorMessage } from '../components/library/format'
import { useImportState } from '../components/library/importStore'
import { isFiltered, libraryFilter, useLibraryFilter } from '../components/library/libraryFilterStore'
import { useExecutedDeletes, useHiddenPapers } from '../components/library/paperTrash'
import PaperPickerModal from '../components/library/PaperPickerModal'
import QuestionRow from '../components/library/QuestionRow'
import { Button, EmptyState, Select, TextInput, toast, usePersistentState } from '../components/ui'
import './LibraryPage.css'

const PAGE_SIZE = 30

interface TypeGroup {
  primary: string
  count: number
  children: { type: string; name: string; count: number }[] // type 是带子类的完整标签，如「解答题-计算题」
}

// 题型标签按大类归并，大类与子类都按常用顺序排（选择 → 填空 → 阅读 → 解答 → 写作）
function groupTypes(facets: LibraryFacets | null, selected: string): TypeGroup[] {
  const map = new Map<string, TypeGroup>()
  const entry = (primary: string): TypeGroup => {
    let group = map.get(primary)
    if (!group) map.set(primary, (group = { primary, count: 0, children: [] }))
    return group
  }
  for (const { type, count } of facets?.types ?? []) {
    if (!type) continue
    const primary = primaryQuestionType(type)
    const group = entry(primary)
    group.count += count
    if (type !== primary) group.children.push({ type, name: type.slice(primary.length + 1), count })
  }
  // 当前选中的题型在其他条件下没有题时也要列出来（题数 0），否则筛选栏里看不到自己选了什么
  if (selected) {
    const primary = primaryQuestionType(selected)
    const group = entry(primary)
    if (selected !== primary && !group.children.some((c) => c.type === selected)) group.children.push({ type: selected, name: selected.slice(primary.length + 1), count: 0 })
  }
  const groups = [...map.values()]
  for (const g of groups) g.children.sort((a, b) => compareTypeNames({ name: a.name, count: a.count }, { name: b.name, count: b.count }))
  return groups.sort((a, b) => compareTypeNames({ name: a.primary, count: a.count }, { name: b.primary, count: b.count }))
}

export default function LibraryPage() {
  const importState = useImportState()
  const filter = useLibraryFilter()
  const hiddenPapers = useHiddenPapers()
  const executedDeletes = useExecutedDeletes()
  const [keywordInput, setKeywordInput] = useState(filter.keyword)
  const [sourcePapers, setSourcePapers] = useState<SourcePaper[]>([])
  const [facets, setFacets] = useState<LibraryFacets | null>(null)
  const [items, setItems] = useState<LibraryQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<Record<number, number>>({})
  const [allPapers, setAllPapers] = useState<PaperSummary[]>([])
  const [picking, setPicking] = useState<LibraryQuestion | null>(null)
  const [addingId, setAddingId] = useState<number | null>(null)
  const [noticeDismissed, setNoticeDismissed] = usePersistentState('ewb.library.noAnswerNoticeDismissed', false)
  const request = useRef(0)
  const facetRequest = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const pushedKeyword = useRef(filter.keyword)

  const { library, papers } = window.workbench

  // 关键词输入停顿后再写进筛选条件；条件被外部清掉时（清除筛选）输入框跟着清空
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = keywordInput.trim()
      pushedKeyword.current = next
      if (next !== libraryFilter.get().keyword) libraryFilter.patch({ keyword: next })
    }, 250)
    return () => clearTimeout(timer)
  }, [keywordInput])
  useEffect(() => {
    if (filter.keyword !== pushedKeyword.current) {
      pushedKeyword.current = filter.keyword
      setKeywordInput(filter.keyword)
    }
  }, [filter.keyword])

  const query = useMemo<QuestionFilter>(
    () => ({ questionType: filter.type || undefined, sourcePaperId: filter.paperId ?? undefined, keyword: filter.keyword || undefined, ids: filter.batch?.ids }),
    [filter.type, filter.paperId, filter.keyword, filter.batch]
  )

  const loadFacets = useCallback(async (): Promise<void> => {
    const id = ++facetRequest.current
    const [f, p] = await Promise.all([library.facets({ sourcePaperId: query.sourcePaperId, keyword: query.keyword, ids: query.ids }), library.listSourcePapers()])
    if (id !== facetRequest.current) return // 条件又变了，丢弃过期结果
    setFacets(f)
    setSourcePapers(p.filter((paper) => paper.questionCount > 0))
  }, [library, query.sourcePaperId, query.keyword, query.ids])

  useEffect(() => {
    void loadFacets()
  }, [loadFacets])

  const load = useCallback(
    async (offset: number): Promise<void> => {
      const id = ++request.current
      setLoading(true)
      setError(null)
      try {
        const page = await library.listQuestions({ ...query, limit: PAGE_SIZE, offset })
        if (id !== request.current) return // 筛选条件又变了，丢弃过期结果
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
        setTotal(page.total)
        setLoaded(true)
      } catch (e) {
        if (id === request.current) setError(errorMessage(e))
      } finally {
        if (id === request.current) setLoading(false)
      }
    },
    [query, library]
  )

  useEffect(() => {
    void load(0)
    listRef.current?.scrollTo({ top: 0 }) // 换了筛选条件从头看，不停在上一个结果的末尾
  }, [load])

  // 已用于几份试卷：列表变了、加入了试卷、试卷被删除后都重新取
  const [usageTick, setUsageTick] = useState(0)
  useEffect(() => {
    if (items.length === 0) {
      setUsage({})
      return
    }
    let cancelled = false
    void library.questionUsage(items.map((q) => q.id)).then((u) => !cancelled && setUsage(u))
    return () => {
      cancelled = true
    }
  }, [items, library, usageTick, executedDeletes])

  // 加入试卷菜单用的试卷列表：最近编辑的在前，藏起来等待删除的不列
  useEffect(() => {
    void papers.list().then(setAllPapers, () => undefined)
  }, [papers, usageTick, executedDeletes])
  const livePapers = useMemo(() => allPapers.filter((p) => !hiddenPapers.has(p.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [allPapers, hiddenPapers])

  // 选中的题型已经没有题目（删光了）：回到全部题型
  useEffect(() => {
    if (!filter.type || !facets || filter.paperId !== null || filter.keyword || filter.batch) return
    if (!facets.types.some((t) => t.type === filter.type || primaryQuestionType(t.type) === filter.type)) libraryFilter.patch({ type: '' })
  }, [facets, filter])

  const removeQuestion = async (id: number): Promise<void> => {
    await library.deleteQuestion(id)
    setItems((prev) => prev.filter((q) => q.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    void loadFacets()
  }

  const addQuestion = async (question: LibraryQuestion, paperId: number): Promise<void> => {
    setPicking(null)
    setAddingId(question.id)
    try {
      const added = await addQuestionToPaper(paperId, question)
      toast.show(`已加入《${added.title}》第 ${added.label} 题`, { action: { label: '打开', run: () => navigateTo('papers', { paperId: added.paperId }) } })
      setUsageTick((n) => n + 1)
    } catch (e) {
      toast.error(`加入试卷失败：${errorMessage(e)}`)
    } finally {
      setAddingId(null)
    }
  }

  const groups = useMemo(() => groupTypes(facets, filter.type), [facets, filter.type])
  const typeTotal = facets?.types.reduce((sum, t) => sum + t.count, 0) ?? 0
  const selectedPrimary = filter.type ? primaryQuestionType(filter.type) : ''
  const filtered = isFiltered(filter)
  const importRunning = importState.stage === 'starting' || importState.stage === 'running'
  const libraryEmpty = facets !== null && facets.total === 0
  const noAnswerAnywhere = facets !== null && facets.total > 0 && facets.withAnswer === 0
  const sourceTitle = sourcePapers.find((p) => p.id === filter.paperId)?.title ?? ''

  const conditions: string[] = []
  if (filter.batch) conditions.push('只看本次入库的题')
  if (filter.type) conditions.push(`题型「${filter.type}」`)
  if (filter.paperId !== null) conditions.push(`来源卷「${sourceTitle || filter.paperId}」`)
  if (filter.keyword) conditions.push(`关键词「${filter.keyword}」`)

  return (
    <div className="lb-page">
      <aside className="lb-filter" aria-label="筛选">
        <div>
          <div className="lb-label">关键词</div>
          <TextInput value={keywordInput} onChange={setKeywordInput} leading={<IconSearch size={16} />} clearable placeholder="题干中的文字" aria-label="关键词" />
        </div>
        <div>
          <div className="lb-label">题型</div>
          <ul className="lb-types" aria-label="题型">
            <li>
              <button type="button" className={!filter.type ? 'is-on' : ''} aria-pressed={!filter.type} onClick={() => libraryFilter.patch({ type: '' })}>
                <span>全部题型</span>
                <em>{typeTotal}</em>
              </button>
            </li>
            {groups.map((g) => (
              <li key={g.primary}>
                <button type="button" className={filter.type === g.primary ? 'is-on' : ''} aria-pressed={filter.type === g.primary} onClick={() => libraryFilter.patch({ type: g.primary })}>
                  <span>{g.primary}</span>
                  <em>{g.count}</em>
                </button>
                {selectedPrimary === g.primary && g.children.length > 0 && (
                  <ul className="lb-sub">
                    {g.children.map((child) => (
                      <li key={child.type}>
                        <button type="button" className={filter.type === child.type ? 'is-on' : ''} aria-pressed={filter.type === child.type} title={child.type} onClick={() => libraryFilter.patch({ type: child.type })}>
                          <span>{child.name}</span>
                          <em>{child.count}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="lb-label">来源卷</div>
          <Select
            value={filter.paperId ?? 0}
            onChange={(id) => libraryFilter.patch({ paperId: id === 0 ? null : id })}
            aria-label="来源卷"
            options={[{ value: 0, label: '全部来源卷' }, ...sourcePapers.map((p) => ({ value: p.id, label: `${p.title}（${p.questionCount} 题）` }))]}
          />
        </div>
        {filtered && (
          <Button variant="link" size="sm" className="lb-reset" onClick={libraryFilter.clear}>
            清除筛选
          </Button>
        )}
      </aside>

      <section className="lb-main">
        <header className="lb-head">
          <h1>试题库</h1>
          {filter.batch && <Chip label="本次入库" onClear={() => libraryFilter.patch({ batch: null })} />}
          {filter.type && <Chip label={`题型：${filter.type}`} onClear={() => libraryFilter.patch({ type: '' })} />}
          {filter.paperId !== null && <Chip label={`来源卷：${sourceTitle || filter.paperId}`} onClear={() => libraryFilter.patch({ paperId: null })} />}
          {filter.keyword && <Chip label={`关键词：${filter.keyword}`} onClear={() => libraryFilter.patch({ keyword: '' })} />}
          <span className="lb-total" data-testid="library-total">
            {filtered && facets ? `筛出 ${total} 道，全库 ${facets.total} 道` : `共 ${total} 道题`}
          </span>
        </header>
        {importRunning && <div className="notice">入库正在进行，需要处理验证时请回到「采集」页。</div>}
        {error && <div className="notice error">{error}</div>}
        {noAnswerAnywhere && !noticeDismissed && (
          <div className="notice lb-notice" data-testid="no-answer-notice">
            <span>全库 {facets.total} 道题都还没有答案。教师版要带答案，可在试卷里给题目「添加答案」。</span>
            <Button variant="link" size="sm" onClick={() => setNoticeDismissed(true)}>
              知道了
            </Button>
          </div>
        )}
        <div className="lb-thead" aria-hidden="true">
          <span>序</span>
          <span>题目</span>
          <span>来源</span>
          <span>操作</span>
        </div>
        <div className="lb-list" ref={listRef}>
          {items.map((q, i) => (
            <QuestionRow
              key={q.id}
              index={i + 1}
              question={q}
              keyword={filter.keyword}
              markNoAnswer={!noAnswerAnywhere}
              usage={usage[q.id] ?? 0}
              recentPapers={livePapers.slice(0, 3)}
              adding={addingId === q.id}
              onAdd={(question, paperId) => void addQuestion(question, paperId)}
              onPick={setPicking}
              onDelete={removeQuestion}
            />
          ))}
          {loaded && !loading && items.length === 0 && libraryEmpty && (
            <EmptyState
              bordered
              className="lb-empty"
              title="试题库还是空的"
              description="到「采集」页把组卷网的试卷或试题入库，题目会显示在这里。"
              actions={
                <Button variant="primary" onClick={() => navigateTo('collect')}>
                  去采集
                </Button>
              }
            />
          )}
          {loaded && !loading && items.length === 0 && !libraryEmpty && (
            <EmptyState
              bordered
              className="lb-empty"
              title="没有符合条件的题目"
              description={filtered ? `当前条件：${conditions.join('，')}` : undefined}
              actions={
                filtered && (
                  <Button variant="primary" onClick={libraryFilter.clear}>
                    清除筛选
                  </Button>
                )
              }
            />
          )}
          {items.length < total && (
            <div className="lb-more">
              <Button disabled={loading} onClick={() => void load(items.length)}>
                {loading ? '正在加载' : `加载更多（已显示 ${items.length} / ${total}）`}
              </Button>
            </div>
          )}
        </div>
      </section>

      {picking && <PaperPickerModal papers={livePapers} onClose={() => setPicking(null)} onChoose={(paperId) => void addQuestion(picking, paperId)} />}
    </div>
  )
}

function Chip({ label, onClear }: { label: string; onClear(): void }) {
  return (
    <span className="lb-chip">
      <span className="lb-chip-label" title={label}>
        {label}
      </span>
      <button type="button" aria-label={`清除筛选：${label}`} onClick={onClear}>
        <IconClose size={14} />
      </button>
    </span>
  )
}
