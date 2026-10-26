// 章节的显示名：章写章名，节写「章名 › 节名」（题目行与「已归到…」提示用）。找不到的章节返回 null。
import type { Chapter } from '@shared/classify'

export function chapterPath(chapters: readonly Chapter[], id: number | null): string | null {
  if (id === null) return null
  const chapter = chapters.find((c) => c.id === id)
  if (!chapter) return null
  const parent = chapter.parentId === null ? null : chapters.find((c) => c.id === chapter.parentId)
  return parent ? `${parent.name} › ${chapter.name}` : chapter.name
}
