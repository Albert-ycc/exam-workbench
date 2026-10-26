// 试卷结构条（T2）：窗口不够宽放不下右侧结构栏时，收成试卷栏顶部的一条。每个大题一枚标签「一 选择题 10 题 · 40 分」，
// 当前看到的大题高亮，点标签跳到该大题；左边「试卷结构」展开完整面板，右边是全卷题数与满分。
import type { ReactNode } from 'react'
import { chineseNumeral, formatScore, type PaperStructure } from '@shared/numbering'
import { IconChevronDown } from '../../icons'
import { Button, Popover } from '../ui'

interface Props {
  structure: PaperStructure
  activeSectionId: string | null
  onLocateSection(sectionId: string): void
  renderPanel(close: () => void): ReactNode
}

export function totalText(structure: PaperStructure): string {
  if (structure.questionCount === 0) return '还没有题目'
  const count = `共 ${structure.questionCount} 题`
  if (structure.totalScore == null) return count
  return `${count} · ${structure.allScored ? '满分' : '已设分'} ${formatScore(structure.totalScore)} 分`
}

export default function StructureBar({ structure, activeSectionId, onLocateSection, renderPanel }: Props) {
  return (
    <div className="ed-sbar" data-testid="struct-bar">
      <Popover
        align="start"
        label="试卷结构"
        className="ed-struct-pop"
        trigger={
          <Button size="sm" iconAfter={<IconChevronDown size={14} />} data-testid="struct-toggle">
            试卷结构
          </Button>
        }
      >
        {({ close }) => renderPanel(() => close({ restoreFocus: false }))}
      </Popover>
      <div className="ed-chips">
        {structure.sections.map((s) => {
          const scored = s.questionCount > 0 && s.unscoredNos.length < s.questionCount
          return (
            <button
              key={s.sectionId}
              type="button"
              className={`ed-chip${s.sectionId === activeSectionId ? ' is-on' : ''}${s.questionCount === 0 ? ' is-empty' : ''}`}
              data-testid="struct-chip"
              aria-current={s.sectionId === activeSectionId ? 'true' : undefined}
              title={`${s.heading}，点击定位`}
              onClick={() => onLocateSection(s.sectionId)}
            >
              <span className="ed-chip-no">{chineseNumeral(s.index + 1)}</span>
              <span className="ed-chip-title">{s.title || '未命名'}</span>
              <span className="ed-chip-count">{s.questionCount} 题</span>
              {scored && <span className="ed-chip-score">· {formatScore(s.totalScore)} 分</span>}
            </button>
          )
        })}
      </div>
      <span className="ed-sbar-total" data-testid="struct-total">
        {totalText(structure)}
      </span>
    </div>
  )
}
