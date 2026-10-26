// 打标签的小框内容：页面把它放进 ui/Popover。组件只管展示与交互，标签数据、勾选状态由页面传入，创建与勾选都回调出去。
//
// <Popover trigger={<Button size="sm">标签</Button>} label="打标签" align="end">
//   {({ close }) => <TagPicker tags={tags} checked={checkedIds} onToggle={(tag, on) => change(tag, on)}
//     onCreate={createTag} onManage={() => { close(); setManaging(true) }} />}
// </Popover>
//
// - tags 是这一套的全部标签（带题数）；checked 为全部选中的题都有的标签，mixed 为只有部分题有的（批量时显示半选，点一下变全选）。
// - 顶部输入框「搜索或新建标签」：按包含过滤；规整后非空且没有同名（不分英文大小写）时，列表顶部出现「新建「X」」，
//   回车或点击即 onCreate，拿到标签后立刻 onToggle(tag, true)；已有同名则不新建，回车直接勾上那个；超过 20 字时提示并禁止新建。
// - 键盘：↑↓ 移动高亮，回车切换（输入法组词中的回车不算）。列表最高约 6.5 行，再多内部滚动。
// - unit 决定计数的单位（悬停提示）：题目标签用「道题」，试卷标签用「份试卷」。
// - 批量时传 counts（每个标签在所选里有几道）与 selectionSize（所选总数），行上显示所选里的数，不显示全库数。
// - allowCreate 为 false 时只能在已有标签里勾选（「去标签」用）：没有「新建」行，输入框只用来搜索，onCreate 不会被调用。
import { useId, useMemo, useRef, useState, type FocusEvent } from 'react'
import { TAG_NAME_MAX, classNameLength, cleanClassName, normalizeClassName, type Tag, type TagRef } from '@shared/classify'
import { IconPlus, IconSearch } from '../../icons'
import { Button, Checkbox, TextInput, cx, errorMessage, toast } from '../ui'
import './classify.css'

export interface TagPickerProps {
  tags: Tag[]
  checked: ReadonlySet<number>
  mixed?: ReadonlySet<number>
  onToggle(tag: TagRef, next: boolean): void
  onCreate?(name: string): Promise<TagRef>
  onManage?(): void
  unit?: '道题' | '份试卷'
  allowCreate?: boolean
  counts?: ReadonlyMap<number, number>
  selectionSize?: number
}

// 与数据库一致：同名只折叠 ASCII 大小写（中文、全角字母不转换）
const asciiFold = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase())

type Row = { key: string; kind: 'new'; name: string } | { key: string; kind: 'tag'; tag: Tag }

function buildRows(tags: Tag[], query: string, allowCreate: boolean): { rows: Row[]; exact: Tag | undefined; tooLong: boolean } {
  const full = cleanClassName(query)
  const tooLong = allowCreate && classNameLength(full) > TAG_NAME_MAX
  const name = normalizeClassName(query, TAG_NAME_MAX)
  const exact = name && !tooLong ? tags.find((t) => asciiFold(t.name) === asciiFold(name)) : undefined
  const needle = full.toLowerCase()
  const matched = needle ? tags.filter((t) => t.name.toLowerCase().includes(needle)) : tags
  const rows: Row[] = []
  if (allowCreate && name && !tooLong && !exact) rows.push({ key: 'new', kind: 'new', name })
  for (const tag of matched) rows.push({ key: `tag-${tag.id}`, kind: 'tag', tag })
  return { rows, exact, tooLong }
}

