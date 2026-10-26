// 红笔批注记号：勾、插入号、圈注、楷体批注。红笔只标「改动」——已加入、插入位置、未存为版本、删除确认。样式见 Marks.css。
//
// <RedTick />                                   已加入题目左边的红勾（22px）
// <RedPen>已加入</RedPen>                        楷体红字批注，字号不低于 15px
// <RedCaret />                                  插入位置左边距的校对插入号（22×26）
// <CircledNote>有改动未存为版本</CircledNote>      红色手画圈注
//
// 用法示例（插入位置）：
//   <div className="drop"><RedCaret /><span className="line" /><RedPen>插入为第 4 题</RedPen></div>
import type { ComponentProps } from 'react'
import { cx } from './cx'
import './Marks.css'

export function RedTick({ size = 22, className, ...rest }: { size?: number } & Omit<ComponentProps<'svg'>, 'children'>) {
  return (
    <svg className={cx('ui-mark', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      <path d="M3.5 12.8c1.6.6 3.4 2.6 5.2 5.9 2.6-5.6 6.4-10.6 11.6-15.4" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RedCaret({ width = 22, height = 26, className, ...rest }: { width?: number; height?: number } & Omit<ComponentProps<'svg'>, 'children'>) {
  return (
    <svg className={cx('ui-mark', className)} width={width} height={height} viewBox="0 0 22 26" aria-hidden="true" focusable="false" {...rest}>
      <path d="M3 24.5c2.4-6 4.8-12.4 7.6-21 .2-.5.6-.5.8 0 2.6 7.4 5 14 7.8 20.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 楷体红字。楷体在 15px 以下笔画发糊，所以字号不会低于 15px */
export function RedPen({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={cx('ui-redpen', className)} {...rest} />
}

export function CircledNote({ className, children, ...rest }: ComponentProps<'span'>) {
  return (
    <span className={cx('ui-circled', className)} {...rest}>
      {children}
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path
          d="M10 5.5C32-.5 78-.8 94.5 9.5c7 8.6-14.6 18.6-46 18.2C18.6 27.4.5 21.4 3.2 12.6 5 6.9 12.4 3.8 19 2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  )
}
