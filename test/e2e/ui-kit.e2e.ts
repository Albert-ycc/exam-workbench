// 通用组件端到端测试（方向 C 组件库）：把 src/renderer/src/components/ui 的全部组件打成一个只用于测试的样张页，
// 放进应用主窗口（带真实预加载接口），不进正式界面。
// 一、样张截图：每类组件的常态 / 悬停 / 聚焦 / 禁用 / 危险态（悬停与聚焦用 CDP 强制伪类，一张图里排开）
// 二、行为断言：弹窗焦点锁定与背景 inert、Esc 与焦点归还、Toast 合并与避让弹窗、菜单键盘操作、
//    Select 长文字不撑宽、NumberInput 清空与步长、Drawer 停靠不盖主内容、usePersistentState 持久化与容错
// 用法：node test/e2e/ui-kit.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Locator, Page } from 'playwright'
import { build } from 'vite'
import { buildTo, launchApp, ROOT } from '../../scripts/e2e/app.ts'
import { evidenceDir } from '../../scripts/temp-dir.ts'

const evidence = evidenceDir(process.argv[2], 'ewb-ui-kit-')

// ---------- 样张页 ----------
const harness = join(ROOT, 'node_modules/.cache/ewb-ui-harness')
rmSync(harness, { recursive: true, force: true })
mkdirSync(join(harness, 'src'), { recursive: true })
writeFileSync(
  join(harness, 'src/index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>组件样张</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ewb-asset:" />
</head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`
)
writeFileSync(
  join(harness, 'src/gallery.css'),
  String.raw`
.g-root { height: 100%; overflow: auto; padding: 20px 28px 60px; background: var(--desk); }
.g-sec { background: var(--paper); border: 1px solid var(--rule); padding: 14px 20px 18px; margin: 0 0 16px; width: 1080px; }
.g-sec > h3 { margin: 0 0 10px; font: 700 15px var(--song); letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid var(--ink); }
.g-grid { display: grid; grid-template-columns: 110px repeat(4, minmax(0, 1fr)); gap: 10px 14px; align-items: center; }
.g-grid > * { justify-self: start; }
.g-grid > .g-h { font-size: 12px; color: var(--mute); }
.g-grid > .g-k { font-size: 12px; color: var(--ink-2); }
.g-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
.g-row > .g-k { width: 110px; font-size: 12px; color: var(--ink-2); flex: 0 0 auto; }
.g-bar { display: flex; align-items: center; gap: 14px; height: 56px; padding: 0 22px; border-bottom: 1px solid var(--rule); background: var(--paper); }
.g-bar .sp { margin-left: auto; display: flex; gap: 8px; }
.g-saved { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink-2); white-space: nowrap; }
.g-libhead { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--mute); }
.g-libhead .src { margin-left: auto; }
.g-stem { font: 14.5px/1.75 var(--song); margin: 4px 0 0 28px; }
.g-sechead { font: 700 16px var(--song); display: flex; align-items: center; gap: 2px; }
.g-drop { position: relative; height: 26px; width: 560px; }
.g-drop .ln { position: absolute; left: 28px; right: 120px; top: 12px; border-top: 1.6px solid var(--red); }
.g-drop .rn { position: absolute; right: 0; top: 0; }
.g-drop .ui-mark { position: absolute; left: 0; top: 0; }
.g-dock { display: flex; height: 220px; border: 1px solid var(--rule); background: var(--desk); }
.g-dock main { flex: 1; min-width: 0; padding: 16px; }
.g-wide-body { padding: 18px 24px; line-height: 2; }
.g-narrow { width: 220px; }
`
)

writeFileSync(
  join(harness, 'src/main.tsx'),
  String.raw`import { Fragment, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Button, IconButton, Modal, ConfirmDialog, Drawer, ToastHost, toast, Menu, Popover, Tag, Segmented, TextInput, Select, NumberInput, Checkbox,
  EmptyState, RedTick, RedPen, RedCaret, CircledNote, usePersistentState
} from '../../../../src/renderer/src/components/ui'
import {
  IconDownload, IconSave, IconHistory, IconBack, IconUp, IconDown, IconTrash, IconMore, IconChevronDown, IconSearch, IconPlus, IconCheck, IconGrip
} from '../../../../src/renderer/src/icons'
import '../../../../src/renderer/src/styles.css'
import './gallery.css'

const LONG = '山东德州市庆云县东郎务中学2026-2027学年七年级第一学期10月学情自测数学试题（含答案解析与评分标准）'
const SOURCES = [
  { value: 0, label: '全部来源卷' },
  { value: 1, label: LONG },
  { value: 2, label: '样例中学2026-2027学年七年级上学期阶段检测英语试题' }
]
const FORMATS = [{ value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'DOCX' }]

