// 新建分类、分类改名的弹窗。新建时旁边有「常用名」下拉（已有的不再列），也可直接输入；
// 名称按 normalizeClassName 规整，超过 30 字不允许提交（不静默截断）；接口报错（如重名）把中文原因原样显示在输入框下面。
import { useRef, useState } from 'react'
import { CATEGORY_PRESETS, CLASS_NAME_MAX, classNameLength, cleanClassName, type PaperCategory } from '@shared/classify'
import { IconChevronDown } from '../../icons'
import { errorMessage } from '../library/format'
import { Button, Menu, Modal, TextInput } from '../ui'
import './papers.css'

// 与数据库一致：同名只折叠 ASCII 大小写
const asciiFold = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase())

export interface CategoryDialogProps {
  /** 改名时传入被改的分类 */
  category?: PaperCategory
  /** 已有分类名，用来把已建过的常用名从下拉里去掉 */
  existingNames: string[]
  /** 抛错时弹窗不关，显示 errorMessage */
  onSubmit(name: string): Promise<void>
  onClose(): void
}

export function CategoryDialog({ category, existingNames, onSubmit, onClose }: CategoryDialogProps) {
  const renaming = category !== undefined
  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const clean = cleanClassName(name)
  const tooLong = classNameLength(clean) > CLASS_NAME_MAX
  const presets = renaming ? [] : CATEGORY_PRESETS.filter((preset) => !existingNames.some((existing) => asciiFold(existing) === asciiFold(preset)))

  const submit = async (): Promise<void> => {
    if (!clean || tooLong || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(clean)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const problem = tooLong ? `分类名最多 ${CLASS_NAME_MAX} 字` : error

  return (
    <Modal
      title={renaming ? '分类改名' : '新建分类'}
      size="sm"
      locked={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={busy || !clean || tooLong} onClick={() => void submit()}>
            {renaming ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <div className="pp-field">
        <label htmlFor="pp-category-name">分类名称</label>
        <div className="pp-name-row">
          <TextInput
            id="pp-category-name"
            ref={inputRef}
            value={name}
            onChange={(next) => {
              setName(next)
              setError(null)
            }}
            invalid={Boolean(problem)}
            placeholder="例如：周测"
            data-autofocus=""
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
            }}
          />
          {presets.length > 0 && (
            <Menu
              label="常用分类名"
              align="end"
              trigger={
                <Button iconAfter={<IconChevronDown size={16} />} aria-label="选用常用分类名">
                  常用名
                </Button>
              }
              items={presets.map((preset) => ({
                label: preset,
                onSelect: () => {
                  setName(preset)
                  setError(null)
                  inputRef.current?.focus()
                }
              }))}
            />
          )}
        </div>
        {problem && (
          <p className="pp-problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  )
}
