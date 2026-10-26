// 组卷编辑器：左栏试题库，中栏卷面，右栏试卷结构（窗口窄时收成卷面顶部的结构条）；顶部存为版本 / 版本历史 / 下载试卷 / 下载答题卡
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import type { ExportKind, LibraryQuestion, PaperDetail, VersionDetail, VersionSummary } from '@shared/domain'
import { numberItems, numberLabel, sectionHeading, structureOf } from '@shared/numbering'
import type { PaperSaveResult } from '@shared/papers'
import DownloadDialog from '../components/DownloadDialog'
import { appendQuestions, copyFromQuestion } from '@shared/draft'
import {
  addSection,
  clearItemScores,
  insertItem,
  moveItem,
  moveItemBy,
  moveItemToSection,
  moveSection,
  moveSectionTo,
  removeItem,
  removeSection,
  renameSection,
  restoreItem,
  restoreSection,
  setItemScore,
  setSectionScore,
  updateItem,
  type DropMark
} from '../components/editor/draftOps'
import { errorMessage, formatClock } from '../components/editor/format'
import { isBlankHtml, plainText } from '../components/editor/html'
import { IconRedo, IconUndo } from '../components/editor/icons'
import type { ItemOps } from '../components/editor/ItemCard'
import LibraryPane from '../components/editor/LibraryPane'
import PaperPane, { type SectionOps } from '../components/editor/PaperPane'
import { SectionTargets } from '../components/editor/sectionsContext'
import StructureBar from '../components/editor/StructureBar'
import StructurePanel, { type StructureActions } from '../components/editor/StructurePanel'
import { useAutosave } from '../components/editor/useAutosave'
import { useEditorDraft } from '../components/editor/useEditorDraft'
import { useElementWidth } from '../components/editor/useOverflow'
import { IconBack, IconCheck, IconDownload, IconHistory, IconMore, IconSave, IconScissors } from '../icons'
import { Button, CircledNote, ConfirmDialog, IconButton, Menu, Modal, Tag, TextInput, toast, usePersistentState } from '../components/ui'
import { navigateTo } from '../navigation'
import VersionDrawer from '../components/versions/VersionDrawer'
import VersionPreview from '../components/versions/VersionPreview'
import '../components/editor/editor-c.css'
import './EditorPage.css'

interface Props {
  paperId: number
  onBack(): void
}

type ActiveDrag = { kind: 'lib'; question: LibraryQuestion } | { kind: 'item'; itemId: string }

// 窗口（卷面区加结构栏）够宽时才常驻右侧结构栏，否则收成卷面顶部的结构条
const WIDE_MIN = 1360
const DRAWER_COLLAPSE_LIB = 1100 // 版本历史打开后卷面区不足这个宽度，就先把题库栏收起来，让卷面保持完整版面
const TITLE_MAX = 100 // 与保存、导出文件名的上限一致，界面上不能多写出存不下的字
const XL_MIN = 1400 // 再宽一点，题库栏与结构栏各让出几十像素给卷面
// 拖到卷面上下边缘自动滚动：触发区 80px，最快每秒 360px（dnd-kit 自带的最快每秒近 2000px，落点根本没法控制）
const SCROLL_ZONE = 80
const SCROLL_MAX_SPEED = 360

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

// 放置目标按指针当前所在的大题判定。指针位置取自真实的 pointer 事件，位置矩形取实时的元素位置：
// dnd-kit 事件里的 delta 带有滚动补偿、缓存的矩形不随滚动更新，拖动过程中两侧面板都可能滚动，用它们算落点会偏。
function nearestSection(droppableContainers: Parameters<CollisionDetection>[0]['droppableContainers'], pointer: { x: number; y: number }) {
  const pane = document.querySelector('[data-paper-pane]')?.getBoundingClientRect()
  const { x, y } = pointer
  if (!pane || x < pane.left || x > pane.right || y < pane.top || y > pane.bottom) return []
  let best: { distance: number; container: (typeof droppableContainers)[number] } | null = null
  for (const container of droppableContainers) {
    const el = container.node.current
    if (!el || container.disabled) continue
    const r = el.getBoundingClientRect()
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    const distance = Math.hypot(dx, dy)
    if (!best || distance < best.distance) best = { distance, container }
  }
  return best ? [{ id: best.container.id, data: { droppableContainer: best.container, value: best.distance } }] : []
}

// 指针在该大题里的位置：落在第一个「中线在指针下方」的题目之前，没有则放到末尾（拖动中的题不参与）。
// 插入位置那一行（.ed-drop）是真占版面的，在它后面的题要把这一行的高度减回去再比，不然红线一出现，
// 下面的题整体下移，落点就会因为自己的出现而来回跳。
function itemBefore(sectionId: string, pointerY: number, excludeItemId: string | null): string | null {
  const section = document.querySelector(`[data-section-id="${sectionId}"]`)
  const drop = section?.querySelector<HTMLElement>('.ed-drop') ?? null
  for (const el of section?.querySelectorAll<HTMLElement>('[data-item-id]') ?? []) {
    if (el.dataset.itemId === excludeItemId) continue
    const r = el.getBoundingClientRect()
    const shift = drop && drop.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? drop.offsetHeight : 0
    if (pointerY < r.top - shift + r.height / 2) return el.dataset.itemId ?? null
  }
  return null
}

// 焦点在可输入文字的元素里时，Ctrl+Z 等交给浏览器自己的文字撤销
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range'].includes(target.type)
  return false
}

const hasOverlay = (): boolean => document.querySelector('.ui-backdrop, .ui-popover') != null