function Gallery() {
  const [log, setLog] = useState<string[]>([])
  const say = (text: string) => setLog((list) => [...list, text])
  const [text, setText] = useState('绝对值')
  const [empty, setEmpty] = useState('')
  const [title, setTitle] = useState('七年级上册第一单元测试')
  const [source, setSource] = useState(0)
  const [longSource, setLongSource] = useState(1)
  const [narrow, setNarrow] = useState(0)
  const [score, setScore] = useState<number | null>(4)
  const [score2, setScore2] = useState<number | null>(null)
  const [calls, setCalls] = useState(0)
  const [inlineScore, setInlineScore] = useState<number | null>(4)
  const [format, setFormat] = useState('pdf')
  const [seg2, setSeg2] = useState('a')
  const [checked, setChecked] = useState(true)
  const [modal, setModal] = useState<'' | 'basic' | 'wide' | 'locked' | 'small'>('')
  const [confirm, setConfirm] = useState<'' | 'danger' | 'plain'>('')
  const [busy, setBusy] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [remembered, setRemembered] = usePersistentState('ewb.test.probe', '初始值')
  const [session, setSession] = usePersistentState<number>('ewb.test.session', 0, { storage: 'session' })
  const [validated] = usePersistentState<string>('ewb.test.validated', 'fallback', { validate: (v): v is string => typeof v === 'string' })
  const [delayed, setDelayed] = usePersistentState('ewb.test.delayed', '', { delay: 400 })
  const items = [
    { label: '上移', icon: <IconUp size={16} />, onSelect: () => say('menu:上移') },
    { label: '下移', disabled: true, icon: <IconDown size={16} />, onSelect: () => say('menu:下移') },
    { label: '移到第 2 大题', onSelect: () => say('menu:移到第 2 大题') },
    'separator' as const,
    { label: '删除', danger: true, icon: <IconTrash size={16} />, hint: 'Del', onSelect: () => setConfirm('danger') }
  ]
  const force = (state: string) => ({ 'data-force': state })

  return (
    <div className="g-root" id="gallery">
      <section className="g-sec" data-gallery="buttons">
        <h3>按钮</h3>
        <div className="g-grid">
          <span />
          <span className="g-h">常态</span>
          <span className="g-h">悬停</span>
          <span className="g-h">聚焦（键盘）</span>
          <span className="g-h">禁用</span>
          {(['default', 'primary', 'danger', 'ghost', 'link', 'danger-ghost'] as const).map((variant) => (
            <Fragment key={variant}>
              <span className="g-k">{variant}</span>
              <Button variant={variant}>确认操作</Button>
              <Button variant={variant} {...force('hover')}>确认操作</Button>
              <Button variant={variant} {...force('focus')}>确认操作</Button>
              <Button variant={variant} disabled>确认操作</Button>
            </Fragment>
          ))}
          <span className="g-k">带图标 / 角标</span>
          <Button icon={<IconSave size={16} />} dot="有改动未存为版本">存为版本</Button>
          <Button variant="primary" icon={<IconDownload size={16} />}>下载</Button>
          <Button icon={<IconHistory size={16} />}>版本历史</Button>
          <Button iconAfter={<IconChevronDown size={16} />}>加入试卷</Button>
          <span className="g-k">小号 sm</span>
          <Button size="sm">展开</Button>
          <Button size="sm" variant="primary">加入</Button>
          <Button size="sm" variant="danger">确认删除</Button>
          <Button size="sm" variant="danger-ghost" icon={<IconTrash size={16} />}>删除</Button>
          <span className="g-k">图标按钮</span>
          <IconButton label="上移" icon={<IconUp size={16} />} />
          <IconButton label="下移" icon={<IconDown size={16} />} {...force('hover')} />
          <IconButton label="删除大题" variant="danger-ghost" icon={<IconTrash size={16} />} {...force('focus')} />
          <IconButton label="已禁用" icon={<IconUp size={16} />} disabled />
          <span className="g-k">开关 pressed</span>
          <IconButton label="收起题库栏" pressed icon={<IconGrip size={16} />} />
          <Button aria-pressed="true">仅看未加入</Button>
        </div>
      </section>

      <section className="g-sec" data-gallery="form">
        <h3>表单控件</h3>
        <div className="g-grid">
          <span />
          <span className="g-h">常态</span>
          <span className="g-h">悬停</span>
          <span className="g-h">聚焦</span>
          <span className="g-h">禁用 / 无效</span>
          <span className="g-k">TextInput</span>
          <TextInput value={text} onChange={setText} aria-label="关键词" />
          <TextInput value={text} onChange={setText} aria-label="关键词悬停" {...force('hover')} />
          <TextInput value={text} onChange={setText} aria-label="关键词聚焦" {...force('focus')} />
          <TextInput value={text} onChange={setText} aria-label="关键词禁用" disabled />
          <span className="g-k">带图标 / 清除</span>
          <TextInput value={text} onChange={setText} aria-label="搜索" leading={<IconSearch size={16} />} clearable placeholder="题干关键词" />
          <TextInput value={empty} onChange={setEmpty} aria-label="空搜索" leading={<IconSearch size={16} />} placeholder="题干关键词" />
          <TextInput value={empty} onChange={setEmpty} aria-label="无效" invalid placeholder="不能为空" />
          <TextInput value={text} onChange={setText} aria-label="小号" size="sm" />
          <span className="g-k">underline（卷面）</span>
          <TextInput variant="underline" value={title} onChange={setTitle} aria-label="试卷标题" style={{ font: '700 18px var(--song)', width: 260 }} />
          <TextInput variant="underline" value="选择题" onChange={() => undefined} aria-label="大题名" style={{ font: '700 16px var(--song)', width: 90 }} />
          <TextInput variant="underline" value="填空题" onChange={() => undefined} aria-label="大题名聚焦" style={{ font: '700 16px var(--song)', width: 90 }} {...force('focus')} />
          <span />
          <span className="g-k">Select</span>
          <Select value={source} onChange={setSource} options={SOURCES} aria-label="来源卷" />
          <Select value={longSource} onChange={setLongSource} options={SOURCES} aria-label="长文字来源卷" />
          <Select value={0} onChange={() => undefined} options={SOURCES} aria-label="聚焦来源卷" />
          <Select value={0} onChange={() => undefined} options={SOURCES} disabled aria-label="禁用来源卷" />
          <span className="g-k">NumberInput</span>
          <NumberInput value={score} onChange={(v) => { setScore(v); setCalls((n) => n + 1) }} min={0.5} unit="分" aria-label="每小题分值" />
          <NumberInput value={score2} onChange={setScore2} stepper aria-label="未设分值" placeholder="未设" />
          <NumberInput value={3.5} onChange={() => undefined} invalid aria-label="无效分值" />
          <NumberInput value={4} onChange={() => undefined} disabled aria-label="禁用分值" />
          <span className="g-k">Checkbox</span>
          <Checkbox checked={checked} onChange={setChecked}>学生版和教师版各一份</Checkbox>
          <Checkbox checked={false} onChange={() => undefined} {...force('hover')}>未选中（悬停）</Checkbox>
          <Checkbox checked={false} indeterminate onChange={() => undefined} {...force('focus')}>部分选中（聚焦）</Checkbox>
          <Checkbox checked disabled onChange={() => undefined}>已加入（禁用）</Checkbox>
          <span className="g-k">Segmented</span>
          <Segmented label="文件格式" value={format} onChange={setFormat} options={FORMATS} />
          <Segmented label="答案位置" value={seg2} onChange={setSeg2} options={[{ value: 'a', label: '卷尾' }, { value: 'b', label: '题后' }, { value: 'c', label: '不显示', disabled: true }]} />
          <Segmented label="整组禁用" value="pdf" onChange={() => undefined} options={FORMATS} disabled />
          <Segmented label="小号" size="sm" value="pdf" onChange={() => undefined} options={FORMATS} />
          <span className="g-k">选中态悬停</span>
          <Checkbox checked onChange={() => undefined} {...force('hover')}>已选中（悬停）</Checkbox>
          <Segmented label="悬停选中项" value="pdf" onChange={() => undefined} options={FORMATS} />
          <Button aria-pressed="true" {...force('hover')}>仅看未加入（按下）</Button>
          <TextInput value="" onChange={() => undefined} aria-label="无效且悬停" invalid placeholder="无效且悬停" {...force('hover')} />
        </div>
      </section>

      <section className="g-sec" data-gallery="marks">
        <h3>标签 · 红笔记号 · 空状态</h3>
        <div className="g-row">
          <span className="g-k">Tag</span>
          <Tag>单选题</Tag><Tag>解答题-计算题</Tag><Tag tone="plain">无答案</Tag><Tag tone="ok">有答案</Tag><Tag tone="warn">缺答案</Tag><Tag tone="red">已加入</Tag><Tag tone="blue">当前</Tag><Tag size="md">单选题 13px</Tag>
        </div>
        <div className="g-row">
          <span className="g-k">红笔记号</span>
          <RedTick /><RedPen>已加入</RedPen><RedCaret /><CircledNote>有改动未存为版本</CircledNote><RedPen>楷体批注：字号不低于 15px</RedPen>
        </div>
        <div className="g-row" style={{ alignItems: 'flex-start' }}>
          <span className="g-k">EmptyState</span>
          <div style={{ width: 300 }}><EmptyState bordered title="还没有试卷" description="点「新建试卷」，再从试题库里挑题拖进来。" actions={<Button variant="primary" icon={<IconPlus size={16} />}>新建试卷</Button>} /></div>
          <div style={{ width: 300 }}><EmptyState compact title="没有符合条件的题目" description="当前条件：题型「解答题」，关键词「绝对值」" actions={<Button variant="link">清除筛选</Button>} /></div>
        </div>
      </section>

      <section className="g-sec" data-gallery="compose">
        <h3>组合：对照方向 C 编辑器</h3>
        <div className="g-bar">
          <Button variant="ghost" size="sm" icon={<IconBack size={16} />}>试卷库</Button>
          <span style={{ color: 'var(--rule-2)' }}>/</span>
          <TextInput variant="underline" value={title} onChange={setTitle} aria-label="试卷标题2" style={{ font: '700 18px var(--song)', width: 330 }} />
          <span className="g-saved"><IconCheck size={15} />已自动保存 14:32</span>
          <CircledNote>有改动未存为版本</CircledNote>
          <div className="sp">
            <Button icon={<IconSave size={16} />} dot="有改动">存为版本</Button>
            <Button icon={<IconHistory size={16} />}>版本历史</Button>
            <Button variant="primary" icon={<IconDownload size={16} />}>下载</Button>
          </div>
        </div>
        <div style={{ position: 'relative', padding: '10px 16px 8px 38px', borderBottom: '1px solid var(--rule)', width: 560 }}>
          <RedTick style={{ position: 'absolute', left: 10, top: 9 }} />
          <div className="g-libhead"><Tag>单选题</Tag><Tag tone="plain">无答案</Tag><RedPen>已加入</RedPen><span className="src">26-27七年级上·山东德州·阶段检测</span></div>
          <div className="g-stem">下列说法错误的有（　　）个</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="link" size="sm">展开</Button></div>
        </div>
        <div className="g-sechead" style={{ margin: '14px 0 6px 28px' }}>
          一、<TextInput variant="underline" value="选择题" onChange={() => undefined} aria-label="大题名2" style={{ font: 'inherit', width: '3.4em' }} />（共4小题，每题
          <NumberInput variant="inline" value={inlineScore} onChange={setInlineScore} aria-label="每题分值" />分，共16分）
        </div>
        <div className="g-drop"><RedCaret /><span className="ln" /><RedPen className="rn">插入为第 4 题</RedPen></div>
      </section>

      <section className="g-sec" data-gallery="overlays">
        <h3>浮层与交互（行为测试入口）</h3>
        <div className="g-row">
          <span className="g-k">弹窗</span>
          <Button data-testid="open-modal" onClick={() => setModal('basic')}>打开弹窗</Button>
          <Button data-testid="open-wide" onClick={() => setModal('wide')}>打开宽弹窗</Button>
          <Button data-testid="open-small" onClick={() => setModal('small')}>打开小弹窗</Button>
          <Button data-testid="open-locked" onClick={() => { setBusy(true); setModal('locked') }}>打开忙碌弹窗</Button>
          <Button data-testid="open-confirm" variant="danger-ghost" onClick={() => setConfirm('danger')}>删除…</Button>
          <Button data-testid="open-confirm-plain" onClick={() => setConfirm('plain')}>确认…</Button>
        </div>
        <div className="g-row">
          <span className="g-k">Toast</span>
          <Button data-testid="toast-info" onClick={() => toast.show('已存为 v2')}>普通</Button>
          <Button data-testid="toast-undo" onClick={() => toast.show('已删除第 3 题', { action: { label: '撤销', run: () => say('undo:3') } })}>带撤销</Button>
          <Button data-testid="toast-merge" onClick={() => { const n = Math.floor(Math.random() * 90) + 10; toast.show((count) => '已删除 ' + count + ' 道题', { group: 'del-q', action: { label: (count) => (count > 1 ? '撤销全部' : '撤销'), run: () => say('undo:' + n) } }) }}>合并同类</Button>
          <Button data-testid="toast-error" onClick={() => toast.error('保存失败：磁盘空间不足')}>出错</Button>
          <Button data-testid="toast-short" onClick={() => toast.show('一会儿就消失', { ms: 1200 })}>1.2 秒</Button>
        </div>
        <div className="g-row">
          <span className="g-k">菜单</span>
          <Menu trigger={<IconButton data-testid="menu-more" label="更多操作" icon={<IconMore size={16} />} />} items={items} align="end" label="题目操作" />
          <Menu trigger={<Button data-testid="menu-add" iconAfter={<IconChevronDown size={16} />}>加入试卷</Button>} items={[{ label: '一、选择题', onSelect: () => say('add:1') }, { label: '二、填空题', onSelect: () => say('add:2') }, 'separator', { label: '新建大题', onSelect: () => say('add:new') }]} />
          <Popover trigger={<Button data-testid="pop-open" iconAfter={<IconChevronDown size={16} />}>试卷结构</Button>} label="试卷结构">
            {({ close }) => (
              <div style={{ padding: 12, display: 'grid', gap: 8, width: 220 }}>
                <span>一、选择题　4 题　16 分</span>
                <TextInput value={text} onChange={setText} aria-label="浮层内输入" />
                <Button size="sm" onClick={() => { say('pop:close'); close() }}>跳到该题</Button>
              </div>
            )}
          </Popover>
          <Menu trigger={<Button data-testid="menu-bottom">贴底菜单</Button>} items={items.slice(0, 3)} placement="bottom" />
        </div>
        <div className="g-row">
          <span className="g-k">抽屉</span>
          <Button data-testid="open-drawer" onClick={() => setDrawer(true)}>版本历史</Button>
        </div>
        <div className="g-dock" data-testid="dock">
          <main data-testid="dock-main">试卷主内容区（抽屉打开时被挤窄，不被盖住）<br /><span data-testid="dock-edge">右边缘标记</span></main>
          <Drawer open={drawer} title="版本历史" width={300} onClose={() => setDrawer(false)}>
            <p style={{ margin: 0 }}>v2　3 个大题 · 21 题 · 100 分</p>
            <p>v1　3 个大题 · 18 题 · 80 分</p>
            <Button size="sm" data-testid="drawer-inner">恢复此版本</Button>
          </Drawer>
        </div>
        <div className="g-row">
          <span className="g-k">定宽 Select</span>
          <div className="g-narrow"><Select value={narrow} onChange={setNarrow} options={SOURCES} aria-label="定宽来源卷" /></div>
        </div>
        <div className="g-row">
          <span className="g-k">usePersistentState</span>
          <TextInput className="g-narrow" value={remembered} onChange={setRemembered} aria-label="记住的值" />
          <Button data-testid="session-bump" onClick={() => setSession((n) => n + 1)}>会话计数 {session}</Button>
          <TextInput className="g-narrow" value={delayed} onChange={setDelayed} aria-label="防抖写入" />
          <span data-testid="validated">{validated}</span>
          <Button data-testid="break-storage" onClick={() => {
            Storage.prototype.setItem = () => { throw new Error('quota') }
            Storage.prototype.getItem = () => { throw new Error('denied') }
            say('storage:broken')
          }}>让存储抛异常</Button>
        </div>
        <output data-testid="log">{log.join('|')}</output>
        <output data-testid="num-calls">{calls}</output>
      </section>

      {modal === 'basic' && (
        <Modal title="重命名试卷" onClose={() => setModal('')} footer={<><Button variant="ghost" onClick={() => setModal('')}>取消</Button><Button variant="primary" onClick={() => setModal('')}>保存</Button></>}>
          <div style={{ display: 'grid', gap: 12 }}>
            <TextInput value={title} onChange={setTitle} aria-label="试卷标题3" />
            <Select value={source} onChange={setSource} options={SOURCES} aria-label="来源卷2" />
            <Checkbox checked={checked} onChange={setChecked}>创建后立即打开</Checkbox>
            <Menu trigger={<Button data-testid="modal-menu" size="sm" iconAfter={<IconChevronDown size={16} />}>弹窗内菜单</Button>} items={[{ label: '复制试卷', onSelect: () => say('modal-menu:copy') }, { label: '删除试卷', danger: true, onSelect: () => setConfirm('danger') }]} />
          </div>
        </Modal>
      )}
      {modal === 'small' && (
        <Modal title="已存为版本" size="sm" onClose={() => setModal('')} footer={<Button variant="primary" onClick={() => setModal('')}>知道了</Button>}>
          <p>当前草稿已保存为 v2。</p>
        </Modal>
      )}
      {modal === 'wide' && (
        <Modal title="版本预览 v2" size="wide" flush onClose={() => setModal('')} footer={<><Button variant="ghost" onClick={() => setModal('')}>关闭</Button><Button variant="primary" onClick={() => setModal('')}>恢复此版本</Button></>}>
          <div className="g-wide-body">{Array.from({ length: 40 }, (_, i) => <div key={i}>第 {i + 1} 题　下列说法错误的有（　　）个</div>)}</div>
        </Modal>
      )}
      {modal === 'locked' && (
        <Modal title="正在生成 PDF" locked={busy} onClose={() => setModal('')} footer={<Button data-testid="locked-done" disabled={busy} onClick={() => setModal('')}>完成</Button>}>
          <p>生成中，请稍候…</p>
          <Button data-testid="locked-release" size="sm" onClick={() => setBusy(false)}>模拟生成结束</Button>
        </Modal>
      )}
      <ConfirmDialog open={confirm === 'danger'} title="删除试卷" danger confirmLabel="删除" onClose={() => setConfirm('')} onConfirm={() => { say('confirm:delete'); setConfirm('') }}>
        <p>删除后，这份试卷和它的全部版本一并删除，无法恢复。</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'plain'} title="恢复到 v1" confirmLabel="恢复" onClose={() => setConfirm('')} onConfirm={() => { say('confirm:restore'); setConfirm('') }}>
        <p>当前 21 题 100 分 → v1 18 题 80 分。恢复前会先把当前草稿存成新版本。</p>
      </ConfirmDialog>
      <ToastHost />
    </div>
  )
}
;(window as unknown as { __toast: typeof toast; __undo: string[] }).__toast = toast
;(window as unknown as { __undo: string[] }).__undo = []
createRoot(document.getElementById('root')!).render(<Gallery />)
`
)
await build({
  root: join(harness, 'src'),
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@shared': join(ROOT, 'src/shared') } },
  build: { outDir: join(harness, 'dist'), emptyOutDir: true }
})

buildTo('out-uibase')
const { app, window } = await launchApp({ outDir: 'out-uibase' })
const pageErrors: string[] = []
window.on('pageerror', (error) => pageErrors.push('pageerror: ' + error.message))
window.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push('console: ' + message.text())
})
let steps = 0
const ok = (name: string): void => {
  steps++
  console.log('  ✓ ' + name)
}
const shot = (locator: Locator | Page, name: string) => locator.screenshot({ path: join(evidence, `kit-${name}.png`) })
const byId = (id: string): Locator => window.getByTestId(id)
const logText = async (): Promise<string> => (await byId('log').innerText()).trim()
const active = (): Promise<string> =>
  window.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return 'none'
    return el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName
  })
const settle = (ms = 120) => window.waitForTimeout(ms)

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), join(harness, 'dist/index.html'))
  await window.locator('#gallery').waitFor()
  const size = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  assert.ok(size.w >= 1400 && size.h >= 860, '窗口内容区应接近 1440×900，实际 ' + JSON.stringify(size))

  // ---------- 一、样张截图 ----------
  // ---------- 选中 / 按下 / 无效 状态下悬停，不能被悬停底色盖掉 ----------
  const css = (locator: Locator, props: string[]): Promise<Record<string, string>> =>
    locator.evaluate((el, list) => Object.fromEntries(list.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])), props)
  const BB = 'rgb(31, 58, 104)'
  const checkedBox = window.getByRole('checkbox', { name: '已选中（悬停）' })
  await window.getByText('已选中（悬停）').scrollIntoViewIfNeeded()
  assert.equal((await css(checkedBox, ['background-color']))['background-color'], BB, '勾选态未悬停：蓝黑底')
  await checkedBox.hover({ force: true })
  assert.equal((await css(checkedBox, ['background-color']))['background-color'], BB, '勾选态鼠标停在框上：底色仍是蓝黑，白勾看得见')
  await window.getByText('已选中（悬停）').hover()
  assert.equal((await css(checkedBox, ['background-color']))['background-color'], BB, '勾选态鼠标停在文字上：底色仍是蓝黑')
  const partial = window.getByRole('checkbox', { name: '部分选中（聚焦）' })
  await partial.hover({ force: true })
  assert.equal((await css(partial, ['background-color']))['background-color'], BB, '半选态悬停：底色仍是蓝黑')
  const unchecked = window.getByRole('checkbox', { name: '未选中（悬停）' })
  await unchecked.hover({ force: true })
  assert.notEqual((await css(unchecked, ['background-color']))['background-color'], BB, '未选中的框悬停是浅灰，不是蓝黑')
  const selectedSeg = window.getByRole('radiogroup', { name: '悬停选中项' }).locator('label').first()
  await selectedSeg.hover()
  const segStyle = await css(selectedSeg, ['background-color', 'color'])
  assert.deepEqual(segStyle, { 'background-color': BB, color: 'rgb(255, 255, 255)' }, '分段控件选中项悬停：蓝黑底白字')
  const pressed = window.getByRole('button', { name: '仅看未加入（按下）' })
  await pressed.hover()
  const pressedStyle = await css(pressed, ['background-color', 'border-top-color'])
  assert.deepEqual(pressedStyle, { 'background-color': 'rgb(235, 240, 247)', 'border-top-color': BB }, '按下态按钮悬停：仍是浅蓝底蓝黑框')
  const invalidInput = window.locator('.ui-input.is-invalid').filter({ has: window.getByLabel('无效且悬停') })
  await invalidInput.hover()
  assert.equal((await css(invalidInput, ['border-top-color']))['border-top-color'], 'rgb(195, 50, 43)', '无效输入框悬停：边框仍是红色')
  await window.mouse.move(700, 4)
  ok('选中 / 半选 / 按下 / 无效状态下鼠标悬停，计算样式仍是选中色（蓝黑底、浅蓝底、红框），未选中的框悬停才是浅灰')

  // 悬停与聚焦：用 CDP 强制伪类，在同一张图里排开；聚焦同时强制 focus-visible 与祖先的 focus-within
  const cdp = await window.context().newCDPSession(window)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  await window.evaluate(() => {
    // 没有透传 data-* 的组件，按选择器补上标记
    const mark = (selector: string, value: string): void => document.querySelector(selector)?.setAttribute('data-force', value)
    mark('select[aria-label="长文字来源卷"]', 'hover')
    mark('select[aria-label="聚焦来源卷"]', 'focus')
    mark('input[aria-label="每小题分值"]', 'focus')
    mark('[role="radiogroup"][aria-label="答案位置"] label:nth-child(1) input', 'focus')
    mark('[role="radiogroup"][aria-label="文件格式"] label:nth-child(2)', 'hover')
    // 祖先一并标记：.ui-input 靠 :focus-within / :hover 变样
    document.querySelectorAll('[data-force]').forEach((el) => {
      const state = el.getAttribute('data-force') ?? ''
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (state.includes('focus')) p.setAttribute('data-force-within', '')
        if (state.includes('hover')) p.setAttribute('data-force-hover-anc', '')
      }
    })
  })
  const forceAll = async (): Promise<void> => {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-force], [data-force-within], [data-force-hover-anc]' })
    for (const nodeId of nodeIds) {
      const { attributes } = await cdp.send('DOM.getAttributes', { nodeId })
      const f = attributes.includes('data-force') ? (attributes[attributes.indexOf('data-force') + 1] ?? '') : ''
      const classes: string[] = []
      if (f.includes('hover') || attributes.includes('data-force-hover-anc')) classes.push('hover')
      if (f.includes('focus')) classes.push('focus', 'focus-visible', 'focus-within')
      if (attributes.includes('data-force-within')) classes.push('focus-within')
      if (classes.length) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [...new Set(classes)] })
    }
  }
  await forceAll()
  for (const name of ['buttons', 'form', 'marks', 'compose']) {
    const section = window.locator(`[data-gallery="${name}"]`)
    await section.scrollIntoViewIfNeeded()
    await settle(80)
    await shot(section, `sec-${name}`)
  }
  await window.locator('[data-gallery="form"]').scrollIntoViewIfNeeded()
  await settle(80)
  await shot(window, 'window-1440x900')
  ok('样张截图：按钮 / 表单控件 / 标签与红笔记号 / 编辑器顶栏组合（悬停与聚焦已强制）')


  // ---------- 二、行为断言 ----------
  const dialogOf = (name: string): Locator => window.getByRole('dialog', { name })
  const insideOf = (locator: Locator): Promise<boolean> => locator.evaluate((el) => el.contains(document.activeElement))
  const rootInert = (): Promise<boolean> => window.evaluate(() => (document.getElementById('root') as HTMLElement).inert)
  const rectOf = (locator: Locator) => locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  })
  type Rect = { left: number; top: number; right: number; bottom: number }
  const intersects = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

  // ---- 弹窗：焦点锁定、背景 inert、Esc、焦点归还（S4）----
  await byId('open-modal').focus()
  await window.keyboard.press('Enter')
  let dialog = dialogOf('重命名试卷')
  await dialog.waitFor()
  assert.ok(await insideOf(dialog), '打开后焦点在弹窗内')
  assert.equal(await active(), '试卷标题3', '默认焦点落在正文第一个可聚焦元素')
  assert.equal(await rootInert(), true, '弹窗打开时应用根节点 inert')
  const seen: string[] = []
  for (let i = 0; i < 14; i++) {
    await window.keyboard.press('Tab')
    assert.ok(await insideOf(dialog), `第 ${i + 1} 次 Tab 后焦点仍应在弹窗内，当前：${await active()}`)
    seen.push(await active())
  }
  assert.ok(seen.includes('保存') && seen.includes('关闭') && seen.includes('试卷标题3'), '焦点在弹窗内循环：' + seen.join(' → '))
  assert.ok(!seen.includes('open-modal'), 'Tab 绝不会跳到背后的按钮')
  await dialog.getByRole('button', { name: '关闭' }).focus()
  await window.keyboard.press('Shift+Tab')
  assert.equal(await active(), '保存', '第一项（关闭按钮）上 Shift+Tab 回到最后一项')
  await window.keyboard.press('Tab')
  assert.ok(await insideOf(dialog))
  await shot(window, 'modal-basic')
  await window.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await active(), 'open-modal', '关闭后焦点回到触发按钮')
  assert.equal(await rootInert(), false, '关闭后背景恢复')
  ok('弹窗：焦点锁在弹窗内循环、背景 inert、Esc 关闭、焦点回到触发按钮')

  // 点遮罩关闭；在弹窗里按下、拖到遮罩上松开不算点遮罩
  await byId('open-modal').click()
  await dialog.waitFor()
  const box = await rectOf(dialog.locator('.ui-modal-head h2'))
  await window.mouse.move(box.left + 4, box.top + 4)
  await window.mouse.down()
  await window.mouse.move(6, 6)
  await window.mouse.up()
  assert.equal(await dialog.count(), 1, '从弹窗内拖到遮罩上松开不应关闭')
  await window.mouse.click(6, 6)
  await dialog.waitFor({ state: 'detached' })
  ok('点遮罩关闭；拖选文字时松开在遮罩上不会误关')

  // 弹窗内的菜单 → 确认框（叠两层）：下层 inert，Esc 只关最上层，焦点逐层归还
  await byId('open-modal').click()
  await dialog.waitFor()
  await byId('modal-menu').focus()
  await window.keyboard.press('Enter')
  const modalMenu = window.getByRole('menu')
  await modalMenu.waitFor()
  assert.equal(await active(), '复制试卷', '弹窗里的菜单可以操作（浮层不被背景 inert 挡住）')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  const confirm = dialogOf('删除试卷')
  await confirm.waitFor()
  assert.equal(await active(), '取消', '危险确认框默认焦点在「取消」，回车不会误删')
  const layers = await window.evaluate(() => Array.from(document.querySelectorAll('.ui-backdrop')).map((el) => (el as HTMLElement).inert))
  assert.deepEqual(layers, [true, false], '叠两层时下层弹窗 inert、上层可用')
  await shot(window, 'modal-confirm-danger')
  await window.keyboard.press('Escape')
  await confirm.waitFor({ state: 'detached' })
  assert.equal(await dialog.count(), 1, 'Esc 只关最上层')
  assert.equal(await active(), 'modal-menu', '确认框关闭后焦点回到弹出它的菜单触发按钮')
  assert.equal(await rootInert(), true, '下层弹窗仍开着，背景保持 inert')
  await window.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await active(), 'open-modal')
  ok('叠两层弹窗：下层 inert，Esc 逐层关闭，焦点逐层归还；弹窗内菜单可用')

  // 确认框两种默认焦点
  await byId('open-confirm-plain').click()
  assert.equal(await active(), '恢复', '非危险确认框默认焦点在确认按钮')
  await window.keyboard.press('Enter')
  await dialogOf('恢复到 v1').waitFor({ state: 'detached' })
  assert.ok((await logText()).includes('confirm:restore'))
  await byId('open-confirm').click()
  await window.keyboard.press('Enter')
  await dialogOf('删除试卷').waitFor({ state: 'detached' })
  assert.ok(!(await logText()).includes('confirm:delete'), '危险确认框回车 = 取消')
  await byId('open-confirm').click()
  await dialogOf('删除试卷').getByRole('button', { name: '删除', exact: true }).click()
  await dialogOf('删除试卷').waitFor({ state: 'detached' })
  assert.ok((await logText()).includes('confirm:delete'))
  ok('确认框：危险时焦点在取消、回车不误删；非危险时焦点在确认')

  // 忙碌弹窗
  await byId('open-locked').click()
  const locked = dialogOf('正在生成 PDF')
  await locked.waitFor()
  await window.keyboard.press('Escape')
  await window.mouse.click(6, 6)
  assert.equal(await locked.count(), 1, '忙碌时 Esc 与点遮罩都不关闭')
  assert.ok(await locked.getByRole('button', { name: '关闭' }).isDisabled(), '忙碌时 × 禁用')
  await byId('locked-release').click()
  await window.keyboard.press('Escape')
  await locked.waitFor({ state: 'detached' })
  ok('locked：忙碌时 Esc、点遮罩、× 都不生效，结束后恢复')

  // ---- Toast ----
  const toasts = window.getByTestId('toast')
  await byId('toast-info').click()
  await toasts.filter({ hasText: '已存为 v2' }).waitFor()
  assert.equal(await toasts.first().getAttribute('role'), 'status')
  await window.getByRole('button', { name: '关闭提示' }).click()
  await toasts.first().waitFor({ state: 'detached' })
  await byId('toast-undo').click()
  await toasts.filter({ hasText: '已删除第 3 题' }).getByRole('button', { name: '撤销' }).click()
  await toasts.first().waitFor({ state: 'detached' })
  assert.ok((await logText()).includes('undo:3'), '点撤销执行动作并关闭提示')
  await byId('toast-merge').click()
  await byId('toast-merge').click()
  await byId('toast-merge').click()
  assert.equal(await toasts.count(), 1, '同组提示合并成一条')
  await toasts.filter({ hasText: '已删除 3 道题' }).waitFor()
  await shot(toasts.first(), 'toast-merged')
  const undoBefore = (await logText()).split('|').filter((x) => x.startsWith('undo:')).length
  await toasts.getByRole('button', { name: '撤销全部' }).click()
  const undoAfter = (await logText()).split('|').filter((x) => x.startsWith('undo:')).length
  assert.equal(undoAfter - undoBefore, 3, '「撤销全部」把合并过的三次撤销都执行')
  await byId('toast-error').click()
  const errorToast = toasts.filter({ hasText: '保存失败' })
  await errorToast.waitFor()
  assert.equal(await errorToast.getAttribute('role'), 'alert')
  await shot(window.getByRole('region', { name: '提示' }), 'toast-error')
  await errorToast.getByRole('button', { name: '关闭提示' }).click()
  // 自动消失；悬停时暂停计时
  await byId('toast-short').click()
  const shortToast = toasts.filter({ hasText: '一会儿就消失' })
  await shortToast.waitFor()
  await shortToast.hover()
  await window.waitForTimeout(2000)
  assert.equal(await shortToast.count(), 1, '鼠标悬停期间不消失')
  await window.mouse.move(700, 20)
  await shortToast.waitFor({ state: 'detached', timeout: 4000 })
  ok('Toast：撤销动作、同类合并（撤销全部）、出错提示 role=alert、悬停暂停、自动消失')

  // ---- Toast：同时最多 2 条、相同文字合并、被顶掉的撤销不执行 ----
  await window.evaluate(() => {
    ;(window as unknown as { __undo: string[] }).__undo = []
    window.__toast.dismissAll()
  })
  for (const name of ['甲', '乙', '丙']) {
    await window.evaluate((n) => window.__toast.show('已删除 ' + n, { ms: 2500, action: { label: '撤销', run: () => (window as unknown as { __undo: string[] }).__undo.push(n) } }), name)
  }
  assert.deepEqual(await toasts.locator('.ui-toast-text').allInnerTexts(), ['已删除 乙', '已删除 丙'], '连来 3 条只剩最新 2 条，最早的被顶掉')
  await shot(window.getByRole('region', { name: '提示' }), 'toast-two')
  await toasts.filter({ hasText: '已删除 丙' }).getByRole('button', { name: '撤销' }).click()
  await window.mouse.move(700, 4) // 丙消失后乙落到鼠标下面，悬停会暂停它的计时
  await toasts.first().waitFor({ state: 'detached', timeout: 5000 }) // 乙超时消失
  const undone = await window.evaluate(() => (window as unknown as { __undo: string[] }).__undo)
  assert.deepEqual(undone, ['丙'], '被顶掉的「甲」与超时消失的「乙」都不执行撤销，只有点了的「丙」执行')
  for (let i = 0; i < 3; i++) await window.evaluate(() => window.__toast.show('已复制到剪贴板', { ms: 1500 }))
  assert.equal(await toasts.count(), 1, '文字相同的提示只留一条')
  await window.waitForTimeout(1000)
  await window.evaluate(() => window.__toast.show('已复制到剪贴板', { ms: 1500 }))
  await window.waitForTimeout(1000)
  assert.equal(await toasts.count(), 1, '相同文字再来一次会重新计时（距首次已 2 秒，超过 1.5 秒时长）')
  await toasts.first().waitFor({ state: 'detached', timeout: 3000 })
  await window.evaluate(() => window.__toast.show('同一句话', { tone: 'error' }))
  await window.evaluate(() => window.__toast.show('同一句话'))
  assert.equal(await toasts.count(), 2, '文字相同但类型不同（出错 / 普通）不合并')
  await window.evaluate(() => window.__toast.dismissAll())
  ok('Toast：同时最多 2 条（顶掉最早的）、被顶掉与超时的撤销不执行、相同文字合并并重新计时')

  // ---- Toast 避让弹窗（N9）----
  const expectAvoids = async (modalName: string, label: string): Promise<void> => {
    await window.evaluate(() => window.__toast.show('已存为 v2', { action: { label: '撤销', run: () => undefined } }))
    const host = window.locator('.ui-toast-host')
    await host.waitFor()
    await window.waitForFunction(() => document.querySelector('.ui-toast-host')?.hasAttribute('data-avoiding-modal'))
    await settle(150)
    const hostBox = await rectOf(host)
    const footBox = await rectOf(dialogOf(modalName).locator('.ui-modal-foot'))
    assert.ok(!intersects(hostBox, footBox), `${label}：提示条不应压住弹窗页脚（提示 ${JSON.stringify(hostBox)}，页脚 ${JSON.stringify(footBox)}）`)
    const viewport = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    assert.ok(hostBox.left >= 0 && hostBox.right <= viewport.w && hostBox.top >= 0 && hostBox.bottom <= viewport.h, label + '：提示条在窗口内')
    await shot(window, 'toast-avoid-' + label)
    await host.getByRole('button', { name: '撤销' }).click() // 弹窗背景 inert 时提示条上的按钮仍能点
    await host.waitFor({ state: 'detached' })
  }
  await byId('open-small').click()
  await dialogOf('已存为版本').waitFor()
  await expectAvoids('已存为版本', 'small')
  const smallBox = await rectOf(dialogOf('已存为版本'))
  await window.evaluate(() => window.__toast.show('位置测试'))
  await window.waitForFunction(() => document.querySelector('.ui-toast-host')?.hasAttribute('data-avoiding-modal'))
  await settle(150)
  assert.ok((await rectOf(window.locator('.ui-toast-host'))).bottom <= smallBox.top, '小弹窗上方放得下时，提示条放在弹窗上方')
  await window.evaluate(() => window.__toast.dismissAll())
  await window.keyboard.press('Escape')
  await byId('open-wide').click()
  await dialogOf('版本预览 v2').waitFor()
  await expectAvoids('版本预览 v2', 'wide')
  await window.keyboard.press('Escape')
  await window.evaluate(() => window.__toast.show('回到默认位置'))
  await window.locator('.ui-toast-host').waitFor()
  assert.equal(await window.locator('.ui-toast-host').getAttribute('data-avoiding-modal'), null, '没有弹窗时回到窗口底部居中')
  await window.evaluate(() => window.__toast.dismissAll())
  ok('Toast 避让弹窗：小弹窗放上方，铺满窗口的宽弹窗放标题栏下方，都不压页脚；提示条上的撤销按钮在弹窗期间仍可点')

  // ---- 菜单 ----
  await byId('menu-more').focus()
  await window.keyboard.press('Enter')
  const menu = window.getByRole('menu', { name: '题目操作' })
  await menu.waitFor()
  assert.equal(await active(), '上移', '键盘打开：焦点落在第一项')
  await window.keyboard.press('ArrowDown')
  assert.equal(await active(), '移到第 2 大题', '↓ 跳过禁用项')
  await window.keyboard.press('ArrowDown')
  assert.equal(await active(), '删除Del')
  await window.keyboard.press('ArrowDown')
  assert.equal(await active(), '上移', '↓ 到底后循环')
  await window.keyboard.press('ArrowUp')
  assert.equal(await active(), '删除Del', '↑ 到顶后循环')
  await window.keyboard.press('Home')
  assert.equal(await active(), '上移')
  await window.keyboard.press('End')
  assert.equal(await active(), '删除Del')
  await window.keyboard.press('ArrowUp')
  assert.equal(await active(), '移到第 2 大题')
  const triggerBox = await rectOf(byId('menu-more'))
  const menuBox = await rectOf(menu)
  assert.ok(Math.abs(menuBox.right - triggerBox.right) < 1.5, 'align=end：菜单右边与触发按钮右边对齐')
  const pad = 12
  await window.screenshot({ path: join(evidence, 'kit-menu-open.png'), clip: { x: Math.max(menuBox.left - pad, 0), y: Math.max(triggerBox.top - pad, 0), width: menuBox.width + pad * 2, height: menuBox.bottom - triggerBox.top + pad * 2 } })
  await window.keyboard.press('Enter')
  await menu.waitFor({ state: 'detached' })
  assert.ok((await logText()).includes('menu:移到第 2 大题'))
  assert.equal(await active(), 'menu-more', '选中后焦点回到触发按钮')
  await window.keyboard.press('Enter')
  await menu.waitFor()
  await window.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  assert.equal(await active(), 'menu-more', 'Esc 关闭后焦点回到触发按钮')
  await window.keyboard.press('ArrowDown')
  await menu.waitFor()
  assert.equal(await active(), '上移', '触发按钮上按 ↓ 也能打开')
  await window.keyboard.press('Tab')
  await menu.waitFor({ state: 'detached' })
  assert.equal(await active(), 'menu-more', 'Tab 关闭菜单并回到触发按钮')
  // 鼠标
  await byId('menu-add').click()
  const addMenu = window.getByRole('menu')
  await addMenu.waitFor()
  assert.equal(await window.evaluate(() => document.activeElement?.getAttribute('role')), 'menu', '鼠标打开：焦点在菜单本身，第一项不显示焦点环')
  await addMenu.getByRole('menuitem', { name: '二、填空题' }).click()
  await addMenu.waitFor({ state: 'detached' })
  assert.ok((await logText()).includes('add:2'))
  await byId('menu-more').click()
  await menu.waitFor()
  await menu.getByRole('menuitem', { name: '下移' }).click({ force: true })
  assert.equal(await menu.count(), 1, '点禁用项不执行也不关菜单')
  assert.ok(!(await logText()).includes('menu:下移'))
  await window.mouse.click(700, 20)
  await menu.waitFor({ state: 'detached' })
  // 贴着窗口底边时向上翻转
  await window.evaluate(() => {
    const el = document.querySelector('[data-testid="menu-bottom"]') as HTMLElement
    Object.assign(el.style, { position: 'fixed', left: '200px', bottom: '6px', zIndex: '5' })
  })
  await byId('menu-bottom').click()
  const flipMenu = window.getByRole('menu')
  await flipMenu.waitFor()
  await settle(80)
  const flipBox = await rectOf(flipMenu)
  const bottomTrigger = await rectOf(byId('menu-bottom'))
  const vh = await window.evaluate(() => window.innerHeight)
  assert.ok(flipBox.bottom <= vh && flipBox.bottom <= bottomTrigger.top, '放不下时翻到触发按钮上方，且完整落在窗口内')
  await window.keyboard.press('Escape')
  await window.evaluate(() => {
    const el = document.querySelector('[data-testid="menu-bottom"]') as HTMLElement
    el.removeAttribute('style')
  })
  ok('菜单：键盘开合与导航（跳过禁用项、首尾循环、Home/End）、Esc/Tab 关闭并归还焦点、鼠标选择、禁用项、贴底翻转')

  // ---- Popover ----
  await byId('pop-open').click()
  const pop = window.getByRole('dialog', { name: '试卷结构' })
  await pop.waitFor()
  assert.equal(await active(), '浮层内输入', '浮层打开后焦点进入第一个可聚焦元素')
  await window.keyboard.press('Escape')
  await pop.waitFor({ state: 'detached' })
  assert.equal(await active(), 'pop-open')
  await byId('pop-open').click()
  await pop.waitFor()
  await pop.getByRole('button', { name: '跳到该题' }).click()
  await pop.waitFor({ state: 'detached' })
  assert.ok((await logText()).includes('pop:close'))
  await byId('pop-open').click()
  await pop.waitFor()
  await window.mouse.click(700, 20)
  await pop.waitFor({ state: 'detached' })
  ok('Popover：焦点进入浮层、Esc 与点外面关闭、通过 render-prop 的 close 关闭')

  // ---- Select：长文字不撑宽 ----
  const narrowSelect = window.getByLabel('定宽来源卷')
  const longSelect = window.getByLabel('长文字来源卷')
  const widthOf = (l: Locator) => l.evaluate((el) => (el.closest('.ui-select') as HTMLElement).getBoundingClientRect().width)
  assert.ok(Math.abs((await widthOf(narrowSelect)) - 220) < 0.5, '定宽 220px 的容器里，下拉框外框 220px')
  await narrowSelect.selectOption({ index: 1 })
  assert.ok(Math.abs((await widthOf(narrowSelect)) - 220) < 0.5, '换成 50 字的长选项后外框宽度不变')
  assert.equal(await narrowSelect.evaluate((el) => getComputedStyle(el).textOverflow), 'ellipsis')
  assert.ok(
    await narrowSelect.evaluate((el) => {
      // 原生下拉框的文字不在 DOM 里，量一下同字体的整段文字有多宽
      const context = document.createElement('canvas').getContext('2d')!
      context.font = getComputedStyle(el).font
      return context.measureText((el as HTMLSelectElement).title).width > el.clientWidth
    }),
    '长文字比框宽，在框内被截断'
  )
  assert.equal(await narrowSelect.evaluate((el) => (el as HTMLSelectElement).title.length > 20), true, '被截断的值可在悬停提示里看到全文')
  assert.equal(await longSelect.evaluate((el) => (el.closest('.ui-select') as HTMLElement).offsetWidth <= (el.closest('.g-grid') as HTMLElement).offsetWidth / 3), true, '栅格里的长文字下拉框没有撑开列')
  await narrowSelect.selectOption({ index: 0 })
  ok('Select：长文字截断成省略号、外框宽度不变、悬停可见全文')

  // ---- NumberInput ----
  const num = window.getByRole('spinbutton', { name: '每小题分值' })
  const valueNow = () => num.getAttribute('aria-valuenow')
  const calls = async (): Promise<number> => Number(await byId('num-calls').innerText())
  const hint = window.locator('.ui-num-hint')
  const HINT = '请填 0.5–999 之间、以 0.5 为单位的分值'
  assert.equal(await valueNow(), '4')
  await num.fill('')
  assert.equal(await valueNow(), null, '清空 → null')
  await num.fill('3.5')
  assert.equal(await valueNow(), '3.5')
  assert.equal(await hint.count(), 0)
  // 全角数字与全角小数点先转半角
  let before = await calls()
  await num.fill('１２．５')
  assert.equal(await num.inputValue(), '12.5', '全角「１２．５」转成半角')
  assert.equal(await valueNow(), '12.5')
  assert.equal((await calls()) - before, 1, '合法输入回调一次')
  await num.fill('３。５')
  assert.equal(await num.inputValue(), '3.5', '中文句号也按小数点处理')
  assert.equal(await valueNow(), '3.5')
  // 不合法：保留用户敲的字、标红、给提示、不回调
  for (const bad of ['-5', '1000', '0.3', '0', '1e3', 'abc', '12abc', '.', '1.2.3', '－5']) {
    before = await calls()
    const keep = await valueNow()
    await num.fill(bad)
    const shown = await num.inputValue()
    assert.equal(shown, bad === '－5' ? '-5' : bad, `非法输入「${bad}」：保留用户敲的字（全角减号转半角）`)
    assert.equal(await num.getAttribute('aria-invalid'), 'true', `「${bad}」标出不合法状态`)
    assert.equal((await hint.innerText()).trim(), HINT, `「${bad}」给出提示`)
    assert.equal(await calls(), before, `「${bad}」不回调 onChange`)
    assert.equal(await valueNow(), keep, `「${bad}」期间值保持上一个合法值`)
  }
  await shot(window.locator('[data-gallery="form"]'), 'numinput-invalid')
  // 手打与粘贴走同一套规则
  await num.fill('')
  await num.pressSequentially('12abc')
  const typed = await num.inputValue()
  await num.fill('')
  await num.focus()
  await window.evaluate(() => document.execCommand('insertText', false, '12abc'))
  assert.equal(typed, '12abc', '手打「12abc」保留')
  assert.equal(await num.inputValue(), typed, '粘贴「12abc」与手打一致：保留，不清空')
  assert.equal(await num.getAttribute('aria-invalid'), 'true')
  // 失焦：仍不合法就恢复上一个合法值
  await num.fill('7.5')
  await num.fill('9x')
  await num.blur()
  assert.equal(await num.inputValue(), '7.5', '失焦时恢复上一个合法值')
  assert.equal(await num.getAttribute('aria-invalid'), null)
  assert.equal(await hint.count(), 0, '失焦后提示消失')
  assert.equal(await valueNow(), '7.5')
  // 合法的半截写法；输入法提交
  await num.fill('.5')
  assert.equal(await valueNow(), '0.5')
  await num.fill('3.')
  assert.equal(await valueNow(), '3')
  await num.blur()
  assert.equal(await num.inputValue(), '3', '「3.」失焦后显示规整值')
  // 方向键仍按步长加减，并限制在范围内
  await num.fill('2.5')
  await num.focus()
  await window.keyboard.press('ArrowUp')
  assert.equal(await valueNow(), '3')
  await window.keyboard.press('Shift+ArrowUp')
  assert.equal(await valueNow(), '8')
  await window.keyboard.press('ArrowDown')
  assert.equal(await valueNow(), '7.5')
  await num.fill('0.5')
  await window.keyboard.press('ArrowDown')
  assert.equal(await valueNow(), '0.5', '方向键不会低于下限 0.5')
  await num.fill('')
  await num.blur()
  assert.equal(await num.inputValue(), '')
  const stepNum = window.getByRole('spinbutton', { name: '未设分值' })
  assert.ok(await window.getByRole('button', { name: '减少' }).first().isDisabled(), '值为空时「减少」不可用')
  await window.getByRole('button', { name: '增加' }).first().click()
  assert.equal(await stepNum.getAttribute('aria-valuenow'), '0.5', '空值点 + 得到一个步长')
  await window.getByRole('button', { name: '减少' }).first().click()
  assert.equal(await stepNum.getAttribute('aria-valuenow'), '0')
  assert.ok(await window.getByRole('button', { name: '减少' }).first().isDisabled(), '到下限后「减少」不可用')
  ok('NumberInput：全角转半角；非法输入（负数、越界、非步长倍数、字母、科学计数）保留原文、标红提示、不回调，失焦恢复上一个合法值；手打与粘贴一致；可清空；↑↓ 与 − + 按钮')

  // ---- Segmented / Checkbox ----
  const fmt = window.getByRole('radiogroup', { name: '文件格式' })
  assert.ok(await fmt.getByRole('radio', { name: 'PDF' }).isChecked())
  await fmt.getByRole('radio', { name: 'PDF' }).focus()
  await window.keyboard.press('ArrowRight')
  assert.ok(await fmt.getByRole('radio', { name: 'DOCX' }).isChecked(), '方向键切换单选')
  const pos = window.getByRole('radiogroup', { name: '答案位置' })
  assert.ok(await pos.getByRole('radio', { name: '不显示' }).isDisabled())
  await pos.getByRole('radio', { name: '卷尾' }).focus()
  await window.keyboard.press('ArrowRight')
  await window.keyboard.press('ArrowRight')
  assert.ok(await pos.getByRole('radio', { name: '卷尾' }).isChecked(), '方向键跳过禁用项')
  assert.equal(await window.getByRole('radiogroup', { name: '整组禁用' }).getByRole('radio', { name: 'PDF' }).isDisabled(), true)
  const box1 = window.getByRole('checkbox', { name: '学生版和教师版各一份' })
  assert.ok(await box1.isChecked())
  await window.getByText('学生版和教师版各一份').click()
  assert.ok(!(await box1.isChecked()), '点文字也能切换')
  assert.equal(await window.getByRole('checkbox', { name: '部分选中（聚焦）' }).evaluate((el) => (el as HTMLInputElement).indeterminate), true)
  ok('Segmented 方向键切换且跳过禁用项；Checkbox 点文字切换、indeterminate')

  // ---- Drawer：停靠，不盖主内容（S17）----
  const dockMain = byId('dock-main')
  const mainBefore = await rectOf(dockMain)
  await byId('open-drawer').focus()
  await window.keyboard.press('Enter')
  const drawer = window.getByRole('complementary', { name: '版本历史' })
  await drawer.waitFor()
  const mainAfter = await rectOf(dockMain)
  const drawerBox = await rectOf(drawer)
  assert.ok(Math.abs(mainBefore.width - mainAfter.width - 300) < 1.5, `主内容被挤窄 300px，实际 ${mainBefore.width} → ${mainAfter.width}`)
  assert.ok(mainAfter.right <= drawerBox.left + 0.5, '主内容与抽屉并排，不被盖住')
  const edgeBox = await rectOf(byId('dock-edge'))
  const topAtEdge = await window.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.getAttribute('data-testid'), [edgeBox.left + 4, edgeBox.top + 4] as const)
  assert.equal(topAtEdge, 'dock-edge', '主内容里的标记没有被抽屉遮住')
  assert.ok(await insideOf(drawer), '打开后焦点在抽屉内')
  assert.equal(await rootInert(), false, '抽屉是非模态，背景不 inert')
  await shot(byId('dock'), 'drawer-docked')
  await window.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  assert.equal(await active(), 'open-drawer', '关闭后焦点回到触发按钮')
  assert.ok(Math.abs((await rectOf(dockMain)).width - mainBefore.width) < 1.5, '关闭后主内容恢复原宽')
  ok('Drawer：停靠在右侧把主内容挤窄而不是盖住它，非模态，Esc 关闭并归还焦点')

  // ---- usePersistentState ----
  const probe = window.getByLabel('记住的值')
  await probe.fill('老师的笔记')
  await byId('session-bump').click()
  await byId('session-bump').click()
  const stored = await window.evaluate(() => ({ local: localStorage.getItem('ewb.test.probe'), session: sessionStorage.getItem('ewb.test.session') }))
  assert.deepEqual(stored, { local: JSON.stringify('老师的笔记'), session: '2' })
  await window.getByLabel('防抖写入').fill('abc')
  assert.equal(await window.evaluate(() => localStorage.getItem('ewb.test.delayed')), null, 'delay 内不写入')
  await window.waitForFunction(() => localStorage.getItem('ewb.test.delayed') === '"abc"', null, { timeout: 2000 })
  await window.evaluate(() => {
    localStorage.setItem('ewb.test.validated', '123') // 类型不对
  })
  await window.reload()
  await window.locator('#gallery').waitFor()
  assert.equal(await window.getByLabel('记住的值').inputValue(), '老师的笔记', '刷新后 localStorage 的值还在')
  assert.ok((await byId('session-bump').innerText()).includes('2'), '刷新后 sessionStorage 的值还在')
  assert.equal(await byId('validated').innerText(), 'fallback', 'validate 不通过时退回初始值')
  await window.evaluate(() => localStorage.setItem('ewb.test.probe', '{损坏的 json'))
  await window.reload()
  await window.locator('#gallery').waitFor()
  assert.equal(await window.getByLabel('记住的值').inputValue(), '初始值', '存储内容损坏时退回初始值，页面不崩')
  await byId('break-storage').click()
  await window.getByLabel('记住的值').fill('存储坏了照样能打字')
  assert.equal(await window.getByLabel('记住的值').inputValue(), '存储坏了照样能打字', '存储抛异常时界面照常工作')
  await window.reload()
  await window.locator('#gallery').waitFor()
  ok('usePersistentState：刷新后保留、sessionStorage、validate 兜底、内容损坏与存储抛异常都退回初始值、delay 防抖')

  assert.deepEqual(pageErrors, [], '页面不应有未捕获异常或控制台错误')
  ok('样张页运行全程无未捕获异常、无控制台报错')

  console.log(`\n组件样张测试通过（${steps} 项），截图在 ${evidence}`)
} finally {
  await app.close()
}
