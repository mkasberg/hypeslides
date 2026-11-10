import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { THEMES } from '../core'
import { SYSTEM, SYSTEM_DARK, SYSTEM_LIGHT, prettyThemeName } from '../app/appTheme'
import { CheckIcon } from './icons'

export interface ThemeOption {
  value: string
  label: string
  /** Color chips shown after the label. */
  chips: string[]
}

/** Chips for a bundled theme: background, foreground, accent, then a few palette colors. */
export function themeOption(name: string): ThemeOption {
  const t = THEMES.find((x) => x.name === name)
  const c = t?.colors
  return {
    value: name,
    label: prettyThemeName(name),
    chips: c ? [c.background, c.foreground, c.accent, c.green, c.red, c.yellow, c.magenta] : [],
  }
}

/** 'System (light/dark)': chips of both themes it can resolve to. */
export function systemOption(): ThemeOption {
  const d = themeOption(SYSTEM_DARK).chips
  const l = themeOption(SYSTEM_LIGHT).chips
  return { value: SYSTEM, label: 'System (light/dark)', chips: [d[0], d[2], l[0], l[2]] }
}

export const allThemeOptions = (): ThemeOption[] => THEMES.map((t) => themeOption(t.name))

/**
 * A list of themes for a popover. Hovering or arrowing onto a row previews it
 * (`onPreview(value)`); Enter or click commits (`onCommit(value)`). Reverting a
 * preview on Escape/outside click is the popover's job (`onPreview(null)`).
 */
export function ThemeList({ options, value, onPreview, onCommit }: {
  options: ThemeOption[]
  value: string
  onPreview(value: string): void
  onCommit(value: string): void
}) {
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  // Open scrolled to the current theme.
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const move = (i: number) => {
    const n = options.length
    const next = Math.min(n - 1, Math.max(0, i))
    setActive(next)
    onPreview(options[next].value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' }))
  }

  return (
    <div
      ref={ref}
      className="theme-list"
      role="group"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') move(active + 1)
        else if (e.key === 'ArrowUp') move(active - 1)
        else if (e.key === 'Home') move(0)
        else if (e.key === 'End') move(options.length - 1)
        else if (e.key === 'PageDown') move(active + 8)
        else if (e.key === 'PageUp') move(active - 8)
        else if (e.key === 'Enter' || e.key === ' ') onCommit(options[active].value)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {options.map((o, i) => (
        <div
          key={o.value}
          role="menuitemradio"
          aria-checked={o.value === value}
          data-index={i}
          data-active={i === active}
          className={'theme-row' + (i === active ? ' active' : '')}
          onMouseEnter={() => {
            if (i !== active) {
              setActive(i)
              onPreview(o.value)
            }
          }}
          onClick={() => onCommit(o.value)}
        >
          <span className="menu-check">{o.value === value ? <CheckIcon /> : null}</span>
          <span className="theme-name">{o.label}</span>
          <span className="theme-chips" aria-hidden="true">
            {o.chips.map((c, k) => <i key={k} style={{ background: c }} />)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * A button that opens a floating panel (role=menu, so keyboard shortcuts stand
 * down). `children(close)` renders the content. `onClose` runs on every close,
 * including after a commit, so callers can drop their live preview.
 */
export function Popover({ button, className, title, alignRight, onClose, children }: {
  button: ReactNode
  className?: string
  title?: string
  alignRight?: boolean
  onClose?(): void
  children(close: () => void): ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    onClose?.()
  }
  const latestClose = useRef(close)
  latestClose.current = close

  useLayoutEffect(() => {
    if (!open || !panel.current || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const w = panel.current.getBoundingClientRect().width
    let left = alignRight ? r.right - w : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    setPos({ left, top: r.bottom + 4 })
  }, [open, alignRight])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || btn.current?.contains(t)) return
      latestClose.current()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        latestClose.current()
        btn.current?.focus()
      }
    }
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {button}
      </button>
      {open && (
        <div ref={panel} className="menu popover" role="menu" style={{ left: pos.left, top: pos.top }}>
          {children(() => {
            close()
            btn.current?.focus()
          })}
        </div>
      )}
    </>
  )
}
