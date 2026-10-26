// 试题库：按关键词、章节、题型、难度、知识点、标签、来源卷筛选，浏览入库的原题，把题直接加入试卷，展开答案，删除原题；
// 勾选题目后批量归到章节、打标签、去标签。
// 筛选条件放在 libraryFilterStore：切页面再回来还在，入库完成后能直接跳到「只看本次入库」。
// 章节与标签由老师自建，知识点与难度是入库时从组卷网读来的（只读）；四项筛选的题数都来自 library.facets（按其他条件计算、本项不参与）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NO_CHAPTER, type Chapter, type Tag, type TagRef } from '@shared/classify'
import type { LibraryQuestion, PaperSummary, SourcePaper } from '@shared/domain'
import { compareTypeNames, primaryQuestionType, type LibraryFacets, type QuestionFilter, type QuestionTarget } from '@shared/library'
import { IconClose, IconSearch } from '../icons'
import { navigateTo } from '../navigation'
import { ChapterFilter, DifficultyFilter, KnowledgeFilter, TagFilter, TagManagerModal } from '../components/classify'
import { addQuestionToPaper } from '../components/library/addToPaper'
import { chapterPath } from '../components/library/chapterPath'
import ChapterManagerModal from '../components/library/ChapterManagerModal'
import { filterConditions, type FilterNames } from '../components/library/filterText'
import { useImportState } from '../components/library/importStore'
import { isFiltered, libraryFilter, useLibraryFilter } from '../components/library/libraryFilterStore'
import { useExecutedDeletes, useHiddenPapers } from '../components/library/paperTrash'
import PaperPickerModal from '../components/library/PaperPickerModal'
import QuestionRow, { type RowTagApi } from '../components/library/QuestionRow'
import SelectionBar, { type TagStates } from '../components/library/SelectionBar'
import { Button, Checkbox, ConfirmDialog, EmptyState, Select, TextInput, errorMessage, toast, usePersistentState } from '../components/ui'
import './LibraryPage.css'

const PAGE_SIZE = 30
// 题型一列默认显示的行数，其余收在「展开全部」后面（选中的始终可见）
const TYPE_SHOWN = 8

// 选择框开着时每勾一次只记一笔，关闭时汇总成一条提示：「已给 12 道题打上「易错」，去掉「压轴」」
// initial 是打开时每个标签在所选的题里的状况（全有 / 部分有 / 没有）：勾上又取消回到原样的，不算改动
interface TagLog {
  single: boolean
  questionId?: number // single 时是哪一道题：这一行被刷新掉后，小框的记录不再有意义
  ids?: number[] // 批量时选择框打开那一刻的题号，之后每次打 / 去标签都对着这一批，不随筛选结果缩小
  n: number
  initial(tagId: number): 'all' | 'some' | 'none'
  ops: Map<number, { name: string; on: boolean }>
}

