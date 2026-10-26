// 题干 / 答案的就地编辑区（contenteditable）。
// 载入后不再由 React 回写 DOM，内容变化时把净化后的 HTML 交给 onChange；输入法组合过程中不会被打断。
import { useLayoutEffect, useRef, useState } from 'react'
import { errorMessage } from './format'
import { fromEditable, toEditableHtml } from './html'

interface Props {
  html: string
  firstNo: number
  label: string
  onChange(html: string): void
  onError(message: string): void
  testId?: string
  autoFocus?: boolean // 挂载后把光标放到末尾（从「添加答案」进入时用）
}

interface SelectedImage {
  node: HTMLImageElement
  left: number
  top: number
}

const REPLACE_MAX_WIDTH = 480

export default function EditableHtml({ html, firstNo, label, onChange, onError, testId, autoFocus }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef(html)
  const [selected, setSelected] = useState<SelectedImage | null>(null)

  // 只在挂载时写入一次
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.innerHTML = toEditableHtml(html, firstNo)
    // 回车新建 <p> 而不是 <div>，与入库内容的结构一致
    document.execCommand('defaultParagraphSeparator', false, 'p')
    if (autoFocus) {
      root.focus({ preventScroll: false })
      const range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }

    // 小题号占位符是题号重排的依据，不允许被选中删除或覆盖。
    // 必须用原生 beforeinput：React 的 onBeforeInput 是 textInput 的封装，删除类操作根本不会触发。
    const guard = (event: InputEvent): void => {
      for (const target of event.getTargetRanges()) {
        const range = document.createRange()
        range.setStart(target.startContainer, target.startOffset)
        range.setEnd(target.endContainer, target.endOffset)
        if (range.cloneContents().querySelector('[data-ewb-qno]')) return event.preventDefault()
      }
    }
    root.addEventListener('beforeinput', guard)
    return () => root.removeEventListener('beforeinput', guard)
  }, [])

  const emit = (): void => {
    const root = rootRef.current
    if (!root) return
    const next = fromEditable(root)
    if (next === lastEmitted.current) return
    lastEmitted.current = next
    onChange(next)
  }

  const select = (node: HTMLImageElement | null): void => {
    rootRef.current?.querySelectorAll('.ewb-img-selected').forEach((n) => n.classList.remove('ewb-img-selected'))
    const wrap = wrapRef.current
    if (!node || !wrap) return setSelected(null)
    node.classList.add('ewb-img-selected')
    const box = wrap.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    setSelected({ node, left: Math.max(0, rect.left - box.left), top: Math.max(0, rect.top - box.top - 34) })
  }

  const removeImage = (): void => {
    selected?.node.remove()
    select(null)
    emit()
  }

  const replaceImage = async (): Promise<void> => {
    const node = selected?.node
    if (!node) return
    try {
      const url = await window.workbench.papers.pickImage()
      if (!url) return
      // 先量好新图的尺寸再换，避免旧图的宽高套在新图上变形
      const probe = new Image()
      probe.onload = () => {
        const scale = Math.min(1, REPLACE_MAX_WIDTH / probe.naturalWidth)
        node.setAttribute('width', String(Math.max(1, Math.round(probe.naturalWidth * scale))))
        node.setAttribute('height', String(Math.max(1, Math.round(probe.naturalHeight * scale))))
        node.setAttribute('src', url)
        select(node)
        emit()
      }
      probe.onerror = () => onError('这张图片无法显示，请换一张')
      probe.src = url
    } catch (error) {
      onError(errorMessage(error))
    }
  }

  return (
    <div className="editable-wrap" ref={wrapRef}>
      <div
        ref={rootRef}
        className="question-html editable"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-testid={testId}
        spellCheck={false}
        onInput={() => {
          emit()
          if (selected && !selected.node.isConnected) setSelected(null)
        }}
        onPaste={(event) => {
          // 外部复制来的格式、图片、链接一律不要，只收纯文字
          event.preventDefault()
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
        }}
        onDrop={(event) => event.preventDefault()}
        onClick={(event) => {
          const target = event.target as HTMLElement
          select(target instanceof HTMLImageElement ? target : null)
        }}
        onBlur={(event) => {
          if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) select(null)
        }}
      />
      {selected && (
        <div className="img-toolbar" style={{ left: selected.left, top: selected.top }} onMouseDown={(event) => event.preventDefault()}>
          <button type="button" onClick={() => void replaceImage()}>
            换成本地图片…
          </button>
          <button type="button" className="danger-text" onClick={removeImage}>
            删除图片
          </button>
        </div>
      )}
    </div>
  )
}
