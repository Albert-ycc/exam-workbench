// 内容是否超出固定高度被裁切：短题不需要「展开」。图片加载、窗口缩放引起的高度变化也会重新量。
import { useLayoutEffect, useState, type RefObject } from 'react'

export function useClamped(ref: RefObject<HTMLElement | null>, maxHeight: number, deps: readonly unknown[]): boolean {
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setClamped(el.scrollHeight > maxHeight + 2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // 图片加载完成时盒子大小不一定变化（已被 max-height 卡住），单独监听
    el.addEventListener('load', measure, true)
    return () => {
      observer.disconnect()
      el.removeEventListener('load', measure, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return clamped
}

// 元素的内容宽度，随窗口与停靠面板变化
export function useElementWidth(ref: RefObject<HTMLElement | null>, mounted: unknown): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, mounted])
  return width
}
