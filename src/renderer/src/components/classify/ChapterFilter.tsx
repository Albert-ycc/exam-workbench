// 试题库「章节」筛选：老师自建的两级目录（章、节），多选，点一下切换。
//
// <ChapterFilter chapters={chapters} counts={new Map(facets.chapters.map((c) => [c.id, c.count]))}
//   selected={filter.chapterIds} onChange={(ids) => patch({ chapterIds: ids })} onManage={openChapterManager} />
//
// - 最上面一项「未归章节」（id 为 NO_CHAPTER）；选章包含其下各节，所以选中章与选中它的节可以同时存在。
// - 题数取自 counts（来自 facets.chapters，没有的当 0）：当前条件下为 0 的照样列出但变淡，老师建的目录不因筛选消失。
// - 章默认收起；已选中节的章默认展开，之后选中的节（包括外部改了 selected，如恢复上次的筛选）也会把它的章展开，手动收起的不会被强行再展开。
// - 章节树不设内部滚动框（嵌套滚动难操作）：左栏、编辑器弹层都由外层整体滚动。
// - compact：编辑器题库栏「更多筛选」弹层里用（宽约 320px），行更矮。
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NO_CHAPTER, type Chapter } from '@shared/classify'
import { IconChevronDown, IconForward } from '../../icons'
import { Button } from '../ui'
import { FilterBlock, FilterRow, toggleIn } from './FilterBlock'

export interface ChapterFilterProps {
  /** 目录结构，已按顺序：章在前、节紧跟其章 */
  chapters: Chapter[]
  /** 章节 id → 当前条件下的题数（章含其下各节），含 NO_CHAPTER */
  counts: ReadonlyMap<number, number>
  selected: readonly number[]
  onChange(next: number[]): void
  /** 「管理章节」入口；没有章节时也靠它去建 */
  onManage?(): void
  compact?: boolean
}

export function ChapterFilter({ chapters, counts, selected, onChange, onManage, compact }: ChapterFilterProps) {
  const tops = useMemo(() => chapters.filter((c) => c.parentId === null), [chapters])
  const childrenOf = useMemo(() => {
    const map = new Map<number, Chapter[]>()
    for (const c of chapters) if (c.parentId !== null) map.set(c.parentId, [...(map.get(c.parentId) ?? []), c])
    return map
  }, [chapters])
  const parentOf = useMemo(() => new Map(chapters.filter((c) => c.parentId !== null).map((c) => [c.id, c.parentId as number])), [chapters])

  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  // 已经为哪些选中的节展开过它的章：节取消选中后再选中，会再展开一次；目录晚于 selected 到达时也能补展开
  const expandedFor = useRef(new Set<number>())
  useLayoutEffect(() => {
    const now = new Set(selected)
    for (const id of expandedFor.current) if (!now.has(id)) expandedFor.current.delete(id)
    const parents: number[] = []
    for (const id of selected) {
      const parent = parentOf.get(id)
      if (parent !== undefined && !expandedFor.current.has(id)) {
        expandedFor.current.add(id)
        parents.push(parent)
      }
    }
    if (parents.length) setOpen((prev) => new Set([...prev, ...parents]))
  }, [selected, parentOf])

  const toggleOpen = (id: number): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const pick = (id: number): void => onChange(toggleIn(selected, id))
  const count = (id: number): number => counts.get(id) ?? 0

  return (
    <FilterBlock
      title="章节"
      compact={compact}
      selectedCount={selected.length}
      onClear={() => onChange([])}
      foot={
        onManage && (
          <Button variant="link" size="sm" onClick={onManage}>
            管理章节
          </Button>
        )
      }
    >
      {tops.length === 0 ? (
        <p className="cf-note">还没有章节</p>
      ) : (
        <div>
          <ul className="cf-list" aria-label="章节">
            <li>
              <FilterRow name="未归章节" count={count(NO_CHAPTER)} on={selected.includes(NO_CHAPTER)} lead={<span className="cf-caret-gap" />} onClick={() => pick(NO_CHAPTER)} />
            </li>
            {tops.map((chapter) => {
              const sections = childrenOf.get(chapter.id) ?? []
              const expanded = open.has(chapter.id)
              return (
                <li key={chapter.id}>
                  <FilterRow
                    name={chapter.name}
                    count={count(chapter.id)}
                    on={selected.includes(chapter.id)}
                    lead={
                      sections.length > 0 ? (
                        <button type="button" className="cf-caret" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${chapter.name}`} onClick={() => toggleOpen(chapter.id)}>
                          {expanded ? <IconChevronDown size={14} /> : <IconForward size={14} />}
                        </button>
                      ) : (
                        <span className="cf-caret-gap" />
                      )
                    }
                    onClick={() => pick(chapter.id)}
                  />
                  {expanded && sections.length > 0 && (
                    <ul className="cf-list cf-sub" aria-label={`${chapter.name}的节`}>
                      {sections.map((section) => (
                        <li key={section.id}>
                          <FilterRow sub name={section.name} count={count(section.id)} on={selected.includes(section.id)} onClick={() => pick(section.id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </FilterBlock>
  )
}
