// 管理标签弹窗：每行名称、「N 道题」、改名、删除。题目标签与试卷标签共用，title 与 unit 由页面传（'管理标签' / '道题'，'管理试卷标签' / '份试卷'）。
//
// {managing && <TagManagerModal title="管理标签" unit="道题" tags={tags} onClose={() => setManaging(false)}
//    onRename={async (id, name) => { const r = await library.renameTag(id, name); await reload(); return r }}
//    onDelete={async (id) => { await library.deleteTag(id); await reload() }} />}
//
// - 改名在行内：回车保存、Esc 取消（只取消改名，不关弹窗）。新名称与另一个标签同名（不分英文大小写）时先确认「并入」再调 onRename，
//   后端把两个标签合并；改成超过 20 字不允许保存。
// - 删除先确认，写明几道题（几份试卷）会去掉这个标签。确认框统一写法：标题＝动作＋对象，正文＝后果＋不受影响的部分，句号结尾。
// - 名称超长的提示是红色（阻止保存的错误）。
// - 接口报错用 toast.error 显示中文原因，行保持原样。
// - 回调结束后页面重新读数据、传入新的 tags；重读完成前，改过名、删掉的行先按结果显示，不闪回旧名。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TAG_NAME_MAX, classNameLength, cleanClassName, type Tag, type TagRenameResult } from '@shared/classify'
import { IconEdit, IconTrash } from '../../icons'
import { Button, ConfirmDialog, EmptyState, Modal, TextInput, errorMessage, toast } from '../ui'
import './classify.css'

export interface TagManagerModalProps {
  title: string
  unit: '道题' | '份试卷'
  tags: Tag[]
  onRename(id: number, name: string): Promise<TagRenameResult>
  onDelete(id: number): Promise<void>
  onClose(): void
}

const asciiFold = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase())
const charCount = classNameLength

