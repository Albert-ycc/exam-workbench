// 管理章节弹窗：老师自建的两级目录（章、节）。新建章、在章下新建节、行内改名、同级上移下移、删除。
// 数据与接口由页面传入；每个回调结束后页面已重新读取章节，传进来的 chapters 就是最新的。
// 名称出错（空名、超过 30 字、同级重名等接口报错）一律显示在对应输入框下面：红框 + 红字，改动输入即消失；toast 只用于成功提示（页面发）。
// 删除前写明连带的节数与回到「未归章节」的题数，数字取自 chapters 里的 count。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CLASS_NAME_MAX, classNameLength, cleanClassName, type Chapter } from '@shared/classify'
import { IconDown, IconEdit, IconPlus, IconTrash, IconUp } from '../../icons'
import { Button, ConfirmDialog, EmptyState, Modal, TextInput, errorMessage } from '../ui'
import './library.css'

interface Props {
  chapters: Chapter[]
  onCreate(name: string, parentId: number | null): Promise<void>
  onRename(id: number, name: string): Promise<void>
  onMove(id: number, toIndex: number): Promise<void>
  onDelete(id: number): Promise<void>
  onClose(): void
}

// 出错提示挂在哪个输入框下面：顶部「新建章」、某行的改名、某章下新建节；list 是不属于任何输入框的操作（调顺序）
type Place = 'top' | 'list' | `edit-${number}` | `add-${number}`

