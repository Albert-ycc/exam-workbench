// 归类：试题库的章节、知识点、难度、标签，试卷库的分类与标签。主进程与界面共用的类型、命名规则与难度档位。
// 名称规整、难度档位只在这里算，界面、筛选、入库不另写一套。

// ---------- 名称 ----------

export const TAG_NAME_MAX = 20 // 标签名上限（试题库、试卷库相同）
export const CLASS_NAME_MAX = 30 // 章节名、试卷分类名上限

// 字数按用户看到的字（字素簇）计：「👨‍👩‍👧」算 1 个字，不按码点拆
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' })
const splitGraphemes = (text: string): string[] => Array.from(graphemes.segment(text), (s) => s.segment)

// 零宽与不可见字符：控制字符（Cc）、格式字符（Cf，含 U+200B–U+200F、U+2060–U+2064、U+180E），
// 以及显示为空白却不算空白的填充符（U+115F、U+1160、U+3164、U+FFA0 韩文填充，U+2800 盲文空白）。
// 从网页、微信复制名称时常夹带，名称里留着它们会出现「看着同名却是两个」「空白名称」
const INVISIBLE = /[\p{Cc}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

// 规整名称：空白（含全角空格、不换行空格）合成一个半角空格，去掉零宽与不可见字符（表情内部的连接符保留），去首尾空白。
// 同名判断不分英文大小写（数据库列用 COLLATE NOCASE），中文与全角字母不做转换。不截断，超长由调用方处理
export function cleanClassName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const spaced = raw.replace(/[\u3000\s]+/g, ' ')
  return splitGraphemes(spaced)
    .map((g) => (PICTOGRAPHIC.test(g) ? g : g.replace(INVISIBLE, '')))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function classNameLength(text: string): number {
  return splitGraphemes(text).length
}

// 规整并按字数截断（界面预览用）；空名返回空串
export function normalizeClassName(raw: unknown, max: number): string {
  const clean = cleanClassName(raw)
  return classNameLength(clean) <= max ? clean : splitGraphemes(clean).slice(0, max).join('').trim()
}

// 写入前的校验（主进程用）：规整后为空或超长直接报错，不悄悄截断——截断后可能恰好与已有名称同名而被并进去
export function checkClassName(raw: unknown, max: number, what: string): string {
  const name = cleanClassName(raw)
  if (!name) throw new Error(`${what}不能为空`)
  if (classNameLength(name) > max) throw new Error(`${what}最多 ${max} 字`)
  return name
}

// ---------- 标签 ----------

export type TagScope = 'question' | 'paper' // 题目标签与试卷标签各自一套

export interface TagRef {
  id: number
  name: string
}

export interface Tag extends TagRef {
  count: number // 打了这个标签的题数（试卷标签为份数）
}

// 改名结果：改成已有标签的名字时两者合并，原标签删除，mergedInto 为保留下来的那个
export interface TagRenameResult {
  id: number
  mergedInto: number | null
}

// 批量打标签 / 去标签
export interface TagChange {
  add?: number[]
  remove?: number[]
}

// ---------- 章节（试题库，老师自建两级目录） ----------

export interface Chapter {
  id: number
  parentId: number | null // null 为章，否则为该章下的节
  name: string
  position: number // 同级内的顺序，从 0 开始
  count: number // 归在这里的题数；章包含其下各节
}

// 章节筛选里的「未归章节」
export const NO_CHAPTER = 0

// ---------- 知识点与难度（组卷网自带，入库时读取，只读） ----------

export interface KnowledgeRef {
  id: number // 组卷网知识点编号
  name: string
  subject: string // 组卷网学科代码，如 czsx；读不到为空串
}

// 组卷网学科代码 → 名称（知识点链接 /czsx/zsd4740 的第一段）。样本里见到 czsx、czyy、czwl，其余按同一命名规则；不在表里的显示代码本身
const SUBJECTS: Record<string, string> = {
  czsx: '初中数学',
  czyw: '初中语文',
  czyy: '初中英语',
  czwl: '初中物理',
  czhx: '初中化学',
  czsw: '初中生物',
  czls: '初中历史',
  czdl: '初中地理',
  czzz: '初中道德与法治',
  gzsx: '高中数学',
  gzyw: '高中语文',
  gzyy: '高中英语',
  gzwl: '高中物理',
  gzhx: '高中化学',
  gzsw: '高中生物',
  gzls: '高中历史',
  gzdl: '高中地理',
  gzzz: '高中思想政治',
  xxsx: '小学数学',
  xxyw: '小学语文',
  xxyy: '小学英语'
}

export function subjectName(code: string): string {
  return SUBJECTS[code] ?? (code || '其他')
}

// 难度档位：按组卷网难度系数（得分率，越大越容易）划分。系数是入库存下的事实，档位只在这里换算。
// 依据：组卷网试卷页显示「档位 (系数)」，页面上可见的只有容易、适中、困难三档（「加入试题篮」按钮的 qdname 属性另有
// 较易、较难，页面不显示）。离线样本与真实页面共 167 道题：容易 0.81–0.95、适中 0.57–0.79、困难 0.15 与 0.40，
// 与本表换算 167/167 一致。容易与适中以 0.80 为界，两侧都有样本；0.41–0.56 区间没有出现过，适中与困难暂按 0.50 划分。
export type DifficultyKey = 'easy' | 'medium' | 'hard'

export interface DifficultyTier {
  key: DifficultyKey
  label: string
  min: number // 含
  max: number // 不含；最上一档为 1.01
}

export const DIFFICULTY_TIERS: readonly DifficultyTier[] = [
  { key: 'easy', label: '容易', min: 0.8, max: 1.01 },
  { key: 'medium', label: '适中', min: 0.5, max: 0.8 },
  { key: 'hard', label: '困难', min: 0, max: 0.5 }
]

export function difficultyTier(coefficient: number | null | undefined): DifficultyTier | null {
  if (typeof coefficient !== 'number' || !Number.isFinite(coefficient)) return null
  return DIFFICULTY_TIERS.find((t) => coefficient >= t.min && coefficient < t.max) ?? null
}

export function isDifficultyKey(value: unknown): value is DifficultyKey {
  return DIFFICULTY_TIERS.some((t) => t.key === value)
}

// ---------- 试卷库分类 ----------

export interface PaperCategory {
  id: number
  name: string
  position: number
  count: number // 这个分类下的试卷份数
}

// 新建分类时的常用名（P6）
export const CATEGORY_PRESETS = ['每日练习', '周测', '单元测试', '月考', '期中', '期末', '作业'] as const
