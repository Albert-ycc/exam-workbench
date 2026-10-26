// 勾选试卷后的操作条：替换表头文字（与试题库同款，表头那一行不变高，选中第一份时列表不挪位）。
// 移到分类、打标签、去标签、取消选择。数据与回调都由页面传入。
// 打标签与去标签都用 TagPicker，行上的数是「所选试卷里有几份带这个标签」：
//   打标签：列出全部标签，所选试卷都有的打勾、只有部分有的半选，点一下补齐；可以输入新名字新建。
//   去标签：只列所选试卷里带着的标签，没有「新建」行，点一下从所选试卷上去掉。
// 小框开着时每次点击不弹提示，关上时由页面汇总成一条（onTagSessionStart / onTagSessionEnd）。
import { useEffect, useRef, useState } from 'react'
import type { PaperCategory, Tag, TagRef } from '@shared/classify'
import { IconChevronDown } from '../../icons'
import { TagPicker } from '../classify'
import { Button, Menu, Popover } from '../ui'
import './papers.css'

export interface BulkBarProps {
  count: number
  categories: PaperCategory[]
  /** 这一套的全部标签（份数已扣掉等待删除的试卷） */
  tags: Tag[]
  /** 标签 id → 所选试卷里有这个标签的份数 */
  tagUse: ReadonlyMap<number, number>
  onMove(categoryId: number | null): void
  onToggleTag(tag: TagRef, next: boolean): void
  onCreateTag(name: string): Promise<TagRef>
  onManageTags(): void
  onClear(): void
  onTagSessionStart(): void
  onTagSessionEnd(): void
}

type TagMode = 'add' | 'remove'

export function BulkBar({ count, categories, tags, tagUse, onMove, onToggleTag, onCreateTag, onManageTags, onClear, onTagSessionStart, onTagSessionEnd }: BulkBarProps) {
  const [open, setOpen] = useState<TagMode | null>(null)
  const openRef = useRef<TagMode | null>(null)
  const endRef = useRef(onTagSessionEnd)
  endRef.current = onTagSessionEnd
  // 小框开着时操作条被拆掉（勾选的试卷都离开了当前列表）：照样把这一轮的汇总提示发出去
  useEffect(
    () => () => {
      if (openRef.current) endRef.current()
    },
    []
  )

  const change = (mode: TagMode, next: boolean): void => {
    if (next) {
      if (openRef.current) onTagSessionEnd()
      onTagSessionStart()
      openRef.current = mode
      setOpen(mode)
    } else if (openRef.current === mode) {
      openRef.current = null
      setOpen(null)
      onTagSessionEnd()
    }
  }

  const checked = new Set<number>()
  const mixed = new Set<number>()
  for (const [id, n] of tagUse) (n >= count ? checked : mixed).add(id)
  const present = tags.filter((t) => (tagUse.get(t.id) ?? 0) > 0)

  return (
    <div className="pp-bulk" role="toolbar" aria-label="批量操作" data-testid="bulk-bar">
      <span className="pp-bulk-count" aria-live="polite">
        已选 {count} 份
      </span>
      <span className="pp-bulk-ops">
        <Menu
          label="移到分类"
          trigger={
            <Button size="sm" iconAfter={<IconChevronDown size={14} />}>
              移到分类
            </Button>
          }
          items={[
            ...(categories.length > 0 ? categories.map((c) => ({ label: c.name, onSelect: () => onMove(c.id) })) : [{ heading: '还没有分类，先在左侧新建' }]),
            'separator',
            { label: '未分类', onSelect: () => onMove(null) }
          ]}
        />
        <Popover
          label="打标签"
          open={open === 'add'}
          onOpenChange={(next) => change('add', next)}
          trigger={
            <Button size="sm" iconAfter={<IconChevronDown size={14} />}>
              打标签
            </Button>
          }
        >
          {({ close }) => (
            <TagPicker
              tags={tags}
              checked={checked}
              mixed={mixed}
              counts={tagUse}
              selectionSize={count}
              unit="份试卷"
              onToggle={onToggleTag}
              onCreate={onCreateTag}
              onManage={() => {
                close({ restoreFocus: false })
                onManageTags()
              }}
            />
          )}
        </Popover>
        <Popover
          label="去标签"
          open={open === 'remove'}
          onOpenChange={(next) => change('remove', next)}
          trigger={
            <Button size="sm" iconAfter={<IconChevronDown size={14} />}>
              去标签
            </Button>
          }
        >
          {({ close }) => (
            <TagPicker
              tags={present}
              checked={checked}
              mixed={mixed}
              counts={tagUse}
              selectionSize={count}
              unit="份试卷"
              allowCreate={false}
              onToggle={(tag) => onToggleTag(tag, false)}
              onManage={() => {
                close({ restoreFocus: false })
                onManageTags()
              }}
            />
          )}
        </Popover>
        <Button size="sm" variant="ghost" className="pp-bulk-clear" onClick={onClear}>
          取消选择
        </Button>
      </span>
    </div>
  )
}