export default function EditorPage({ paperId, onBack }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadError, setLoadError] = useState('')
  const [title, setTitle] = useState('')
  const titleRef = useRef('') // 最近一次有效（非空）的标题
  const [meta, setMeta] = useState<{ latestVersionNo: number | null; draftDirty: boolean }>({ latestVersionNo: null, draftDirty: true })
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null) // 刚从哪个版本恢复，内容与它相同时不报「有未存改动」
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const editSession = useRef(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [versionsKey, setVersionsKey] = useState(0)
  const [saveDialog, setSaveDialog] = useState(false)
  const [note, setNote] = useState('')
  const [savingVersion, setSavingVersion] = useState(false)
  const [preview, setPreview] = useState<VersionDetail | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloadKind, setDownloadKind] = useState<ExportKind>('paper')
  const [dupDialog, setDupDialog] = useState<{ versionId?: number; title: string } | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [dragging, setDragging] = useState<ActiveDrag | null>(null)
  const [mark, setMark] = useState<DropMark | null>(null)
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null)
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set())
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  // S11、S16：切到别的页面再回来，滚动位置、题库筛选（在题库栏里）、折叠状态都还在
  const [collapsedList, setCollapsedList] = usePersistentState<string[]>(`ewb.editor.collapsed.${paperId}`, [], { validate: isStringArray })
  const [scrollTop, setScrollTop] = usePersistentState<number>(`ewb.editor.scroll.${paperId}`, 0, { validate: isNumber, delay: 300 })
  const [libCollapsed, setLibCollapsed] = usePersistentState<boolean>('ewb.editor.libCollapsed', window.innerWidth < 1200, { validate: isBoolean })
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList])
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const selectedIdRef = useRef<string | null>(null)
  const [libOverride, setLibOverride] = useState<boolean | null>(null) // 版本历史挤占卷面时题库栏自动收起，用户在这期间手动开合以这个为准

  const autosave = useAutosave(paperId, useCallback((r: PaperSaveResult) => setMeta((m) => ({ ...m, draftDirty: r.draftDirty })), []))
  const { schedule, flush, reset } = autosave
  const { draft, draftRef, history, commit, undo, redo, replace, commitTarget } = useEditorDraft(schedule)

  // 鼠标移动一小段就开始拖；触屏要按住一会儿才开始拖，按住之前手指滑动仍是滚动列表
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  )
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const track = (event: MouseEvent | TouchEvent): void => {
      const point = 'touches' in event ? event.touches[0] : event
      if (point) pointer.current = { x: point.clientX, y: point.clientY }
    }
    const events = ['mousemove', 'mousedown', 'touchstart', 'touchmove'] as const
    for (const name of events) window.addEventListener(name, track, { capture: true, passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, track, true)
    }
  }, [])
  const collision = useCallback<CollisionDetection>(({ droppableContainers }) => nearestSection(droppableContainers, pointer.current), [])

  const deskRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const mainWidth = useElementWidth(mainRef, phase)
  const wide = mainWidth >= WIDE_MIN
  const xl = mainWidth >= XL_MIN
  const autoCollapseLib = drawerOpen && mainWidth > 0 && mainWidth < DRAWER_COLLAPSE_LIB
  const libHidden = libOverride ?? (libCollapsed || autoCollapseLib)
  useEffect(() => setLibOverride(null), [drawerOpen])
  const toggleLib = (): void => {
    const next = !libHidden
    if (autoCollapseLib) setLibOverride(next)
    else setLibCollapsed(next)
  }

  // ---------- 载入 ----------
  const applyDetail = useCallback(
    (detail: PaperDetail): void => {
      setTitle(detail.title)
      titleRef.current = detail.title
      replace(detail.draft)
      setMeta({ latestVersionNo: detail.latestVersionNo, draftDirty: detail.draftDirty })
      setRestoredFrom(null)
      editingRef.current = null
      setEditingId(null)
      reset(detail.updatedAt)
    },
    [reset, replace]
  )

  useEffect(() => {
    let alive = true
    window.workbench.papers
      .get(paperId)
      .then((detail) => {
        if (!alive) return
        applyDetail(detail)
        setPhase('ready')
      })
      .catch((e) => {
        if (!alive) return
        setLoadError(errorMessage(e))
        setPhase('failed')
      })
    return () => {
      alive = false
    }
  }, [paperId, applyDetail])

  // 带「撤销 / 重做 / 回到恢复前」的提示条，按钮改的是这个编辑器里的草稿：记下 id，历史一动或离开编辑器时只收掉它们，
  // 别的页面弹出的提示条（比如试卷库里删除试卷的 8 秒撤销）不碰
  const revertToasts = useRef(new Set<number>())
  const sayRevertible = useCallback((text: Parameters<typeof toast.show>[0], options?: Parameters<typeof toast.show>[1]): void => {
    revertToasts.current.add(toast.show(text, options))
  }, [])
  const dropRevertToasts = useCallback((): void => {
    for (const id of revertToasts.current) toast.dismiss(id)
    revertToasts.current.clear()
  }, [])
  useEffect(
    () => () => {
      for (const id of revertToasts.current) toast.dismiss(id)
      window.clearTimeout(flashTimer.current)
      window.clearTimeout(scrollTimer.current)
      window.cancelAnimationFrame(spyFrame.current)
    },
    []
  )

  // S11：第一次出现卷面时回到上次的滚动位置
  const scrollRestored = useRef(false)
  useLayoutEffect(() => {
    if (phase !== 'ready' || scrollRestored.current || !deskRef.current) return
    scrollRestored.current = true
    deskRef.current.scrollTop = scrollTop
    // 只在卷面第一次出现时恢复一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ---------- 派生数据 ----------
  const structure = useMemo(() => structureOf(draft.sections), [draft.sections])
  const numberedList = useMemo(() => numberItems(draft.sections), [draft.sections])
  const numbered = useMemo(() => new Map(numberedList.map((n) => [n.item.id, n])), [numberedList])
  const numberedRef = useRef(numbered)
  numberedRef.current = numbered
  const addedAt = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const n of numberedList) {
      const origin = n.item.originQuestionId
      if (origin != null) map.set(origin, [...(map.get(origin) ?? []), n.firstNo])
    }
    return map
  }, [numberedList])
  const addedAtRef = useRef(addedAt)
  addedAtRef.current = addedAt
  const sectionTargetsKey = draft.sections.map((s) => `${s.id}:${s.title}`).join('|')
  const sectionTargets = useMemo(
    () => draft.sections.map((s, i) => ({ id: s.id, label: sectionHeading(i, s.title || '未命名') })),
    // 只在大题的增删、改名、换序时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionTargetsKey]
  )
  const selectedNos = useMemo(() => {
    const n = selectedId ? numbered.get(selectedId) : undefined
    return n ? Array.from({ length: n.lastNo - n.firstNo + 1 }, (_, k) => n.firstNo + k) : []
  }, [selectedId, numbered])
  const empty = structure.questionCount === 0

  // ---------- 定位与闪烁（F7、S2、结构面板） ----------
  const pendingLocate = useRef<{ kind: 'item' | 'section'; id: string; block: ScrollLogicalPosition } | null>(null)
  const [locateTick, setLocateTick] = useState(0)
  const flashTimer = useRef<number | undefined>(undefined)

  const flash = useCallback((ids: string[]): void => {
    window.clearTimeout(flashTimer.current)
    setFlashIds(new Set(ids))
    flashTimer.current = window.setTimeout(() => setFlashIds(new Set()), 1600)
  }, [])

  const locate = useCallback(
    (kind: 'item' | 'section', id: string, block: ScrollLogicalPosition = 'center'): void => {
      const sectionId = kind === 'section' ? id : draftRef.current.sections.find((s) => s.items.some((i) => i.id === id))?.id
      if (sectionId && collapsedRef.current.has(sectionId) && kind === 'item') setCollapsedList((list) => list.filter((x) => x !== sectionId))
      pendingLocate.current = { kind, id, block }
      if (kind === 'section') setActiveSectionId(id)
      setLocateTick((t) => t + 1)
    },
    [draftRef, setCollapsedList]
  )

  // 内容渲染出来之后再滚：刚加入的题、刚展开的大题此时才在 DOM 里
  useLayoutEffect(() => {
    const target = pendingLocate.current
    const desk = deskRef.current
    if (!target || !desk) return
    pendingLocate.current = null
    const el = desk.querySelector(target.kind === 'item' ? `[data-item-id="${target.id}"]` : `[data-section-id="${target.id}"]`)
    if (!el) return
    el.scrollIntoView({ block: target.block })
    flash([target.id])
  }, [locateTick, draft.sections, collapsedList, flash])

  const locateNo = useCallback(
    (no: number): void => {
      const hit = [...numbered.values()].find((n) => no >= n.firstNo && no <= n.lastNo)
      if (!hit) return
      setSelectedId(hit.item.id)
      locate('item', hit.item.id)
    },
    [numbered, locate]
  )

  // 滚动：记住位置，并算出当前看到的是哪个大题（结构条与结构表高亮）
  const spyFrame = useRef(0)
  const scrollTimer = useRef(0)
  const onDeskScroll = useCallback((): void => {
    const desk = deskRef.current
    if (!desk) return
    // 每个滚动事件都改 state 会让整页跟着重渲，隔一小会儿记一次位置就够
    if (!scrollTimer.current) {
      scrollTimer.current = window.setTimeout(() => {
        scrollTimer.current = 0
        if (deskRef.current) setScrollTop(deskRef.current.scrollTop)
      }, 150)
    }
    window.cancelAnimationFrame(spyFrame.current)
    spyFrame.current = window.requestAnimationFrame(() => {
      const top = desk.getBoundingClientRect().top + 72
      const sections = [...desk.querySelectorAll<HTMLElement>('[data-section-id]')]
      let current: string | null = null
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= top) current = el.dataset.sectionId ?? null
        else break
      }
      // 滚到底时最后一个大题的头永远升不到上缘，直接算它
      if (sections.length > 0 && desk.scrollTop > 0 && desk.scrollTop + desk.clientHeight >= desk.scrollHeight - 2) current = sections[sections.length - 1].dataset.sectionId ?? current
      setActiveSectionId((prev) => (prev === current ? prev : current))
    })
  }, [setScrollTop])
  useEffect(() => {
    if (phase === 'ready') onDeskScroll()
  }, [phase, draft.sections.length, onDeskScroll])
  const activeSection = activeSectionId && draft.sections.some((s) => s.id === activeSectionId) ? activeSectionId : (draft.sections[0]?.id ?? null)

  // ---------- 对草稿的修改 ----------
  const finishEditing = useCallback(
    (itemId: string): void => {
      // 答案清空后恢复成「没有答案」，避免留下空白答案块
      const item = draftRef.current.sections.flatMap((s) => s.items).find((i) => i.id === itemId)
      if (item?.answerHtml != null && isBlankHtml(item.answerHtml)) commit((d) => updateItem(d, itemId, { answerHtml: null }), { label: '修改题目', merge: `edit:${itemId}:${editSession.current}`, mergeMs: Infinity })
    },
    [commit, draftRef]
  )

  const itemOps = useMemo<ItemOps>(() => {
    const stopEditing = (): void => {
      const current = editingRef.current
      if (current) finishEditing(current)
      editingRef.current = null
      setEditingId(null)
    }
    const startEditing = (itemId: string): void => {
      const current = editingRef.current
      if (current && current !== itemId) finishEditing(current)
      editSession.current += 1
      editingRef.current = itemId
      setEditingId(itemId)
    }
    return {
      select: (itemId) => setSelectedId(itemId),
      beginEdit: (itemId) => {
        if (editingRef.current !== itemId) startEditing(itemId)
      },
      toggleEdit: (itemId) => {
        if (editingRef.current === itemId) stopEditing()
        else startEditing(itemId)
      },
      change: (itemId, patch) => commit((d) => updateItem(d, itemId, patch), { label: '修改题目', merge: `edit:${itemId}:${editSession.current}`, mergeMs: Infinity }),
      setScore: (itemId, score) => commit((d) => setItemScore(d, itemId, score), { label: '修改分值', merge: `score:${itemId}` }),
      remove: (itemId) => {
        const n = numberedRef.current.get(itemId)
        const { draft: next, removed } = removeItem(draftRef.current, itemId)
        if (!removed) return
        if (editingRef.current === itemId) {
          editingRef.current = null
          setEditingId(null)
        }
        if (selectedIdRef.current === itemId) setSelectedId(null)
        const no = n ? numberLabel(n) : ''
        const brief = plainText(removed.item.stemHtml, 10)
        commit(() => next, { label: `删除第 ${no} 题` })
        sayRevertible((count) => (count > 1 ? `已删除 ${count} 题` : `已删除第 ${no} 题「${brief}」`), {
          group: 'delete-item',
          ms: 8000,
          action: { label: (count) => (count > 1 ? '撤销全部' : '撤销'), run: () => commit((d) => restoreItem(d, removed), { label: '撤销删除' }) }
        })
      },
      moveBy: (itemId, delta) => {
        if (commit((d) => moveItemBy(d, itemId, delta), { label: `${delta < 0 ? '上移' : '下移'}题目` })) locate('item', itemId, 'nearest')
      },
      moveTo: (itemId, sectionId) => {
        if (commit((d) => moveItemToSection(d, itemId, sectionId), { label: '移到其他大题' })) locate('item', itemId, 'nearest')
      },
      error: (message) => toast.error(message)
    }
    // selectedIdRef 是 ref，稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, finishEditing, draftRef, locate])
  selectedIdRef.current = selectedId

  const sectionOps = useMemo<SectionOps>(
    () => ({
      rename: (sectionId, value) => commit((d) => renameSection(d, sectionId, value), { label: '修改大题名', merge: `rename:${sectionId}` }),
      setScore: (sectionId, score) => commit((d) => setSectionScore(d, sectionId, score), { label: '修改每小题分值', merge: `section-score:${sectionId}` }),
      move: (sectionId, delta) => {
        if (commit((d) => moveSection(d, sectionId, delta), { label: '调整大题顺序' })) locate('section', sectionId, 'nearest')
      },
      remove: (sectionId) => {
        const { draft: next, removed } = removeSection(draftRef.current, sectionId)
        if (!removed) return
        if (removed.section.items.some((i) => i.id === editingRef.current)) {
          editingRef.current = null
          setEditingId(null)
        }
        if (removed.section.items.some((i) => i.id === selectedIdRef.current)) setSelectedId(null)
        commit(() => next, { label: `删除大题「${removed.section.title || '未命名'}」` })
        const count = removed.section.items.length
        const name = removed.section.title || '未命名大题'
        sayRevertible(count > 0 ? `已删除「${name}」及 ${count} 道题` : `已删除空大题「${name}」`, {
          ms: 8000,
          action: { label: '撤销', run: () => commit((d) => restoreSection(d, removed), { label: '撤销删除大题' }) }
        })
      },
      toggleFold: (sectionId) => setCollapsedList((list) => (list.includes(sectionId) ? list.filter((x) => x !== sectionId) : [...list, sectionId]))
    }),
    [commit, draftRef, locate, setCollapsedList]
  )

  const onAddSection = useCallback(
    (name?: string): void => {
      let createdId = ''
      commit(
        (d) => {
          const next = addSection(d, name ?? '新大题')
          createdId = next.sections[next.sections.length - 1].id
          return next
        },
        { label: '新建大题' }
      )
      if (name == null) setFocusSectionId(createdId)
      locate('section', createdId, 'nearest')
    },
    [commit, locate]
  )

  // M2：「加入试卷」按钮与批量加入。落点按题型匹配大题，匹配不到新建
  const addQuestions = useCallback(
    (questions: LibraryQuestion[]): void => {
      if (questions.length === 0) return
      const duplicated = questions.map((q) => addedAtRef.current.get(q.id)).filter((nos): nos is number[] => nos != null)
      const beforeSections = new Set(draftRef.current.sections.map((s) => s.id))
      let placedIds: string[] = []
      let createdSections: string[] = []
      commit(
        (d) => {
          const result = appendQuestions(d, questions)
          placedIds = result.placed.map((p) => p.itemId)
          createdSections = [...new Set(result.placed.map((p) => p.sectionId).filter((id) => !beforeSections.has(id)))]
          return { ...d, sections: result.draft.sections }
        },
        { label: questions.length > 1 ? `加入 ${questions.length} 道题` : '加入题目' }
      )
      locate('item', placedIds[0])
      flash(placedIds)
      const undoAdd = (): void => {
        commit(
          (d) => {
            let next = placedIds.reduce((acc, id) => removeItem(acc, id).draft, d)
            for (const id of createdSections) {
              const section = next.sections.find((s) => s.id === id)
              if (section && section.items.length === 0) next = removeSection(next, id).draft
            }
            return next
          },
          { label: '撤销加入' }
        )
      }
      if (duplicated.length > 0) {
        const where = [...new Set(duplicated.flat())].slice(0, 6).join('、')
        sayRevertible(questions.length === 1 ? `该题已在第 ${where} 题，已再加入一次` : `已加入 ${questions.length} 道题，其中 ${duplicated.length} 道此前已在试卷里（第 ${where} 题）`, {
          ms: 8000,
          action: { label: '撤销', run: undoAdd }
        })
      } else if (questions.length > 1) {
        sayRevertible(`已加入 ${questions.length} 道题`, { ms: 8000, action: { label: '撤销', run: undoAdd } })
      }
    },
    [commit, draftRef, locate, flash]
  )

  const structureActions = useMemo<StructureActions>(
    () => ({
      locateSection: (id) => locate('section', id, 'start'),
      locateNo,
      setSectionScore: sectionOps.setScore,
      setItemScore: itemOps.setScore,
      clearItemScores: (sectionId) => void commit((d) => clearItemScores(d, sectionId), { label: '统一分值' }),
      reorderSection: (sectionId, toIndex) => void commit((d) => moveSectionTo(d, sectionId, toIndex), { label: '调整大题顺序' }),
      setTarget: commitTarget,
      addSection: onAddSection,
      foldAll: () => setCollapsedList(draftRef.current.sections.map((s) => s.id)),
      unfoldAll: () => setCollapsedList([])
    }),
    [locate, locateNo, sectionOps.setScore, itemOps.setScore, commit, commitTarget, onAddSection, setCollapsedList, draftRef]
  )

  // ---------- 撤销 / 重做（F1）与快捷键（S5） ----------
  const doUndo = useCallback((): void => {
    if (editingRef.current) {
      finishEditing(editingRef.current)
      editingRef.current = null
      setEditingId(null)
    }
    // 历史动了，之前「已删除 · 撤销」这类提示条里的动作就过期了
    dropRevertToasts()
    const label = undo()
    if (label)
      sayRevertible(`已撤销：${label}`, {
        group: 'history',
        ms: 2500,
        action: {
          label: '重做',
          run: () => {
            dropRevertToasts()
            void redo()
          }
        }
      })
  }, [undo, redo, finishEditing, dropRevertToasts, sayRevertible])
  const doRedo = useCallback((): void => {
    if (editingRef.current) {
      editingRef.current = null
      setEditingId(null)
    }
    dropRevertToasts()
    const label = redo()
    if (label) sayRevertible(`已重做：${label}`, { group: 'history', ms: 2500 })
  }, [redo, dropRevertToasts, sayRevertible])

  const openSaveDialog = useCallback((): void => {
    if (!empty) setSaveDialog(true)
  }, [empty])

  const draggingRef = useRef(false)
  draggingRef.current = dragging != null
  const keyState = useRef({ doUndo, doRedo, openSaveDialog, itemOps })
  keyState.current = { doUndo, doRedo, openSaveDialog, itemOps }
  useEffect(() => {
    if (phase !== 'ready') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const { doUndo: undoNow, doRedo: redoNow, openSaveDialog: openSave, itemOps: ops } = keyState.current
      if (mod && key === 's') {
        event.preventDefault()
        if (!hasOverlay()) openSave()
        return
      }
      if (mod && (key === 'z' || key === 'y') && !isTextEntry(event.target) && !hasOverlay() && !draggingRef.current) {
        event.preventDefault()
        if (key === 'y' || event.shiftKey) redoNow()
        else undoNow()
        return
      }
      if (event.key === 'Enter' && mod && editingRef.current) {
        event.preventDefault()
        ops.toggleEdit(editingRef.current)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return
      }
      if (event.key === 'Escape' && editingRef.current && !hasOverlay()) {
        ops.toggleEdit(editingRef.current)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !hasOverlay()) {
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-item-id]')?.dataset.itemId : undefined
        const target = focused ?? selectedIdRef.current
        if (!target) return
        event.preventDefault()
        ops.moveBy(target, event.key === 'ArrowUp' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase])

  // ---------- 标题 ----------
  const onTitleChange = (value: string): void => {
    setTitle(value)
    if (value.trim()) {
      titleRef.current = value
      schedule({ title: value })
      setRestoredFrom(null)
    }
  }

  // ---------- 拖拽 ----------
  const markOf = (event: DragMoveEvent | DragEndEvent): DropMark | null => {
    const over = event.over?.data.current as { kind?: string; sectionId?: string } | undefined
    if (over?.kind === 'new-section') return { sectionId: null, beforeItemId: null }
    if (over?.kind !== 'section' || !over.sectionId) return null
    const activeData = event.active.data.current as { kind?: string; itemId?: string } | undefined
    return { sectionId: over.sectionId, beforeItemId: itemBefore(over.sectionId, pointer.current.y, activeData?.kind === 'item' ? (activeData.itemId ?? null) : null) }
  }

  const onDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current as { kind: 'lib'; question: LibraryQuestion } | { kind: 'item'; itemId: string }
    setDragging(data.kind === 'lib' ? { kind: 'lib', question: data.question } : { kind: 'item', itemId: data.itemId })
  }

  const onDragMove = (event: DragMoveEvent): void => {
    const next = markOf(event)
    setMark((prev) => (prev?.sectionId === next?.sectionId && prev?.beforeItemId === next?.beforeItemId ? prev : next))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const target = markOf(event)
    const data = event.active.data.current as { kind: 'lib'; question: LibraryQuestion } | { kind: 'item'; itemId: string }
    setDragging(null)
    setMark(null)
    if (!target) return
    if (data.kind === 'lib') {
      const item = copyFromQuestion(data.question)
      const dupNos = addedAtRef.current.get(data.question.id)
      commit((d) => insertItem(d, target, item), { label: '加入题目' })
      locate('item', item.id, 'nearest')
      if (dupNos) sayRevertible(`该题已在第 ${dupNos.join('、')} 题，已再加入一次`, { ms: 8000, action: { label: '撤销', run: () => commit((d) => removeItem(d, item.id).draft, { label: '撤销加入' }) } })
    } else {
      if (commit((d) => moveItem(d, data.itemId, target), { label: '调整题目顺序' })) flash([data.itemId])
    }
  }

  const onDragCancel = (): void => {
    setDragging(null)
    setMark(null)
  }

  // 拖到卷面上下边缘时自动滚动：自己做，限速并收窄触发区
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    let last = performance.now()
    let carry = 0
    const tick = (now: number): void => {
      const dt = Math.min(now - last, 50)
      last = now
      const desk = deskRef.current
      if (desk) {
        const rect = desk.getBoundingClientRect()
        const { x, y } = pointer.current
        let ratio = 0
        if (x >= rect.left && x <= rect.right) {
          if (y > rect.bottom - SCROLL_ZONE) ratio = Math.min(1, (y - (rect.bottom - SCROLL_ZONE)) / SCROLL_ZONE)
          else if (y < rect.top + SCROLL_ZONE) ratio = -Math.min(1, (rect.top + SCROLL_ZONE - y) / SCROLL_ZONE)
        }
        if (ratio !== 0) {
          carry += (ratio * SCROLL_MAX_SPEED * dt) / 1000
          const step = Math.trunc(carry)
          if (step !== 0) {
            carry -= step
            desk.scrollTop += step
          }
        } else carry = 0
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [dragging])

  const dropInfo = useMemo(() => {
    if (!dragging || !mark) return null
    const probeId = '__drag__'
    const simulated =
      dragging.kind === 'lib' ? insertItem(draft, mark, { ...copyFromQuestion(dragging.question), id: probeId }) : moveItem(draft, dragging.itemId, mark)
    const n = numberItems(simulated.sections).find((x) => x.item.id === (dragging.kind === 'lib' ? probeId : dragging.itemId))
    if (!n) return null
    const section = simulated.sections[n.sectionIndex]
    return { label: numberLabel(n), heading: sectionHeading(n.sectionIndex, section.title || '未命名'), newSection: mark.sectionId === null }
  }, [dragging, mark, draft])

  // ---------- 版本 ----------
  const refreshMeta = useCallback(async (): Promise<void> => {
    const detail = await window.workbench.papers.get(paperId)
    setMeta({ latestVersionNo: detail.latestVersionNo, draftDirty: detail.draftDirty })
    setVersionsKey((k) => k + 1)
  }, [paperId])

  const flushOrWarn = async (): Promise<boolean> => {
    try {
      await flush()
      return true
    } catch (e) {
      toast.error(`草稿保存失败：${errorMessage(e)}`)
      return false
    }
  }

  const saveVersion = async (): Promise<void> => {
    setSavingVersion(true)
    try {
      if (!(await flushOrWarn())) return
      const version = await window.workbench.papers.saveVersion(paperId, note)
      setMeta({ latestVersionNo: version.versionNo, draftDirty: false })
      setRestoredFrom(null)
      setVersionsKey((k) => k + 1)
      setSaveDialog(false)
      setNote('')
      toast.show(`已存为 v${version.versionNo}`)
    } catch (e) {
      toast.error(`存为版本失败：${errorMessage(e)}`)
    } finally {
      setSavingVersion(false)
    }
  }

  const viewVersion = async (version: VersionSummary): Promise<void> => {
    try {
      setPreview(await window.workbench.papers.getVersion(version.id))
    } catch (e) {
      toast.error(`无法读取 v${version.versionNo}：${errorMessage(e)}`)
    }
  }

  const restore = async (): Promise<void> => {
    const target = restoreTarget
    if (!target) return
    setRestoring(true)
    try {
      if (!(await flushOrWarn())) return
      const before = { title: titleRef.current, draft: draftRef.current }
      const detail = await window.workbench.papers.restoreVersion(paperId, target.id)
      setTitle(detail.title)
      titleRef.current = detail.title
      replace(detail.draft, { label: `恢复 v${target.versionNo}` })
      editingRef.current = null
      setEditingId(null)
      setMeta({ latestVersionNo: detail.latestVersionNo, draftDirty: detail.draftDirty })
      setRestoredFrom(target.versionNo)
      reset(detail.updatedAt)
      setVersionsKey((k) => k + 1)
      setRestoreTarget(null)
      // S6：恢复前的内容还在内存里，一键回去；草稿有未存改动时服务端另外存了一份「恢复前自动保存」的版本
      dropRevertToasts()
      sayRevertible(`已恢复 v${target.versionNo} 的内容`, {
        ms: 10000,
        action: {
          label: '回到恢复前',
          run: () => {
            setTitle(before.title)
            titleRef.current = before.title
            schedule({ title: before.title })
            commit(() => ({ ...draftRef.current, sections: before.draft.sections }), { label: '回到恢复前' })
            setRestoredFrom(null)
          }
        }
      })
    } catch (e) {
      toast.error(`恢复失败：${errorMessage(e)}`)
    } finally {
      setRestoring(false)
    }
  }

  const startDownload = async (kind: ExportKind): Promise<void> => {
    // 下载读的是数据库里的草稿，先把还没写入的改动写进去
    if (await flushOrWarn()) {
      setDownloadKind(kind)
      setDownloadOpen(true)
    }
  }

  const duplicate = async (): Promise<void> => {
    if (!dupDialog) return
    setDuplicating(true)
    try {
      if (!(await flushOrWarn())) return
      const newId = await window.workbench.papers.duplicate(paperId, { versionId: dupDialog.versionId, title: dupDialog.title })
      setDupDialog(null)
      toast.show('已另存为新试卷', { ms: 10000, action: { label: '打开新试卷', run: () => navigateTo('papers', { paperId: newId }) } })
    } catch (e) {
      toast.error(`另存失败：${errorMessage(e)}`)
    } finally {
      setDuplicating(false)
    }
  }

  const leave = async (): Promise<void> => {
    if (await flushOrWarn()) onBack()
  }

  if (phase === 'loading') return <div className="ed-state">读取试卷中…</div>
  if (phase === 'failed')
    return (
      <div className="ed-state">
        <p>{loadError}</p>
        <Button onClick={onBack}>返回试卷库</Button>
      </div>
    )

  const { state: saveState, savedAt, error: saveError } = autosave.status
  const pendingSave = saveState === 'pending' || saveState === 'saving'
  const dirty = (meta.draftDirty && restoredFrom == null) || pendingSave
  const blankDraft = empty && meta.latestVersionNo == null && !pendingSave // 新建的空白试卷，没有什么可存的
  const emptyReason = '试卷里还没有题目，先从左边的试题库加入题目'
  const draggingItemId = dragging?.kind === 'item' ? dragging.itemId : null
  const draggingLibId = dragging?.kind === 'lib' ? dragging.question.id : null

  const panel = (variant: 'pane' | 'popover', onAfterJump?: () => void) => (
    <StructurePanel
      variant={variant}
      sections={draft.sections}
      structure={structure}
      numbered={numbered}
      activeSectionId={activeSection}
      selectedNos={selectedNos}
      targetScore={draft.targetScore ?? null}
      actions={structureActions}
      onAfterJump={onAfterJump}
    />
  )

  const dragStripTarget = dropInfo
    ? dropInfo.newSection
      ? `松开新建大题「${dropInfo.heading.replace(/^.、/, '')}」，成为第 ${dropInfo.label} 题`
      : `松开放进「${dropInfo.heading}」，成为第 ${dropInfo.label} 题`
    : null
  const draggedItem = dragging?.kind === 'item' ? draft.sections.flatMap((s) => s.items).find((i) => i.id === dragging.itemId) : undefined

  return (
    <div className="ed" data-testid="editor">
      <header className="ed-bar">
        <button type="button" className="bar-back" onClick={() => void leave()}>
          <IconBack size={16} />
          试卷库
        </button>
        <span className="ed-slash" aria-hidden="true">
          /
        </span>
        <TextInput
          className="ed-title"
          variant="underline"
          aria-label="试卷标题"
          maxLength={TITLE_MAX}
          value={title}
          onChange={onTitleChange}
          onBlur={() => {
            if (!title.trim()) setTitle(titleRef.current)
          }}
        />
        <div className="ed-status">
          {saveState === 'error' ? (
            <button type="button" className="ed-saved is-error" data-save-state="error" title={saveError ?? ''} onClick={() => void flush().catch(() => undefined)}>
              保存失败，点击重试
            </button>
          ) : (
            <span className="ed-saved" data-testid="save-state" data-save-state={saveState}>
              {saveState === 'saved' ? (
                <>
                  <IconCheck size={15} />
                  草稿已保存<span className="ed-saved-time">{savedAt ? ` ${formatClock(savedAt).slice(0, 5)}` : ''}</span>
                </>
              ) : (
                '保存中…'
              )}
            </span>
          )}
          {dirty && !blankDraft ? (
            <CircledNote data-testid="dirty-tag">{meta.latestVersionNo == null ? '未存为版本' : '有改动未存为版本'}</CircledNote>
          ) : (
            !dirty && (
              <span className="ed-clean" data-testid="clean-tag">
                {restoredFrom != null ? `内容同 v${restoredFrom}` : `与 v${meta.latestVersionNo} 一致`}
              </span>
            )
          )}
          {empty && <span className="ed-hint">添加题目后才能存版本、下载</span>}
        </div>
        <span className="ed-grow" />
        <div className="ed-tools">
          <span className="ed-tools ed-undo-redo">
            <IconButton label={history.undoLabel ? `撤销：${history.undoLabel}（Ctrl+Z）` : '撤销（Ctrl+Z）'} icon={<IconUndo />} disabled={history.undoCount === 0} onClick={doUndo} data-testid="undo" />
            <IconButton label={history.redoLabel ? `重做：${history.redoLabel}（Ctrl+Shift+Z）` : '重做（Ctrl+Shift+Z）'} icon={<IconRedo />} disabled={history.redoCount === 0} onClick={doRedo} data-testid="redo" />
          </span>
          <Button icon={<IconSave size={16} />} dot={dirty && !empty ? '有改动未存为版本' : false} disabled={empty} title={empty ? emptyReason : '存为版本（Ctrl+S）'} onClick={openSaveDialog}>
            存为版本
          </Button>
          <Button className="ed-tool-history" icon={<IconHistory size={16} />} aria-pressed={drawerOpen} title="版本历史" onClick={() => setDrawerOpen((v) => !v)}>
            版本历史
          </Button>
          <Button variant="primary" icon={<IconDownload size={16} />} disabled={empty} title={empty ? emptyReason : '下载试卷'} onClick={() => void startDownload('paper')}>
            下载试卷
          </Button>
          <Button icon={<IconDownload size={16} />} disabled={empty} title={empty ? emptyReason : '下载答题卡'} onClick={() => void startDownload('answer-sheet')}>
            下载答题卡
          </Button>
          <Menu
            align="end"
            label="更多操作"
            trigger={<IconButton label="更多操作" icon={<IconMore size={16} />} variant="default" data-testid="bar-more" />}
            items={[{ label: '另存为新试卷…', disabled: empty, onSelect: () => setDupDialog({ title: `${titleRef.current}（副本）` }) }]}
          />
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
        <div className="ed-body">
          <div ref={mainRef} className={`ed-main${wide ? ' is-wide' : ''}${xl ? ' is-xl' : ''}${restoring ? ' is-busy' : ''}`}>
            <LibraryPane paperId={paperId} addedAt={addedAt} draggingId={draggingLibId} collapsed={libHidden} onToggleCollapsed={toggleLib} onAdd={addQuestions} />
            <div className="ed-center">
              {!wide && (
                <StructureBar
                  structure={structure}
                  activeSectionId={activeSection}
                  onLocateSection={(id) => locate('section', id, 'start')}
                  renderPanel={(close) => panel('popover', close)}
                />
              )}
              <SectionTargets.Provider value={sectionTargets}>
                <PaperPane
                  title={title.trim() ? title : titleRef.current}
                  sections={draft.sections}
                  structure={structure}
                  numbered={numbered}
                  mark={mark}
                  dropHint={dropInfo ? `插入为第 ${dropInfo.label} 题` : ''}
                  draggingItemId={draggingItemId}
                  selectedId={selectedId}
                  editingId={editingId}
                  collapsed={collapsed}
                  flashIds={flashIds}
                  itemOps={itemOps}
                  sectionOps={sectionOps}
                  focusSectionId={focusSectionId}
                  scrollRef={deskRef}
                  onScroll={onDeskScroll}
                  onAddSection={onAddSection}
                />
              </SectionTargets.Provider>
            </div>
            {wide && (
              <aside className="ed-struct" aria-label="试卷结构">
                {panel('pane')}
              </aside>
            )}
          </div>
          {drawerOpen && (
            <VersionDrawer
              paperId={paperId}
              reloadKey={versionsKey}
              onView={(v) => void viewVersion(v)}
              onRestore={setRestoreTarget}
              onDuplicate={(v) => setDupDialog({ versionId: v.id, title: `${titleRef.current}（v${v.versionNo} 副本）` })}
              onClose={() => setDrawerOpen(false)}
              onVersionsChanged={() => void refreshMeta().catch(() => undefined)}
            />
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="ed-strip" data-testid="drag-strip">
              <span className="ed-strip-cut">
                <IconScissors size={16} />
              </span>
              <div className="ed-strip-head">
                {dragging.kind === 'lib' ? (
                  <>
                    <Tag>{dragging.question.questionType || '未分类'}</Tag>
                    {dragging.question.numberCount > 1 && <span>{dragging.question.numberCount} 个小题</span>}
                  </>
                ) : (
                  <Tag>
                    第 {numbered.get(dragging.itemId) ? numberLabel(numbered.get(dragging.itemId)!) : ''} 题 · {draggedItem?.questionType || '未分类'}
                  </Tag>
                )}
              </div>
              <div className="ed-strip-txt">{plainText(dragging.kind === 'lib' ? dragging.question.stemHtml : (draggedItem?.stemHtml ?? ''), 56)}</div>
              <div className={`ed-strip-to${dragStripTarget ? '' : ' is-none'}`}>{dragStripTarget ?? '拖到卷面上，松开加入'}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Modal
        open={saveDialog}
        title="存为版本"
        size="sm"
        onClose={() => setSaveDialog(false)}
        locked={savingVersion}
        footer={
          <>
            <Button onClick={() => setSaveDialog(false)}>取消</Button>
            <Button variant="primary" disabled={savingVersion} onClick={() => void saveVersion()}>
              存为 v{(meta.latestVersionNo ?? 0) + 1}
            </Button>
          </>
        }
      >
        <label className="ed-field">
          <span className="ed-field-label">版本说明（可选）</span>
          <TextInput
            data-autofocus=""
            aria-label="版本说明"
            value={note}
            maxLength={100}
            placeholder="例如：按期中范围调整了第 3 大题"
            onChange={setNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !savingVersion) void saveVersion()
            }}
          />
        </label>
        <p className="ed-field-hint">
          当前 {structure.questionCount} 题{structure.totalScore != null ? `，${structure.allScored ? '满分' : '已设分'} ${structure.totalScore} 分` : ''}。
          {!dirty && meta.latestVersionNo != null ? `与 v${meta.latestVersionNo} 内容相同，仍会生成新的版本。` : ''}
        </p>
      </Modal>

      {preview && (
        <VersionPreview
          version={preview}
          onClose={() => setPreview(null)}
          onRestore={() => {
            setRestoreTarget(preview)
            setPreview(null)
          }}
        />
      )}

      <ConfirmDialog
        open={restoreTarget != null}
        title={restoreTarget ? `恢复到 v${restoreTarget.versionNo}` : ''}
        confirmLabel={restoreTarget ? `恢复到 v${restoreTarget.versionNo}` : '恢复'}
        busy={restoring}
        onConfirm={() => void restore()}
        onClose={() => setRestoreTarget(null)}
      >
        {restoreTarget && (
          <>
            <p>将用 v{restoreTarget.versionNo} 的内容覆盖当前草稿，已有的版本都不会改动。</p>
            <p>
              {dirty
                ? `当前草稿有未存为版本的改动，恢复前会先自动存为 v${(meta.latestVersionNo ?? 0) + 1}（恢复 v${restoreTarget.versionNo} 前自动保存）。`
                : '当前草稿没有未存的改动，不会额外生成版本。'}
            </p>
          </>
        )}
      </ConfirmDialog>

      <Modal
        open={dupDialog != null}
        title="另存为新试卷"
        size="sm"
        locked={duplicating}
        onClose={() => setDupDialog(null)}
        footer={
          <>
            <Button onClick={() => setDupDialog(null)} disabled={duplicating}>
              取消
            </Button>
            <Button variant="primary" disabled={duplicating || !dupDialog?.title.trim()} onClick={() => void duplicate()}>
              另存
            </Button>
          </>
        }
      >
        <label className="ed-field">
          <span className="ed-field-label">新试卷标题</span>
          <TextInput
            data-autofocus=""
            aria-label="新试卷标题"
            value={dupDialog?.title ?? ''}
            maxLength={100}
            onChange={(v) => setDupDialog((d) => (d ? { ...d, title: v } : d))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !duplicating && dupDialog?.title.trim()) void duplicate()
            }}
          />
        </label>
        <p className="ed-field-hint">
          {dupDialog?.versionId != null ? '复制这个历史版本的内容' : '复制当前草稿的内容'}为一份新试卷，新试卷没有版本记录，当前这份不受影响。用来出 B 卷或补考卷。
        </p>
      </Modal>

      <DownloadDialog
        paperId={paperId}
        open={downloadOpen}
        initialKind={downloadKind}
        onClose={() => setDownloadOpen(false)}
        onExported={() => {
          void refreshMeta().catch(() => undefined)
        }}
        onLocate={(no) => {
          setDownloadOpen(false)
          locateNo(no)
        }}
      />
    </div>
  )
}
