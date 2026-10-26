// 设置：版本号、数据目录、默认下载位置、快捷键说明
import { useEffect, useState } from 'react'
import type { DataDirInfo } from '@shared/api'
import { Button, Tag, errorMessage, toast } from '../components/ui'
import './SettingsPage.css'

// 与编辑器里实际生效的快捷键一一对应
const SHORTCUTS: { keys: string[][]; action: string }[] = [
  { keys: [['Ctrl', 'S']], action: '存为版本' },
  { keys: [['Ctrl', 'Z']], action: '撤销' },
  { keys: [['Ctrl', 'Shift', 'Z']], action: '重做' },
  { keys: [['Esc']], action: '结束编辑' },
  { keys: [['Alt', '↑'], ['Alt', '↓']], action: '上移、下移选中的题目' }
]

function Keys({ keys }: { keys: string[][] }) {
  return (
    <>
      {keys.map((combo, i) => (
        <span key={i}>
          {i > 0 && ' / '}
          {combo.map((key, j) => (
            <span key={j}>
              {j > 0 && '+'}
              <kbd>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </>
  )
}

export default function SettingsPage() {
  const [info, setInfo] = useState<DataDirInfo | null>(null)
  const [downloadDir, setDownloadDir] = useState<string | null>(null)

  useEffect(() => {
    void window.workbench.data.info().then(setInfo, (e) => toast.error(`读取数据目录失败：${errorMessage(e)}`))
    void window.workbench.exporter.getDefaults().then((d) => setDownloadDir(d.directory), () => undefined)
  }, [])

  // 选择文件夹后立即保存：下载弹窗下次打开就用这个位置
  const changeDownloadDir = async (): Promise<void> => {
    const { exporter } = window.workbench
    try {
      const picked = await exporter.chooseDirectory(downloadDir ?? '')
      if (!picked) return
      const saved = await exporter.setDefaultDirectory(picked)
      setDownloadDir(saved.directory)
      toast.show('默认下载位置已更改')
    } catch (e) {
      toast.error(`更改默认下载位置失败：${errorMessage(e)}`)
    }
  }

  const runData = async (action: () => Promise<unknown>, failed: string): Promise<void> => {
    try {
      await action()
    } catch (e) {
      toast.error(`${failed}：${errorMessage(e)}`)
    }
  }

  return (
    <div className="st-page">
      <div className="st-sheet">
        <h1>设置</h1>

        <section className="st-section" aria-labelledby="st-about">
          <h2 id="st-about">版本</h2>
          <div className="st-body">
            <div className="st-version" data-testid="app-version">
              {info ? `组卷工作台 ${info.appVersion}` : '读取中…'}
            </div>
          </div>
        </section>

        <section className="st-section" aria-labelledby="st-data">
          <h2 id="st-data">数据目录</h2>
          <div className="st-body">
            <p className="st-hint">试题库、试卷、版本和图片都保存在这个文件夹里。把整个文件夹复制到其他电脑即可完成备份和迁移。</p>
            <div className="st-path">
              <code>{info?.dataDir ?? '读取中…'}</code>
              {info?.isDefault && <Tag tone="plain">默认位置</Tag>}
            </div>
            <div className="st-stats">
              <div>
                <span className="st-stat-num">{info?.questionCount ?? '–'}</span>
                <span className="st-stat-label">试题库题目</span>
              </div>
              <div>
                <span className="st-stat-num">{info?.paperCount ?? '–'}</span>
                <span className="st-stat-label">试卷</span>
              </div>
            </div>
            <div className="st-actions">
              <Button onClick={() => void runData(() => window.workbench.data.openFolder(), '打开文件夹失败')}>打开文件夹</Button>
              <Button onClick={() => void runData(() => window.workbench.data.changeFolder(), '更改数据目录失败')}>更改位置…</Button>
            </div>
          </div>
        </section>

        <section className="st-section" aria-labelledby="st-download">
          <h2 id="st-download">默认下载位置</h2>
          <div className="st-body">
            <p className="st-hint">下载试卷与答题卡时默认保存到这里。下载时换了别的位置，之后也以最近一次为准。</p>
            <div className="st-path">
              <code data-testid="download-dir">{downloadDir ?? '读取中…'}</code>
            </div>
            <div className="st-actions">
              <Button disabled={downloadDir === null} onClick={() => void changeDownloadDir()}>
                更改位置…
              </Button>
            </div>
          </div>
        </section>

        <section className="st-section" aria-labelledby="st-keys">
          <h2 id="st-keys">快捷键</h2>
          <div className="st-body">
            <table className="st-keys" data-testid="shortcut-table">
              <thead>
                <tr>
                  <th>按键</th>
                  <th>作用（在试卷编辑器里）</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map((row) => (
                  <tr key={row.action}>
                    <th scope="row">
                      <Keys keys={row.keys} />
                    </th>
                    <td>{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
