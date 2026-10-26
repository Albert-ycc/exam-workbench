// 各大题的「序号 + 名称」，题目「⋯」菜单里的「移到大题」用。放在 context 里，是为了大题改名时只有菜单重渲染，不牵动每一张题目卡片
import { createContext } from 'react'

export interface SectionTarget {
  id: string
  label: string // 「二、填空题」
}

export const SectionTargets = createContext<readonly SectionTarget[]>([])