export function TagManagerModal({ title, unit, tags, onRename, onDelete, onClose }: TagManagerModalProps) {
  const noun = unit === '道题' ? '题目' : '试卷'
  const [editing, setEditing] = useState<{ id: number; draft: string } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [mergeAsk, setMergeAsk] = useState<{ from: Tag; into: Tag; name: string } | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<Tag | null>(null)
  const [deleting, setDeleting] = useState(false)
  // 改名、删除已经成功但页面还没传回新 tags 时的显示
  const [local, setLocal] = useState<{ names: Map<number, string>; gone: Set<number> }>({ names: new Map(), gone: new Set() })
  useEffect(() => setLocal({ names: new Map(), gone: new Set() }), [tags])

  const inputRef = useRef<HTMLInputElement | null>(null)
  const refocus = useRef<number | null>(null)
  const editingId = editing?.id ?? null
  useEffect(() => {
    if (editingId !== null) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (refocus.current !== null) {
      document.querySelector<HTMLElement>(`[data-rename="${refocus.current}"]`)?.focus()
      refocus.current = null
    }
  }, [editingId])

  // 改名出错后输入框重新可用，焦点回到输入框
  useEffect(() => {
    if (busyId === null && editingId !== null) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyId])

  const rows = tags.filter((t) => !local.gone.has(t.id))
  const displayName = (tag: Tag): string => local.names.get(tag.id) ?? tag.name

  const stopEditing = (id: number): void => {
    refocus.current = id
    setEditing(null)
  }

  const rename = async (tag: Tag, name: string): Promise<void> => {
    setBusyId(tag.id)
    try {
      const result = await onRename(tag.id, name)
      if (result.mergedInto !== null) {
        const into = tags.find((t) => t.id === result.mergedInto)
        setLocal((prev) => ({ names: prev.names, gone: new Set(prev.gone).add(tag.id) }))
        toast.show(`已将「${tag.name}」并入「${into?.name ?? name}」`)
        setEditing(null)
      } else {
        setLocal((prev) => ({ names: new Map(prev.names).set(tag.id, name), gone: prev.gone }))
        stopEditing(tag.id)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const submit = (tag: Tag): void => {
    if (!editing) return
    const name = cleanClassName(editing.draft)
    if (!name || charCount(name) > TAG_NAME_MAX) return
    const other = tags.find((t) => t.id !== tag.id && !local.gone.has(t.id) && asciiFold(displayName(t)) === asciiFold(name))
    if (other) setMergeAsk({ from: tag, into: other, name })
    else if (name === displayName(tag)) stopEditing(tag.id)
    else void rename(tag, name)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, tag: Tag): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      submit(tag)
    } else if (event.key === 'Escape') {
      event.preventDefault() // 弹窗看到 defaultPrevented 就不会跟着关
      stopEditing(tag.id)
    }
  }

  const remove = async (tag: Tag): Promise<void> => {
    setDeleting(true)
    try {
      await onDelete(tag.id)
      setLocal((prev) => ({ names: prev.names, gone: new Set(prev.gone).add(tag.id) }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeleting(false)
      setDeleteAsk(null)
    }
  }

  const draftName = editing ? cleanClassName(editing.draft) : ''
  const draftTooLong = charCount(draftName) > TAG_NAME_MAX

  return (
    <>
      <Modal title={title} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
        {rows.length === 0 ? (
          <EmptyState compact title="还没有标签" description={`在${noun}上打标签后，会出现在这里。`} />
        ) : (
          <ul className="cf-mlist" aria-label="标签">
            {rows.map((tag) => {
              const name = displayName(tag)
              const isEditing = editing?.id === tag.id
              const busy = busyId === tag.id
              return (
                <li key={tag.id} className="cf-mrow">
                  {isEditing ? (
                    <>
                      <TextInput
                        className="cf-mname-input"
                        size="sm"
                        ref={inputRef}
                        value={editing.draft}
                        onChange={(draft) => setEditing({ id: tag.id, draft })}
                        invalid={!draftName || draftTooLong}
                        disabled={busy}
                        aria-label={`标签「${name}」的新名称`}
                        onKeyDown={(event) => onKeyDown(event, tag)}
                      />
                      <span className="cf-mcount">
                        {tag.count} {unit}
                      </span>
                      <span className="cf-mactions">
                        <Button size="sm" variant="primary" disabled={busy || !draftName || draftTooLong} onClick={() => submit(tag)}>
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => stopEditing(tag.id)}>
                          取消
                        </Button>
                      </span>
                      {draftTooLong && (
                        <p className="cf-warn cf-mrow-warn" role="alert">
                          标签名最多 {TAG_NAME_MAX} 字
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="cf-mname" title={name}>
                        {name}
                      </span>
                      <span className="cf-mcount">
                        {tag.count} {unit}
                      </span>
                      <span className="cf-mactions">
                        <Button size="sm" variant="ghost" data-rename={tag.id} icon={<IconEdit size={14} />} aria-label={`改名：${name}`} onClick={() => setEditing({ id: tag.id, draft: name })}>
                          改名
                        </Button>
                        <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} aria-label={`删除：${name}`} onClick={() => setDeleteAsk(tag)}>
                          删除
                        </Button>
                      </span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      {mergeAsk && (
        <ConfirmDialog
          title={`并入标签「${displayName(mergeAsk.into)}」`}
          danger
          confirmLabel="并入"
          onClose={() => setMergeAsk(null)}
          onConfirm={() => {
            const ask = mergeAsk
            setMergeAsk(null)
            void rename(ask.from, ask.name)
          }}
        >
          <p>
            「{displayName(mergeAsk.from)}」将并入「{displayName(mergeAsk.into)}」，原来带「{displayName(mergeAsk.from)}」的 {mergeAsk.from.count} {unit}都会带上「{displayName(mergeAsk.into)}」，「{displayName(mergeAsk.from)}」随后删除。
          </p>
        </ConfirmDialog>
      )}
      {deleteAsk && (
        <ConfirmDialog title={`删除标签「${displayName(deleteAsk)}」`} danger confirmLabel="删除" busy={deleting} onClose={() => setDeleteAsk(null)} onConfirm={() => void remove(deleteAsk)}>
          <p>{deleteAsk.count > 0 ? `${deleteAsk.count} ${unit}会去掉这个标签，${noun}本身不受影响。` : `这个标签没有用在任何${noun}上，删除不影响其他标签。`}</p>
        </ConfirmDialog>
      )}
    </>
  )
}
