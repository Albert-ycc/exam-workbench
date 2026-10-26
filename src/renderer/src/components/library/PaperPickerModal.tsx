// 「选择试卷…」：试题库页把一道题加入任意一份试卷。试卷多时可按标题搜索。
import { useMemo, useState } from 'react'
import type { PaperSummary } from '@shared/domain'
import { navigateTo } from '../../navigation'
import { IconSearch } from '../../icons'
import { Button, EmptyState, Modal, TextInput, formatTime } from '../ui'
import { structureLine } from './format'
import './library.css'

interface Props {
  papers: PaperSummary[]
  onChoose(paperId: number): void
  onClose(): void
}

export default function PaperPickerModal({ papers, onChoose, onClose }: Props) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? papers.filter((p) => p.title.toLowerCase().includes(needle)) : papers
  }, [papers, query])

  return (
    <Modal title="加入试卷" size="md" onClose={onClose} footer={<Button onClick={onClose}>取消</Button>}>
      {papers.length === 0 ? (
        <EmptyState
          compact
          title="还没有试卷"
          description="先在试卷库新建一份试卷，再把题加进去。"
          actions={
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                navigateTo('papers', { paperId: null })
              }}
            >
              去试卷库新建
            </Button>
          }
        />
      ) : (
        <>
          <TextInput value={query} onChange={setQuery} leading={<IconSearch size={16} />} clearable placeholder="按标题搜索" aria-label="搜索试卷" data-autofocus="" />
          <ul className="picker-list" aria-label="试卷">
            {shown.map((paper) => (
              <li key={paper.id}>
                <button type="button" className="picker-item" onClick={() => onChoose(paper.id)}>
                  <span className="picker-title">{paper.title}</span>
                  <span className="picker-meta">
                    {structureLine(paper)} · {formatTime(paper.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="picker-none">没有标题含「{query.trim()}」的试卷。</p>}
        </>
      )}
    </Modal>
  )
}