export function TagPicker({ tags, checked, mixed, onToggle, onCreate, onManage, unit = '道题', allowCreate = true, counts, selectionSize }: TagPickerProps) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null) // 键盘或鼠标移到的行
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const creatable = allowCreate && onCreate !== undefined
  const { rows, exact, tooLong } = useMemo(() => buildRows(tags, query, creatable), [tags, query, creatable])
  // 没动过键盘时，输入了字就默认高亮同名标签，没有同名则是「新建」或第一个匹配项，回车直接生效
  const fallback = query.trim() ? (exact ? `tag-${exact.id}` : (rows[0]?.key ?? null)) : null
  const active = picked !== null && rows.some((r) => r.key === picked) ? picked : fallback
  const optionId = (key: string): string => `${listId}-${key}`

  const toggle = (tag: Tag): void => onToggle(tag, mixed?.has(tag.id) ? true : !checked.has(tag.id))

  const create = async (name: string): Promise<void> => {
    if (busyRef.current || !onCreate) return
    busyRef.current = true
    setBusy(true)
    try {
      const tag = await onCreate(name)
      onToggle(tag, true)
      setQuery('')
      setPicked(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const choose = (row: Row, via: 'key' | 'click'): void => {
    if (row.kind === 'new') {
      void create(row.name)
    } else if (via === 'key' && exact?.id === row.tag.id && query.trim() && checked.has(row.tag.id) && !mixed?.has(row.tag.id)) {
      // 输入了完整的名字回车 = 想要这个标签；已经勾着就不再取消
      setQuery('')
      setPicked(null)
    } else {
      toggle(row.tag)
      if (via === 'key' && exact?.id === row.tag.id && query.trim()) {
        setQuery('')
        setPicked(null)
      }
    }
  }

  // 点行时浏览器会把焦点带到行里的勾选框；拉回输入框，键盘（↑↓ 回车）不断
  const keepFocusInSearch = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.target !== searchRef.current) searchRef.current?.focus({ preventScroll: true })
  }

  const move = (delta: 1 | -1): void => {
    if (rows.length === 0) return
    const at = rows.findIndex((r) => r.key === active)
    const next = at === -1 ? (delta === 1 ? 0 : rows.length - 1) : (at + delta + rows.length) % rows.length
    setPicked(rows[next].key)
    document.getElementById(optionId(rows[next].key))?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div ref={rootRef} className="cf-picker">
      <div className="cf-picker-search">
        <TextInput
          ref={searchRef}
          value={query}
          onChange={(next) => {
            setQuery(next)
            setPicked(null)
          }}
          leading={<IconSearch size={16} />}
          clearable
          placeholder={creatable ? '搜索或新建标签' : '搜索标签'}
          aria-label="搜索或新建标签"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-autocomplete="list"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return // 输入法组词中的回车、方向键归输入法
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              move(event.key === 'ArrowDown' ? 1 : -1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const row = rows.find((r) => r.key === active)
              if (row) choose(row, 'key')
            }
          }}
        />
      </div>
      {tooLong && (
        <p className="cf-warn" role="alert">
          标签名最多 {TAG_NAME_MAX} 字
        </p>
      )}
      <div id={listId} className="cf-picker-list" role="listbox" aria-multiselectable="true" aria-label="标签" onMouseDown={(event) => event.preventDefault()} onFocus={keepFocusInSearch}>
        {rows.length === 0 && !tooLong && <p className="cf-picker-empty">{tags.length === 0 ? (creatable ? '还没有标签，输入名称回车新建' : unit === '份试卷' ? '所选试卷都没有标签' : '所选题目都没有标签') : '没有匹配的标签'}</p>}
        {rows.map((row) => {
          if (row.kind === 'new') {
            return (
              <div key={row.key} id={optionId(row.key)} role="option" aria-selected="false" aria-disabled={busy || undefined} className={cx('cf-prow cf-prow--new', active === row.key && 'is-active')} onMouseMove={() => setPicked(row.key)} onClick={() => choose(row, 'click')}>
                <IconPlus size={16} />
                <span className="cf-prow-name">
                  新建「<b>{row.name}</b>」
                </span>
              </div>
            )
          }
          const { tag } = row
          const isMixed = !checked.has(tag.id) && Boolean(mixed?.has(tag.id))
          const isChecked = checked.has(tag.id)
          return (
            <div
              key={row.key}
              id={optionId(row.key)}
              role="option"
              aria-selected={isChecked}
              aria-checked={isMixed ? 'mixed' : isChecked}
              className={cx('cf-prow', active === row.key && 'is-active')}
              onMouseMove={() => setPicked(row.key)}
            >
              <Checkbox checked={isChecked} indeterminate={isMixed} tabIndex={-1} aria-hidden="true" onChange={(next) => onToggle(tag, next)}>
                <span className="cf-prow-name" title={tag.name}>
                  {tag.name}
                </span>
                {counts && selectionSize !== undefined ? (
                  <em title={`所选 ${selectionSize} ${unit[0]}中 ${counts.get(tag.id) ?? 0} ${unit[0]}已有`}>{counts.get(tag.id) ?? 0}</em>
                ) : (
                  <em title={`${tag.count} ${unit}`}>{tag.count}</em>
                )}
              </Checkbox>
            </div>
          )
        })}
      </div>
      {onManage && (
        <div className="cf-picker-foot">
          <Button variant="link" size="sm" onClick={onManage}>
            管理标签
          </Button>
        </div>
      )}
    </div>
  )
}