// 勾选：具体勾了哪些题，或「全选筛出的 N 道」（按当前条件操作，不受分页影响，不把题号一页页攒起来）
type Selection = { kind: 'ids'; ids: ReadonlySet<number> } | { kind: 'all' }
const NO_SELECTION: Selection = { kind: 'ids', ids: new Set() }

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
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [items, setItems] = useState<LibraryQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<Record<number, number>>({})
  const [allPapers, setAllPapers] = useState<PaperSummary[]>([])
  const [picking, setPicking] = useState<LibraryQuestion | null>(null)
  const [addingId, setAddingId] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [managing, setManaging] = useState<'chapters' | 'tags' | null>(null)
  const [typesExpanded, setTypesExpanded] = useState(false)
  const [assignAsk, setAssignAsk] = useState<{ chapterId: number; moving: number; total: number } | null>(null)
  const tagLog = useRef<TagLog | null>(null)
  const [noticeDismissed, setNoticeDismissed] = usePersistentState('ewb.library.noAnswerNoticeDismissed', false)
  const selectionRef = useRef<Selection>(NO_SELECTION)
  selectionRef.current = selection
  const request = useRef(0)
  const facetRequest = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const pushedKeyword = useRef(filter.keyword)
  const itemCount = useRef(0)
  itemCount.current = items.length

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
    () => ({
      questionType: filter.type || undefined,
      sourcePaperId: filter.paperId ?? undefined,
      keyword: filter.keyword || undefined,
      ids: filter.batch?.ids,
      chapterIds: filter.chapterIds.length ? filter.chapterIds : undefined,
      knowledgeIds: filter.knowledgeIds.length ? filter.knowledgeIds : undefined,
      difficulties: filter.difficulties.length ? filter.difficulties : undefined,
      tagIds: filter.tagIds.length ? filter.tagIds : undefined
    }),
    [filter.type, filter.paperId, filter.keyword, filter.batch, filter.chapterIds, filter.knowledgeIds, filter.difficulties, filter.tagIds]
  )
  // 换了筛选条件就清空勾选：旧的勾选对着一批已经看不见的题
  const queryKey = useMemo(() => JSON.stringify(query), [query])
  const latestKey = useRef(queryKey)
  latestKey.current = queryKey
  useEffect(() => setSelection(NO_SELECTION), [queryKey])

  // 四项归类筛选的题数都由 facets 按「其他条件」算好，这里要传完整条件（题型那一项由主进程自己跳过）
  const loadFacets = useCallback(async (): Promise<void> => {
    const id = ++facetRequest.current
    const [f, p] = await Promise.all([library.facets(query), library.listSourcePapers()])
    if (id !== facetRequest.current) return // 条件又变了，丢弃过期结果
    setFacets(f)
    setSourcePapers(p.filter((paper) => paper.questionCount > 0))
  }, [library, query])

  useEffect(() => {
    void loadFacets()
  }, [loadFacets])

  // 来源卷下的题被删光后来源卷记录一并清掉：筛选里选着它的条件也去掉，否则会留下一个看不见原因的空结果
  useEffect(() => {
    if (filter.paperId !== null && facets && !sourcePapers.some((p) => p.id === filter.paperId)) libraryFilter.patch({ paperId: null })
  }, [facets, sourcePapers, filter.paperId])

  // 章节、标签被删掉后，筛选条件里残留的编号一并去掉，否则会筛出一个看不见原因的空结果
  const reloadChapters = useCallback(async (): Promise<void> => {
    const list = await library.listChapters()
    setChapters(list)
    const alive = new Set([NO_CHAPTER, ...list.map((c) => c.id)])
    const current = libraryFilter.get().chapterIds
    if (current.some((id) => !alive.has(id))) libraryFilter.patch({ chapterIds: current.filter((id) => alive.has(id)) })
  }, [library])
  const reloadTags = useCallback(async (): Promise<void> => {
    const list = await library.listTags()
    setTags(list)
    const alive = new Set(list.map((t) => t.id))
    const current = libraryFilter.get().tagIds
    if (current.some((id) => !alive.has(id))) libraryFilter.patch({ tagIds: current.filter((id) => alive.has(id)) })
  }, [library])
  useEffect(() => {
    void reloadChapters()
    void reloadTags()
  }, [reloadChapters, reloadTags])

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

  // 归类改过之后原地刷新：已加载的几页照样留着（不跳回第一页），题数跟着变
  const reloadList = useCallback(async (): Promise<void> => {
    const id = ++request.current
    try {
      const want = Math.max(itemCount.current, PAGE_SIZE)
      let all: LibraryQuestion[] = []
      let totalNow = 0
      while (all.length < want) {
        const page = await library.listQuestions({ ...query, limit: Math.min(1000, want - all.length), offset: all.length })
        totalNow = page.total
        all = [...all, ...page.items]
        if (page.items.length === 0) break
      }
      if (id !== request.current) return
      setItems(all)
      setTotal(totalNow)
    } catch (e) {
      if (id === request.current) setError(errorMessage(e))
    } finally {
      // 它顶掉了进行中的「加载更多」，那一次不会再复位 loading
      if (id === request.current) setLoading(false)
    }
  }, [library, query])

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

  // 选中的题型已经没有题目（删光了）：回到全部题型。其他条件也会让题型的题数变成 0，那种情况不能当作「题型没了」
  useEffect(() => {
    if (!filter.type || !facets || filter.paperId !== null || filter.keyword || filter.batch) return
    if (filter.chapterIds.length || filter.knowledgeIds.length || filter.difficulties.length || filter.tagIds.length) return
    if (!facets.types.some((t) => t.type === filter.type || primaryQuestionType(t.type) === filter.type)) libraryFilter.patch({ type: '' })
  }, [facets, filter])

  // 勾选里只留还在当前条件下的题（打标签、去标签后有的题会离开当前筛选）
  const pruneSelection = useCallback(async (): Promise<void> => {
    const key = latestKey.current
    const live = new Set(await library.listQuestionIds(query))
    if (key !== latestKey.current) return
    setSelection((prev) => {
      if (prev.kind !== 'ids' || prev.ids.size === 0) return prev
      const kept = [...prev.ids].filter((id) => live.has(id))
      return kept.length === prev.ids.size ? prev : { kind: 'ids', ids: new Set(kept) }
    })
  }, [library, query])

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([reloadList(), loadFacets(), reloadTags(), reloadChapters()])
    await pruneSelection()
  }, [reloadList, loadFacets, reloadTags, reloadChapters, pruneSelection])

  // 失败时抛给 QuestionRow，由它提示并收起确认态
  const removeQuestion = useCallback(async (id: number): Promise<void> => {
    await library.deleteQuestion(id)
    setItems((prev) => prev.filter((q) => q.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    setSelection((prev) => {
      if (prev.kind !== 'ids' || !prev.ids.has(id)) return prev
      const ids = new Set(prev.ids)
      ids.delete(id)
      return { kind: 'ids', ids }
    })
    void loadFacets()
    void reloadTags()
    void reloadChapters()
  }, [library, loadFacets, reloadTags, reloadChapters])

  const addQuestion = useCallback(async (question: LibraryQuestion, paperId: number): Promise<void> => {
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
  }, [])

  // ---------- 勾选与批量操作 ----------
  const selectedCount = selection.kind === 'all' ? total : selection.ids.size
  const isSelected = (id: number): boolean => selection.kind === 'all' || selection.ids.has(id)
  const loadedSelected = items.filter((q) => isSelected(q.id)).length
  const allLoadedSelected = items.length > 0 && loadedSelected === items.length
  const target = (): QuestionTarget => (selection.kind === 'all' ? { filter: query } : { ids: [...selection.ids] })

  const selectRow = useCallback(
    async (id: number, next: boolean): Promise<void> => {
      if (selectionRef.current.kind === 'ids') {
        setSelection((prev) => {
          if (prev.kind !== 'ids') return prev
          const ids = new Set(prev.ids)
          if (next) ids.add(id)
          else ids.delete(id)
          return { kind: 'ids', ids }
        })
        return
      }
      if (next) return
      // 「全选筛出的」里取消一道：改成具体的题号集合（一次取全，不是一页页攒）
      const key = latestKey.current
      const ids = await library.listQuestionIds(query)
      if (key !== latestKey.current) return
      // 取回前又取消了别的行时，那次已经把选择换成了题号集合：只从现有集合里去掉这一行，不拿旧的全量结果盖回去
      setSelection((prev) => {
        if (prev.kind !== 'ids') return { kind: 'ids', ids: new Set(ids.filter((x) => x !== id)) }
        if (!prev.ids.has(id)) return prev
        const kept = new Set(prev.ids)
        kept.delete(id)
        return { kind: 'ids', ids: kept }
      })
    },
    [library, query]
  )
  const toggleLoaded = (): void => setSelection(allLoadedSelected ? NO_SELECTION : { kind: 'ids', ids: new Set(items.map((q) => q.id)) })

  const assign = async (chapterId: number | null): Promise<void> => {
    try {
      const n = await library.assignChapter(target(), chapterId)
      const path = chapterPath(chapters, chapterId)
      toast.show(chapterId === null ? `已把 ${n} 道题移出章节` : `已把 ${n} 道题归到「${path ?? '所选章节'}」`)
      setSelection(NO_SELECTION)
      await refreshAll()
    } catch (e) {
      toast.error(`归到章节失败：${errorMessage(e)}`)
    }
  }

  // 所选的题里有已在别的章节的，归到新章节等于移动：先写明有几道、移到哪，确认后再动
  const requestAssign = async (chapterId: number | null): Promise<void> => {
    if (chapterId === null) return void assign(null)
    try {
      const ids = selection.kind === 'all' ? await library.listQuestionIds(query) : [...selection.ids]
      const by = new Map((await library.facets({ ids })).chapters.map((c) => [c.id, c.count]))
      const count = (id: number): number => by.get(id) ?? 0
      const dest = chapters.find((c) => c.id === chapterId)
      // 目标是章：章的题数含其下各节，减掉各节才是直接归在章上的；目标是节：就是这个节的题数
      const already = dest && dest.parentId === null ? count(chapterId) - chapters.filter((c) => c.parentId === chapterId).reduce((sum, c) => sum + count(c.id), 0) : count(chapterId)
      const moving = ids.length - count(NO_CHAPTER) - already
      if (moving > 0) setAssignAsk({ chapterId, moving, total: ids.length })
      else void assign(chapterId)
    } catch (e) {
      toast.error(`归到章节失败：${errorMessage(e)}`)
    }
  }

  const createTag = useCallback(
    async (name: string): Promise<TagRef> => {
      const tag = await library.createTag(name)
      await reloadTags()
      return { id: tag.id, name: tag.name }
    },
    [library, reloadTags]
  )

  useEffect(() => {
    if (selectedCount === 0 && tagLog.current && !tagLog.current.single) flushTagLog()
    // 只在勾选数变化时看一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCount])

  const logTag = (tag: TagRef, on: boolean, n: number): void => {
    const log = tagLog.current
    if (!log) return
    log.n = n
    log.ops.set(tag.id, { name: tag.name, on })
  }
  // 选择框关闭：有改动就汇总成一条提示
  const flushTagLog = useCallback((): void => {
    const log = tagLog.current
    tagLog.current = null
    if (!log) return
    const names = (pick: (on: boolean, was: 'all' | 'some' | 'none') => boolean): string[] => [...log.ops].filter(([id, op]) => pick(op.on, log.initial(id))).map(([, op]) => `「${op.name}」`)
    const added = names((on, was) => on && was !== 'all')
    const removed = names((on, was) => !on && was !== 'none')
    const subject = log.single ? '这道题' : ` ${log.n} 道题`
    const parts: string[] = []
    if (added.length > 0) parts.push(`已给${subject}打上${added.join('、')}`)
    if (removed.length > 0) parts.push(added.length > 0 ? `去掉${removed.join('、')}` : `已从${subject}去掉${removed.join('、')}`)
    if (parts.length > 0) toast.show(parts.join('，'))
  }, [])

  const changeSelectedTag = async (tag: TagRef, on: boolean): Promise<void> => {
    const fixed = tagLog.current?.ids
    const n = await library.changeQuestionTags(fixed ? { ids: fixed } : target(), on ? { add: [tag.id] } : { remove: [tag.id] })
    logTag(tag, on, n)
    void refreshAll() // 选择框里的勾选状态不等列表刷新完
  }

  // 所选的题各带哪些标签：在 ids 里统计每个标签有几道，等于所选题数的为全有、大于 0 的为部分有
  const loadTagStates = async (): Promise<TagStates> => {
    const ids = selection.kind === 'all' ? await library.listQuestionIds(query) : [...selection.ids]
    const checked = new Set<number>()
    const mixed = new Set<number>()
    const counts = new Map<number, number>()
    if (ids.length > 0) {
      for (const t of (await library.facets({ ids })).tags) counts.set(t.id, t.count)
      for (const [id, n] of counts) {
        if (n === ids.length) checked.add(id)
        else if (n > 0) mixed.add(id)
      }
    }
    tagLog.current = { single: false, ids, n: ids.length, initial: (id) => (checked.has(id) ? 'all' : mixed.has(id) ? 'some' : 'none'), ops: new Map() }
    return { checked, mixed, counts, size: ids.length }
  }

  // 单题打标签：勾选后马上落库并更新这一行；提示在选择框关闭时汇总，列表也在那时才刷新
  const toggleRowTag = useCallback(async (question: LibraryQuestion, tag: TagRef, on: boolean): Promise<void> => {
    if (tagLog.current === null) {
      const had = new Set(question.tags.map((t) => t.id))
      tagLog.current = { single: true, questionId: question.id, n: 1, initial: (id) => (had.has(id) ? 'all' : 'none'), ops: new Map() }
    }
    try {
      await library.changeQuestionTags({ ids: [question.id] }, on ? { add: [tag.id] } : { remove: [tag.id] })
    } catch (e) {
      toast.error(errorMessage(e))
      return
    }
    logTag(tag, on, 1)
    setItems((prev) =>
      prev.map((q) => {
        if (q.id !== question.id) return q
        const rest = q.tags.filter((t) => t.id !== tag.id)
        return { ...q, tags: on ? [...rest, { id: tag.id, name: tag.name }].sort((a, b) => a.name.localeCompare(b.name, 'zh')) : rest }
      })
    )
    void loadFacets()
    void reloadTags()
  }, [library, loadFacets, reloadTags])
  const rowTagApi = useMemo<RowTagApi>(
    () => ({
      tags,
      onToggle: toggleRowTag,
      onCreate: createTag,
      onManage: () => setManaging('tags'),
      onClosed: () => {
        flushTagLog()
        void refreshAll()
      }
    }),
    [tags, toggleRowTag, createTag, flushTagLog, refreshAll]
  )
  const recentPapers = useMemo(() => livePapers.slice(0, 3), [livePapers])

  // 单题标签小框开着时，那一行被刷新掉（别处删了题、条件变了）：记录跟着作废，免得下次打开混进旧的
  useEffect(() => {
    const log = tagLog.current
    if (log?.single && !items.some((q) => q.id === log.questionId)) tagLog.current = null
  }, [items])

  const groups = useMemo(() => groupTypes(facets, filter.type), [facets, filter.type])
  // 题型默认只列前 8 个大类；选中的大类不在其中时也列出来，始终看得到自己选了什么
  const shownGroups = useMemo(() => {
    if (typesExpanded || groups.length <= TYPE_SHOWN) return groups
    const first = groups.slice(0, TYPE_SHOWN)
    const picked = filter.type ? groups.find((g) => g.primary === primaryQuestionType(filter.type)) : undefined
    return picked && !first.includes(picked) ? [...first, picked] : first
  }, [groups, typesExpanded, filter.type])
  const typeTotal = facets?.types.reduce((sum, t) => sum + t.count, 0) ?? 0
  const selectedPrimary = filter.type ? primaryQuestionType(filter.type) : ''
  const filtered = isFiltered(filter)
  const importRunning = importState.stage === 'starting' || importState.stage === 'running'
  const libraryEmpty = facets !== null && facets.total === 0
  const noAnswerAnywhere = facets !== null && facets.total > 0 && facets.withAnswer === 0
  const sourceTitle = sourcePapers.find((p) => p.id === filter.paperId)?.title ?? ''
  const chapterCounts = useMemo(() => new Map((facets?.chapters ?? []).map((c) => [c.id, c.count])), [facets])
  const tagCounts = useMemo(() => new Map((facets?.tags ?? []).map((t) => [t.id, t.count])), [facets])

  const names = useMemo<FilterNames>(
    () => ({
      chapters: new Map(chapters.map((c) => [c.id, chapterPath(chapters, c.id) ?? c.name])),
      knowledge: new Map((facets?.knowledge ?? []).map((k) => [k.id, k.name])),
      tags: new Map(tags.map((t) => [t.id, t.name])),
      sourceTitle
    }),
    [chapters, facets, tags, sourceTitle]
  )
  const conditions = useMemo(() => filterConditions(filter, names), [filter, names])

  return (
    <div className="lb-page">
      <aside className="lb-filter" aria-label="筛选">
        <div>
          <div className="lb-label">关键词</div>
          <TextInput value={keywordInput} onChange={setKeywordInput} leading={<IconSearch size={16} />} clearable placeholder="题干中的文字" aria-label="关键词" />
        </div>
        {facets && (
          <ChapterFilter chapters={chapters} counts={chapterCounts} selected={filter.chapterIds} onChange={(ids) => libraryFilter.patch({ chapterIds: ids })} onManage={() => setManaging('chapters')} />
        )}
        <div>
          <div className="lb-label">题型</div>
          <ul className="lb-types" aria-label="题型">
            <li>
              <button type="button" className={!filter.type ? 'is-on' : ''} aria-pressed={!filter.type} onClick={() => libraryFilter.patch({ type: '' })}>
                <span>全部题型</span>
                <em>{typeTotal}</em>
              </button>
            </li>
            {shownGroups.map((g) => (
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
          {groups.length > TYPE_SHOWN && (
            <div className="lb-types-foot">
              <Button variant="link" size="sm" aria-expanded={typesExpanded} onClick={() => setTypesExpanded((v) => !v)}>
                {typesExpanded ? '收起' : `展开全部（共 ${groups.length} 个）`}
              </Button>
            </div>
          )}
        </div>
        {facets && <DifficultyFilter items={facets.difficulties} selected={filter.difficulties} filtered={filtered} onChange={(keys) => libraryFilter.patch({ difficulties: keys })} />}
        {facets && <KnowledgeFilter items={facets.knowledge} selected={filter.knowledgeIds} filtered={filtered} onChange={(ids) => libraryFilter.patch({ knowledgeIds: ids })} />}
        {facets && <TagFilter tags={tags} counts={tagCounts} selected={filter.tagIds} onChange={(ids) => libraryFilter.patch({ tagIds: ids })} onManage={() => setManaging('tags')} />}
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
          {conditions.map((c) => (
            <Chip key={c.key} label={c.chip} title={c.chipTitle} onClear={() => libraryFilter.patch(c.clear)} />
          ))}
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
        <div className={`lb-thead${selectedCount > 0 ? ' is-bulk' : ''}`}>
          <Checkbox checked={allLoadedSelected} indeterminate={loadedSelected > 0 && !allLoadedSelected} disabled={items.length === 0} onChange={toggleLoaded} aria-label="选择已显示的全部题目" />
          {selectedCount > 0 ? (
            <SelectionBar
              count={selectedCount}
              total={total}
              all={selection.kind === 'all'}
              unfiltered={!filtered}
              chapters={chapters}
              tags={tags}
              onSelectAll={() => setSelection({ kind: 'all' })}
              onClear={() => setSelection(NO_SELECTION)}
              onAssign={(id) => void requestAssign(id)}
              loadTagStates={loadTagStates}
              onTagChange={changeSelectedTag}
              onCreateTag={createTag}
              onTagsClosed={flushTagLog}
              onManageChapters={() => setManaging('chapters')}
              onManageTags={() => setManaging('tags')}
            />
          ) : (
            <>
              <span aria-hidden="true">题目</span>
              <span aria-hidden="true">来源</span>
              <span aria-hidden="true">操作</span>
            </>
          )}
        </div>
        <div className="lb-list" ref={listRef}>
          {items.map((q, i) => (
            <QuestionRow
              key={q.id}
              index={i + 1}
              question={q}
              selected={isSelected(q.id)}
              onSelect={selectRow}
              chapterLabel={chapterPath(chapters, q.chapterId)}
              tagApi={rowTagApi}
              keyword={filter.keyword}
              markNoAnswer={!noAnswerAnywhere}
              usage={usage[q.id] ?? 0}
              recentPapers={recentPapers}
              adding={addingId === q.id}
              onAdd={addQuestion}
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
              description={conditions.length > 0 ? `当前条件：${conditions.map((c) => c.empty).join('，')}` : undefined}
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
      {assignAsk && (
        <ConfirmDialog
          title={`归到章节「${chapterPath(chapters, assignAsk.chapterId) ?? '所选章节'}」`}
          confirmLabel="移动"
          onClose={() => setAssignAsk(null)}
          onConfirm={() => {
            const ask = assignAsk
            setAssignAsk(null)
            void assign(ask.chapterId)
          }}
        >
          <p>
            所选 {assignAsk.total} 道题里，其中 {assignAsk.moving} 道已在别的章节，将移到「{chapterPath(chapters, assignAsk.chapterId) ?? '所选章节'}」；其余 {assignAsk.total - assignAsk.moving} 道直接归入。未选中的题不受影响。
          </p>
        </ConfirmDialog>
      )}
      {managing === 'chapters' && (
        <ChapterManagerModal
          chapters={chapters}
          onClose={() => setManaging(null)}
          onCreate={async (name, parentId) => {
            await library.createChapter(name, parentId)
            await reloadChapters()
          }}
          onRename={async (id, name) => {
            await library.renameChapter(id, name)
            await refreshAll()
          }}
          onMove={async (id, toIndex) => {
            await library.moveChapter(id, toIndex)
            await reloadChapters()
          }}
          onDelete={async (id) => {
            const name = chapters.find((c) => c.id === id)?.name ?? ''
            const { questions } = await library.deleteChapter(id)
            toast.show(questions > 0 ? `已删除「${name}」，${questions} 道题回到「未归章节」` : `已删除「${name}」`)
            await refreshAll()
          }}
        />
      )}
      {managing === 'tags' && (
        <TagManagerModal
          title="管理标签"
          unit="道题"
          tags={tags}
          onClose={() => setManaging(null)}
          onRename={async (id, name) => {
            const result = await library.renameTag(id, name)
            // 改成已有的名字会合并：筛选里选着被并掉的标签，换成保留下来的那个
            const current = libraryFilter.get().tagIds
            if (result.mergedInto !== null && current.includes(id)) libraryFilter.patch({ tagIds: [...new Set(current.map((t) => (t === id ? result.mergedInto! : t)))] })
            await refreshAll()
            return result
          }}
          onDelete={async (id) => {
            await library.deleteTag(id)
            await refreshAll()
          }}
        />
      )}
    </div>
  )
}

function Chip({ label, title, onClear }: { label: string; title: string; onClear(): void }) {
  return (
    <span className="lb-chip">
      <span className="lb-chip-label" title={title}>
        {label}
      </span>
      <button type="button" aria-label={`清除筛选：${title}`} onClick={onClear}>
        <IconClose size={14} />
      </button>
    </span>
  )
}
