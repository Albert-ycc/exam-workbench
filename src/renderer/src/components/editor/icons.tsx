// 编辑器专用的几个线条图标（其余通用图标在 src/icons.tsx）。风格与之一致：24 视框、描边跟随文字颜色
import type { ReactNode } from 'react'

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export const IconGrip = () => (
  <Svg>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" />
  </Svg>
)

export const IconUndo = () => (
  <Svg>
    <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
)

export const IconRedo = () => (
  <Svg>
    <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
  </Svg>
)

export const IconChevronRight = () => (
  <Svg>
    <path d="M9 6l6 6-6 6" />
  </Svg>
)

export const IconPanelLeft = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M9 4v16" />
  </Svg>
)
