// Toggle button: not pressed = yellow-gray gradient; pressed/active = orange-yellow gradient (§3.1 CBlendItems)
import type { CSSProperties, ReactNode } from 'react'

interface Props {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  style?: CSSProperties
  title?: string
  activeBackground?: string // Special background color, e.g. while Average is in progress
  disabled?: boolean
}

export function ToggleButton({ active, onClick, children, style, title, activeBackground, disabled }: Props) {
  return (
    <button
      type="button"
      className={`toggle-btn${active ? ' toggle-btn-active' : ''}`}
      style={activeBackground ? { ...style, background: activeBackground } : style}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
