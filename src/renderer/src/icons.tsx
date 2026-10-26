// 线条图标：24 视框、描边跟随文字颜色。默认 18px，按钮内小图标传 size={16}（方向 C 的 16px 规格）
import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
}

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export const IconGlobe = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Svg>
)

export const IconSettings = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)

export const IconBack = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
)

export const IconForward = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
)

export const IconReload = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Svg>
)

export const IconHome = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" />
  </Svg>
)

export const IconLibrary = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 5h4v14H4zM10 5h4v14h-4zM16.5 5.5l3.5 1-3.5 13-3.5-1z" />
  </Svg>
)

export const IconPaper = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6" />
  </Svg>
)

// ---- 通用小图标（通用组件与各页面共用） ----

export const IconClose = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const IconChevronDown = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 10l4 4 4-4" />
  </Svg>
)

export const IconCheck = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)

export const IconMore = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </Svg>
)

export const IconPlus = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconSearch = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
)

export const IconUp = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M6 15l6-6 6 6" />
  </Svg>
)

export const IconDown = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)

export const IconTrash = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
  </Svg>
)

export const IconEdit = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Svg>
)

export const IconSave = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />
  </Svg>
)

export const IconHistory = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" />
  </Svg>
)

export const IconDownload = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </Svg>
)

export const IconFolder = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
)

export const IconGrip = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" />
  </Svg>
)

export const IconScissors = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="6" cy="7" r="3" />
    <circle cx="6" cy="17" r="3" />
    <path d="M8.5 8.6L20 16M8.5 15.4L20 8" />
  </Svg>
)
