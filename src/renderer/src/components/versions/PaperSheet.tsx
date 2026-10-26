// 只读渲染一份试卷快照（版本预览用）：版面、大题序号、题号、分值说明与编辑器同一套算法
import type { DraftSection } from '@shared/domain'
import { itemScoreNote, numberItems, numberLabel, paperTotalNote, sectionHeading, sectionScoreNote, structureOf } from '@shared/numbering'
import { Tag } from '../ui'
import MemoQuestionHtml from '../editor/MemoQuestionHtml'

interface Props {
  title: string
  sections: DraftSection[]
  showAnswers: boolean
}

export default function PaperSheet({ title, sections, showAnswers }: Props) {
  const numbered = new Map(numberItems(sections).map((n) => [n.item.id, n]))
  const structure = structureOf(sections)
  const total = paperTotalNote(structure)
  return (
    <div className="ed-sheet is-readonly" data-testid="preview-sheet">
      <h2 className="ed-sheet-title">{title}</h2>
      {total && <p className="ed-sheet-sub">{total}</p>}
      {sections.length === 0 && <p className="ed-sec-empty">这个版本里还没有题目</p>}
      {sections.map((section, index) => (
        <section key={section.id} className="ed-sec">
          <header className="ed-sec-head">
            <span className="ed-sec-heading">{sectionHeading(index, section.title)}</span>
            <span className="ed-sec-note">{sectionScoreNote(structure.sections[index])}</span>
          </header>
          {section.items.map((item) => {
            const n = numbered.get(item.id)
            const firstNo = n?.firstNo ?? 1
            return (
              <article key={item.id} className="ed-item">
                <div className="ed-item-grip" />
                <div className="ed-item-main">
                  <span className="ed-qno" data-testid="preview-item-no">
                    {n ? numberLabel(n) : ''}
                  </span>
                  <MemoQuestionHtml html={item.stemHtml} firstNo={firstNo} />
                  {showAnswers && item.answerHtml != null && (
                    <div className="ed-answer-view">
                      <MemoQuestionHtml html={item.answerHtml} firstNo={firstNo} />
                    </div>
                  )}
                </div>
                <div className="ed-note">
                  <Tag>{item.questionType || '未分类'}</Tag>
                  <div className="ed-note-src">{item.sourceLabel}</div>
                  <span className="ed-score-text">{itemScoreNote(item, section)}</span>
                </div>
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}
