// 「归到章节」的选择框内容：页面把它放进 ui/Popover。章在前、节缩进在其下，点哪个就把所选的题归到哪个；
// 最下面是「移出章节」（回到「未归章节」）。一题只属于一个章节，再归一次就是移动。
// 键盘：↑↓ 在各项间移动，回车选中；Popover 打开时焦点落在第一项。
import { Fragment, useMemo, useRef, type KeyboardEvent } from 'react'
import type { Chapter } from '@shared/classify'
import { Button } from '../ui'
import './library.css'

interface Props {
  chapters: Chapter[]
  onPick(chapterId: number | null): void
  onManage?(): void
}

export default function ChapterPicker({ chapters, onPick, onManage }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tops = useMemo(() => chapters.filter((c) => c.parentId === null), [chapters])
  const sectionsOf = useMemo(() => {
    const map = new Map<number, Chapter[]>()
    for (const c of chapters) if (c.parentId !== null) map.set(c.parentId, [...(map.get(c.parentId) ?? []), c])
    return map
  }, [chapters])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-cp-item]') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1)
    items[next].focus()
  }

  return (
    <div ref={rootRef} className="lb-cp" onKeyDown={onKeyDown}>
      {tops.length === 0 ? (
        <p className="lb-cp-note">还没有章节，先在「管理章节」里新建。</p>
      ) : (
        <>
          <div className="lb-cp-list" role="group" aria-label="章节">
            {tops.map((top) => (
              <Fragment key={top.id}>
                <button type="button" className="lb-cp-row" data-cp-item title={top.name} onClick={() => onPick(top.id)}>
                  <span>{top.name}</span>
                  <em>{top.count}</em>
                </button>
                {(sectionsOf.get(top.id) ?? []).map((section) => (
                  <button key={section.id} type="button" className="lb-cp-row lb-cp-row--sub" data-cp-item title={`${top.name} › ${section.name}`} onClick={() => onPick(section.id)}>
                    <span>{section.name}</span>
                    <em>{section.count}</em>
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
          <button type="button" className="lb-cp-row lb-cp-out" data-cp-item onClick={() => onPick(null)}>
            <span>移出章节（回到「未归章节」）</span>
          </button>
        </>
      )}
      {onManage && (
        <div className="lb-cp-foot">
          <Button variant="link" size="sm" onClick={onManage}>
            管理章节
          </Button>
        </div>
      )}
    </div>
  )
}