export default function ChapterManagerModal({ chapters, onCreate, onRename, onMove, onDelete, onClose }: Props) {
  const [chapterDraft, setChapterDraft] = useState('') // 顶部「新建章」
  const [sectionAdd, setSectionAdd] = useState<{ parentId: number; draft: string } | null>(null)
  const [editing, setEditing] = useState<{ id: number; draft: string } | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<{ chapter: Chapter; error: string | null } | null>(null)
  const [problem, setProblem] = useState<{ at: Place; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const topInput = useRef<HTMLInputElement | null>(null)
  const rowInput = useRef<HTMLInputElement | null>(null)
  const refocus = useRef<string | null>(null)
  // 请求结束（输入框恢复可用）后把焦点放回哪个输入框：连续新建、改名出错重来都不用再点一下
  const focusAfter = useRef<'top' | 'row' | null>(null)

  const tops = chapters.filter((c) => c.parentId === null)
  const editingId = editing?.id ?? null
  const addingTo = sectionAdd?.parentId ?? null
  useEffect(() => {
    if (editingId !== null) {
      rowInput.current?.focus()
      rowInput.current?.select()
    }
  }, [editingId])
  useEffect(() => {
    if (addingTo !== null) rowInput.current?.focus()
  }, [addingTo])
  // 改名结束、新建关闭后，焦点回到触发它的按钮，键盘不断
  useEffect(() => {
    if (editingId === null && addingTo === null && refocus.current) {
      document.querySelector<HTMLElement>(`[data-cm="${refocus.current}"]`)?.focus()
      refocus.current = null
    }
  }, [editingId, addingTo])

  useEffect(() => {
    if (busy || !focusAfter.current) return
    ;(focusAfter.current === 'top' ? topInput : rowInput).current?.focus()
    focusAfter.current = null
  }, [busy])

  // 统一包一层：忙碌期间禁用全部按钮；失败的原因挂到对应位置
  const run = async (at: Place, action: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      return true
    } catch (error) {
      setProblem({ at, text: errorMessage(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  // 名称的错：超长随输入实时出现；空名在改名时随输入出现，在新建时按回车后出现；其余是接口报的（重名等）
  const nameProblem = (at: Place, draft: string, emptyNow: boolean): string | null => {
    const name = cleanClassName(draft)
    if (classNameLength(name) > CLASS_NAME_MAX) return `章节名最多 ${CLASS_NAME_MAX} 字`
    if (!name && emptyNow) return '章节名不能为空'
    return problem?.at === at ? problem.text : null
  }
  const clearProblem = (at: Place): void => setProblem((p) => (p?.at === at ? null : p))
  const valid = (draft: string): string | null => {
    const name = cleanClassName(draft)
    return name && classNameLength(name) <= CLASS_NAME_MAX ? name : null
  }

  const createChapter = async (): Promise<void> => {
    const name = valid(chapterDraft)
    if (!name) {
      if (!cleanClassName(chapterDraft)) setProblem({ at: 'top', text: '章节名不能为空' })
      return
    }
    focusAfter.current = 'top'
    if (await run('top', () => onCreate(name, null))) setChapterDraft('')
  }

  const createSection = async (): Promise<void> => {
    if (!sectionAdd) return
    const at: Place = `add-${sectionAdd.parentId}`
    const name = valid(sectionAdd.draft)
    if (!name) {
      if (!cleanClassName(sectionAdd.draft)) setProblem({ at, text: '章节名不能为空' })
      return
    }
    // 连续新建多个节：成功后输入框清空留着，Esc 结束
    focusAfter.current = 'row'
    if (await run(at, () => onCreate(name, sectionAdd.parentId))) setSectionAdd({ parentId: sectionAdd.parentId, draft: '' })
  }

  const rename = async (chapter: Chapter): Promise<void> => {
    if (!editing) return
    const name = valid(editing.draft)
    if (!name) return
    if (name === chapter.name) {
      refocus.current = `rename-${chapter.id}`
      setEditing(null)
      return
    }
    focusAfter.current = 'row' // 出错时回到输入框；成功时输入框已经没了，下面改去焦点回到「改名」按钮
    if (await run(`edit-${chapter.id}`, () => onRename(chapter.id, name))) {
      focusAfter.current = null
      refocus.current = `rename-${chapter.id}`
      setEditing(null)
    }
  }

  const keys = (event: KeyboardEvent<HTMLInputElement>, submit: () => void, cancel: (() => void) | null): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return // 输入法组词中的回车、Esc 归输入法
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape' && cancel) {
      event.preventDefault() // 弹窗看到 defaultPrevented 就不会跟着关
      cancel()
    }
  }

  const remove = async (chapter: Chapter): Promise<void> => {
    setBusy(true)
    try {
      await onDelete(chapter.id)
      setDeleteAsk(null)
    } catch (error) {
      setDeleteAsk({ chapter, error: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const row = (chapter: Chapter, index: number, siblings: number) => {
    const isTop = chapter.parentId === null
    const at: Place = `edit-${chapter.id}`
    const isEditing = editing?.id === chapter.id
    const text = isEditing && editing ? nameProblem(at, editing.draft, true) : null
    return (
      <div className={`lb-cm-row${isTop ? ' lb-cm-row--top' : ''}`}>
        {isEditing && editing ? (
          <>
            <TextInput
              className="lb-cm-input"
              size="sm"
              ref={rowInput}
              value={editing.draft}
              invalid={Boolean(text)}
              disabled={busy}
              aria-label={`「${chapter.name}」的新名称`}
              onChange={(draft) => {
                clearProblem(at)
                setEditing({ id: chapter.id, draft })
              }}
              onKeyDown={(event) =>
                keys(event, () => void rename(chapter), () => {
                  refocus.current = `rename-${chapter.id}`
                  setProblem(null)
                  setEditing(null)
                })
              }
            />
            <span className="lb-cm-actions">
              <Button size="sm" variant="primary" disabled={busy || !valid(editing.draft)} onClick={() => void rename(chapter)}>
                保存
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  refocus.current = `rename-${chapter.id}`
                  setProblem(null)
                  setEditing(null)
                }}
              >
                取消
              </Button>
            </span>
            {text && (
              <p className="lb-problem" role="alert">
                {text}
              </p>
            )}
          </>
        ) : (
          <>
            <span className="lb-cm-name" title={chapter.name}>
              {chapter.name}
            </span>
            <span className="lb-cm-count">{chapter.count} 道题</span>
            <span className="lb-cm-actions">
              {isTop && (
                <Button
                  size="sm"
                  variant="ghost"
                  data-cm={`add-${chapter.id}`}
                  icon={<IconPlus size={14} />}
                  disabled={busy}
                  aria-label={`在「${chapter.name}」下新建节`}
                  onClick={() => {
                    setEditing(null)
                    setProblem(null)
                    setSectionAdd({ parentId: chapter.id, draft: '' })
                  }}
                >
                  新建节
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<IconUp size={14} />} aria-label={`上移：${chapter.name}`} disabled={busy || index === 0} onClick={() => void run('list', () => onMove(chapter.id, index - 1))}>
                上移
              </Button>
              <Button size="sm" variant="ghost" icon={<IconDown size={14} />} aria-label={`下移：${chapter.name}`} disabled={busy || index === siblings - 1} onClick={() => void run('list', () => onMove(chapter.id, index + 1))}>
                下移
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-cm={`rename-${chapter.id}`}
                icon={<IconEdit size={14} />}
                aria-label={`改名：${chapter.name}`}
                disabled={busy}
                onClick={() => {
                  setSectionAdd(null)
                  setProblem(null)
                  setEditing({ id: chapter.id, draft: chapter.name })
                }}
              >
                改名
              </Button>
              <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} aria-label={`删除：${chapter.name}`} disabled={busy} onClick={() => setDeleteAsk({ chapter, error: null })}>
                删除
              </Button>
            </span>
          </>
        )}
      </div>
    )
  }

  const addRow = (parent: Chapter) => {
    if (!sectionAdd) return null
    const at: Place = `add-${parent.id}`
    const text = nameProblem(at, sectionAdd.draft, false)
    return (
      <div className="lb-cm-add">
        <TextInput
          className="lb-cm-input"
          size="sm"
          ref={rowInput}
          value={sectionAdd.draft}
          invalid={Boolean(text)}
          disabled={busy}
          placeholder={`「${parent.name}」下的新节，如「1.1 正数和负数」`}
          aria-label={`「${parent.name}」下新节的名称`}
          onChange={(draft) => {
            clearProblem(at)
            setSectionAdd({ parentId: parent.id, draft })
          }}
          onKeyDown={(event) =>
            keys(event, () => void createSection(), () => {
              refocus.current = `add-${parent.id}`
              setProblem(null)
              setSectionAdd(null)
            })
          }
        />
        <span className="lb-cm-actions">
          <Button size="sm" variant="primary" disabled={busy || !valid(sectionAdd.draft)} onClick={() => void createSection()}>
            添加
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              refocus.current = `add-${parent.id}`
              setProblem(null)
              setSectionAdd(null)
            }}
          >
            完成
          </Button>
        </span>
        {text && (
          <p className="lb-problem" role="alert">
            {text}
          </p>
        )}
      </div>
    )
  }

  const topProblem = nameProblem('top', chapterDraft, false)
  const sectionTotal = (chapter: Chapter): number => chapters.filter((c) => c.parentId === chapter.id).length
  const consequence = (chapter: Chapter): string => {
    const sections = chapter.parentId === null ? sectionTotal(chapter) : 0
    const lead = sections > 0 ? `其下 ${sections} 个节一并删除，` : ''
    return chapter.count > 0 ? `${lead}${chapter.count} 道题回到「未归章节」，题目本身不会删除。` : `${lead}没有题目归在这里，其他章节不受影响。`
  }

  return (
    <>
      <Modal title="管理章节" width={760} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
        <div className="lb-cm-new">
          <TextInput
            ref={topInput}
            className="lb-cm-input"
            value={chapterDraft}
            invalid={Boolean(topProblem)}
            disabled={busy}
            placeholder="新建章，如「第一章 有理数」"
            aria-label="新章的名称"
            onChange={(draft) => {
              clearProblem('top')
              setChapterDraft(draft)
            }}
            onKeyDown={(event) => keys(event, () => void createChapter(), null)}
          />
          <Button variant="primary" disabled={busy || !valid(chapterDraft)} onClick={() => void createChapter()}>
            新建章
          </Button>
        </div>
        {topProblem && (
          <p className="lb-problem" role="alert">
            {topProblem}
          </p>
        )}
        {problem?.at === 'list' && (
          <p className="lb-problem" role="alert">
            {problem.text}
          </p>
        )}
        {tops.length === 0 ? (
          <EmptyState compact title="还没有章节" description="先新建章，再在章下新建节；题目可在试题库里勾选后归到章节。" />
        ) : (
          <ul className="lb-cm-list" aria-label="章节">
            {tops.map((top, ti) => {
              const sections = chapters.filter((c) => c.parentId === top.id)
              return (
                <li key={top.id}>
                  {row(top, ti, tops.length)}
                  {sectionAdd?.parentId === top.id && addRow(top)}
                  {sections.length > 0 && (
                    <ul className="lb-cm-sub" aria-label={`${top.name}的节`}>
                      {sections.map((section, si) => (
                        <li key={section.id}>{row(section, si, sections.length)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      {deleteAsk && (
        <ConfirmDialog title={`删除章节「${deleteAsk.chapter.name}」`} danger confirmLabel="删除" busy={busy} onClose={() => setDeleteAsk(null)} onConfirm={() => void remove(deleteAsk.chapter)}>
          <p>{consequence(deleteAsk.chapter)}</p>
          {deleteAsk.error && (
            <p className="lb-problem" role="alert">
              {deleteAsk.error}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  )
}
