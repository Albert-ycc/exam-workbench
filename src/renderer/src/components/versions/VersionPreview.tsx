// 版本只读预览：整卷展示，可顺手恢复到这个版本
import { useState } from 'react'
import type { VersionDetail } from '@shared/domain'
import { hasVisibleContent } from '@shared/numbering'
import { Button, Checkbox, Modal, formatTime } from '../ui'
import { ORIGIN_LABEL, structureText } from './exportSummary'
import PaperSheet from './PaperSheet'
import './versions.css'

interface Props {
  version: VersionDetail
  onRestore(): void
  onClose(): void
}

export default function VersionPreview({ version, onRestore, onClose }: Props) {
  const [showAnswers, setShowAnswers] = useState(false)
  const hasAnswers = version.snapshot.sections.some((s) => s.items.some((i) => hasVisibleContent(i.answerHtml)))
  return (
    <Modal
      title={`v${version.versionNo} 预览`}
      size="wide"
      flush
      onClose={onClose}
      footer={
        <>
          <span className="ed-foot-note">只读预览，不影响当前草稿</span>
          <span className="ed-grow" />
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" onClick={onRestore}>
            恢复到此版本
          </Button>
        </>
      }
    >
      <div className="ed-preview-meta">
        <span>
          {formatTime(version.createdAt)} · {ORIGIN_LABEL[version.origin]} · {structureText(version.structure)}
        </span>
        {version.note && <span className="ed-preview-note">说明：{version.note}</span>}
        {hasAnswers && (
          <Checkbox className="ed-preview-check" checked={showAnswers} onChange={setShowAnswers}>
            显示答案与解析
          </Checkbox>
        )}
      </div>
      <div className="ed-preview-scroll">
        <PaperSheet title={version.snapshot.title} sections={version.snapshot.sections} showAnswers={showAnswers} />
      </div>
    </Modal>
  )
}
