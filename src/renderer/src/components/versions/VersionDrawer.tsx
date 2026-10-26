// 版本历史（S17：停靠在右侧，不盖住试卷）：版本列表（时间倒序，带结构摘要）、每个版本的下载记录，
// 查看 / 恢复 / 另存为新试卷 / 按原配置重新下载 / 打开所在文件夹
import { useCallback, useEffect, useState } from 'react'
import type { ExportRecord, VersionSummary } from '@shared/domain'
import { IconDownload, IconFolder } from '../../icons'
import { Button, Drawer, Tag, toast } from '../ui'
import { baseName, errorMessage, formatTime } from '../editor/format'
import { editionLabel, ORIGIN_LABEL, recordSummary, structureText } from './exportSummary'
import './versions.css'

interface Props {
  paperId: number
  reloadKey: number // 外部发生了版本变化（存版本、下载、恢复）时递增
  onView(version: VersionSummary): void
  onRestore(version: VersionSummary): void
  onDuplicate(version: VersionSummary): void
  onClose(): void
  onVersionsChanged(): void
}

export default function VersionDrawer({ paperId, reloadKey, onView, onRestore, onDuplicate, onClose, onVersionsChanged }: Props) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyExport, setBusyExport] = useState<number | null>(null)
  const [lastMessage, setLastMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setVersions(await window.workbench.papers.listVersions(paperId))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [paperId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const reexport = async (record: ExportRecord): Promise<void> => {
    setBusyExport(record.id)
    setLastMessage(null)
    try {
      const result = await window.workbench.exporter.reexport(record.id)
      setLastMessage({ tone: 'info', text: `已重新生成：${baseName(result.filePath)}` })
      onVersionsChanged()
      await load()
    } catch (e) {
      const text = errorMessage(e)
      setLastMessage({ tone: 'error', text })
      toast.error(`重新下载失败：${text}`)
    } finally {
      setBusyExport(null)
    }
  }

  const showInFolder = async (record: ExportRecord): Promise<void> => {
    try {
      await window.workbench.exporter.showInFolder(record.filePath)
    } catch (e) {
      toast.error(`无法打开文件夹：${errorMessage(e)}`)
    }
  }

  return (
    <Drawer title="版本历史" width={380} onClose={onClose} className="ed-versions">
      <div data-testid="version-drawer" className="ed-ver-wrap">
        {lastMessage && (
          <div className={`ed-ver-msg is-${lastMessage.tone}`} role={lastMessage.tone === 'error' ? 'alert' : 'status'} data-testid="drawer-message">
            {lastMessage.text}
          </div>
        )}
        {error && <p className="ed-ver-empty is-error">{error}</p>}
        {!error && versions == null && <p className="ed-ver-empty">读取中…</p>}
        {versions?.length === 0 && <p className="ed-ver-empty">还没有保存过版本。点顶部的「存为版本」，把当前的试卷固定下来。</p>}
        {versions?.map((v, index) => (
          <section key={v.id} className="ed-ver" data-testid="version-item" data-version-no={v.versionNo}>
            <div className="ed-ver-head">
              <strong className="ed-ver-no">v{v.versionNo}</strong>
              {index === 0 && <Tag tone="ok">最新</Tag>}
              <Tag tone="plain">{ORIGIN_LABEL[v.origin]}</Tag>
              <span className="ed-ver-time">{formatTime(v.createdAt)}</span>
            </div>
            <p className="ed-ver-struct" data-testid="version-structure">
              {structureText(v.structure)}
            </p>
            <p className={`ed-ver-note${v.note ? '' : ' is-none'}`}>{v.note || '无说明'}</p>
            <div className="ed-ver-actions">
              <Button size="sm" onClick={() => onView(v)}>
                查看
              </Button>
              <Button size="sm" onClick={() => onRestore(v)}>
                恢复
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDuplicate(v)} title="用这个版本的内容另存为一份新试卷，当前草稿不受影响">
                另存为新试卷
              </Button>
            </div>
            {v.exports.length > 0 && (
              <ul className="ed-ver-exports">
                {v.exports.map((record) => (
                  <li key={record.id} data-testid="export-record">
                    <div className="ed-exp-line">
                      <Tag>{record.kind === 'answer-sheet' ? '答题卡' : '试卷'}</Tag>
                      <Tag>{record.format.toUpperCase()}</Tag>
                      {record.kind !== 'answer-sheet' && <Tag tone={editionLabel(record.options) === '教师版' ? 'warn' : 'plain'}>{editionLabel(record.options)}</Tag>}
                      <span className="ed-exp-name" title={record.filePath}>
                        {baseName(record.filePath)}
                      </span>
                    </div>
                    <div className="ed-exp-opts">
                      {recordSummary(record)} · {formatTime(record.createdAt)}
                    </div>
                    <div className="ed-exp-actions">
                      <Button size="sm" icon={<IconDownload size={14} />} disabled={busyExport === record.id} onClick={() => void reexport(record)}>
                        {busyExport === record.id ? '生成中…' : '按原配置重新下载'}
                      </Button>
                      <Button size="sm" icon={<IconFolder size={14} />} onClick={() => void showInFolder(record)}>
                        打开所在文件夹
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Drawer>
  )
}
