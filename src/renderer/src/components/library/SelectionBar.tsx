// 勾选题目后的操作条，替换表头文字：已选 N 道、全选筛出的 N 道（没有任何筛选条件时写「全选全部 N 道」）、归到章节、打标签、去标签、取消选择。
// 只管展示与弹出选择框；真正的接口调用与刷新在页面里（选中的是 { ids } 还是 { filter } 由页面决定）。
//
// 打标签与去标签用同一个 TagPicker：勾选 = 所选的题都有，半选 = 只有部分题有。
//   打标签：列出全部标签，点一下给所选的题都打上（半选变全选）；已全选的再点一下就是去掉。
//   去标签：只列所选的题带着的标签，点一下从所选的题上去掉。
// 所选的题各带哪些标签由 loadTagStates 在选择框打开时读取，读完才显示列表；行上的数字是「所选的题里有几道带这个标签」。
// 选择框开着时每点一个标签只落库、不弹提示；关闭时由页面汇总成一条提示（onTagsClosed）。
import { useEffect, useState } from 'react'
import type { Chapter, Tag, TagRef } from '@shared/classify'
import { IconChevronDown } from '../../icons'
import { TagPicker } from '../classify'
import { Button, Popover, errorMessage, toast } from '../ui'
import ChapterPicker from './ChapterPicker'
import './library.css'

export interface TagStates {
  checked: Set<number> // 所选的题都有的标签
  mixed: Set<number> // 只有部分题有的标签
  counts: Map<number, number> // 标签 → 所选的题里有几道带它
  size: number // 所选总数
}

interface Props {
  count: number // 已选几道
  total: number // 当前条件筛出几道
  all: boolean // 已选的就是筛出的全部（按条件操作，不受分页影响）
  unfiltered: boolean // 当前没有任何筛选条件：「筛出的全部」就是全部题
  chapters: Chapter[]
  tags: Tag[]
  onSelectAll(): void
  onClear(): void
  onAssign(chapterId: number | null): void
  loadTagStates(): Promise<TagStates>
  onTagChange(tag: TagRef, on: boolean): Promise<void>
  onCreateTag(name: string): Promise<TagRef>
  onTagsClosed(): void
  onManageChapters(): void
  onManageTags(): void
}

export default function SelectionBar({ count, total, all, unfiltered, chapters, tags, onSelectAll, onClear, onAssign, loadTagStates, onTagChange, onCreateTag, onTagsClosed, onManageChapters, onManageTags }: Props) {
  return (
    <div className="lb-bulk" role="toolbar" aria-label="批量操作">
      <span className="lb-bulk-count" data-testid="bulk-count">
        已选 {count} 道{all ? (unfiltered ? '（全部）' : '（筛出的全部）') : ''}
      </span>
      {!all && count < total && (
        <Button variant="link" size="sm" onClick={onSelectAll}>
          {unfiltered ? `全选全部 ${total} 道` : `全选筛出的 ${total} 道`}
        </Button>
      )}
      <span className="lb-bulk-ops">
        <Popover trigger={<Button size="sm" iconAfter={<IconChevronDown size={14} />}>归到章节</Button>} label="归到章节" align="start">
          {({ close }) => (
            <ChapterPicker
              chapters={chapters}
              onPick={(id) => {
                close()
                onAssign(id)
              }}
              onManage={() => {
                close({ restoreFocus: false })
                onManageChapters()
              }}
            />
          )}
        </Popover>
        {(['add', 'remove'] as const).map((mode) => (
          <Popover key={mode} trigger={<Button size="sm" iconAfter={<IconChevronDown size={14} />}>{mode === 'add' ? '打标签' : '去标签'}</Button>} label={mode === 'add' ? '给所选题目打标签' : '去掉所选题目的标签'} align="start" onOpenChange={(open) => !open && onTagsClosed()}>
            {({ close }) => (
              <BulkTagPicker
                mode={mode}
                tags={tags}
                loadStates={loadTagStates}
                onChange={onTagChange}
                onCreate={onCreateTag}
                onManage={() => {
                  close({ restoreFocus: false })
                  onManageTags()
                }}
              />
            )}
          </Popover>
        ))}
        <Button size="sm" variant="ghost" onClick={onClear}>
          取消选择
        </Button>
      </span>
    </div>
  )
}

function BulkTagPicker({
  mode,
  tags,
  loadStates,
  onChange,
  onCreate,
  onManage
}: {
  mode: 'add' | 'remove'
  tags: Tag[]
  loadStates(): Promise<TagStates>
  onChange(tag: TagRef, on: boolean): Promise<void>
  onCreate(name: string): Promise<TagRef>
  onManage(): void
}) {
  const [states, setStates] = useState<TagStates | null>(null)
  useEffect(() => {
    let alive = true
    loadStates().then(
      (next) => alive && setStates(next),
      (error) => alive && toast.error(`读取所选题目的标签失败：${errorMessage(error)}`)
    )
    return () => {
      alive = false
    }
    // 每次打开重新挂载，只读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!states) return <p className="lb-picker-wait">正在读取所选题目的标签…</p>

  const apply = async (tag: TagRef, on: boolean): Promise<void> => {
    try {
      await onChange(tag, on)
      setStates((prev) => {
        if (!prev) return prev
        const checked = new Set(prev.checked)
        const mixed = new Set(prev.mixed)
        const counts = new Map(prev.counts)
        mixed.delete(tag.id)
        if (on) checked.add(tag.id)
        else checked.delete(tag.id)
        counts.set(tag.id, on ? prev.size : 0)
        return { ...prev, checked, mixed, counts }
      })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const shown = mode === 'remove' ? tags.filter((t) => states.checked.has(t.id) || states.mixed.has(t.id)) : tags
  return (
    <TagPicker
      tags={shown}
      checked={states.checked}
      mixed={states.mixed}
      counts={states.counts}
      selectionSize={states.size}
      unit="道题"
      onToggle={(tag, next) => void apply(tag, mode === 'remove' ? false : next)}
      onCreate={onCreate}
      allowCreate={mode === 'add'}
      onManage={onManage}
    />
  )
}
