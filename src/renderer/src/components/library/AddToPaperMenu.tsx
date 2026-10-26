// 「加入试卷 ▾」：最近编辑的 3 份试卷 + 「选择试卷…」。试题库页每道题一个。
// 菜单只负责选；真正加入（取草稿、放置、保存）在 addToPaper.ts，由页面调用。
import type { PaperSummary } from '@shared/domain'
import { IconChevronDown } from '../../icons'
import { Button, Menu, type MenuEntry } from '../ui'
import { clip } from './format'

interface Props {
  recent: PaperSummary[] // 已按最近编辑排好，只取前 3 份
  disabled?: boolean
  onAdd(paperId: number): void
  onPick(): void
}

export default function AddToPaperMenu({ recent, disabled, onAdd, onPick }: Props) {
  const items: MenuEntry[] = []
  if (recent.length > 0) {
    items.push({ heading: '最近编辑的试卷' })
    for (const paper of recent.slice(0, 3)) items.push({ label: clip(paper.title, 16), onSelect: () => onAdd(paper.id) })
    items.push('separator')
  }
  items.push({ label: recent.length > 0 ? '选择试卷…' : '选择或新建试卷…', onSelect: onPick })
  return (
    <Menu
      label="加入试卷"
      align="end"
      items={items}
      trigger={
        <Button size="sm" disabled={disabled} iconAfter={<IconChevronDown size={14} />}>
          加入试卷
        </Button>
      }
    />
  )
}
