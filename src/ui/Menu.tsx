import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckIcon, ChevronIcon } from './icons'

export interface MenuItem {
  label?: string
  onSelect?: () => void
  checked?: boolean
  disabled?: boolean
  shortcut?: string
  separator?: boolean
  /** Non-interactive caption row. */
  heading?: boolean
  items?: MenuItem[]
  /** Colored dots shown before the label (theme preview). */
  swatch?: string[]
  /** Inline style for the label (font preview). */
  labelStyle?: React.CSSProperties
}

/** Menus longer than this style their labels lazily (see Panel). */
const LONG_MENU = 50

interface PanelProps {
  items: MenuItem[]
  x: number
  y: number
  alignRight?: boolean
  /** Submenus: if the panel overflows the right edge at `x`, put its right edge here instead (flip to the parent's left side). */
  flipX?: number
  onClose: () => void
  /** Pointer events outside these elements close the menu. */
  ignore?: React.RefObject<HTMLElement | null>
}

function Panel({ items, x, y, alignRight, flipX, onClose, ignore }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = alignRight ? x - r.width : x
    let top = y
    if (flipX !== undefined && left + r.width > window.innerWidth - 8) left = flipX - r.width
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ left: Math.max(8, left), top })
  }, [x, y, alignRight, flipX, items])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || ignore?.current?.contains(t)) return
      if ((t as Element).closest?.('[role=menu]')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role=menuitem]:not([disabled])') ?? [])
        const i = els.indexOf(document.activeElement as HTMLElement)
        const n = els.length
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus()
      }
    }
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose, ignore])

  // Long menus (hundreds of installed fonts) style each label only once it
  // scrolls into view: resolving every preview font up front blocks the main
  // thread for seconds. The observer is created on first use from a row's
  // effect (the menu div is attached by then), so no extra render is needed.
  const long = items.length > LONG_MENU && typeof IntersectionObserver !== 'undefined'
  const ioRef = useRef<IntersectionObserver | null>(null)
  const getLazy = useCallback(() => {
    ioRef.current ??= new IntersectionObserver((entries, io) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target as HTMLElement
        el.style.fontFamily = el.dataset.fontFamily ?? ''
        io.unobserve(el)
      }
    }, { root: ref.current, rootMargin: '200px 0px' })
    return ioRef.current
  }, [])
  useEffect(() => () => {
    ioRef.current?.disconnect()
    ioRef.current = null
  }, [])

  const [sub, setSub] = useState<number | null>(null)
  return (
    <div ref={ref} className={long ? 'menu menu-long' : 'menu'} role="menu" style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item.separator) return <div key={i} className="menu-sep" role="separator" />
        if (item.heading) return <div key={i} className="menu-heading">{item.label}</div>
        const hasSub = !!item.items
        return (
          <MenuRow
            key={i}
            item={item}
            hasSub={hasSub}
            lazy={long ? getLazy : undefined}
            open={sub === i}
            onHover={() => setSub(hasSub ? i : null)}
            onActivate={() => {
              if (hasSub) return setSub(i)
              onClose()
              item.onSelect?.()
            }}
            onClose={onClose}
          />
        )
      })}
    </div>
  )
}

function MenuRow({ item, hasSub, lazy, open, onHover, onActivate, onClose }: {
  item: MenuItem; hasSub: boolean; lazy?: () => IntersectionObserver; open: boolean; onHover(): void; onActivate(): void; onClose(): void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = labelRef.current
    if (!lazy || !el) return
    const io = lazy()
    io.observe(el)
    return () => io.unobserve(el)
  }, [lazy])
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (open && ref.current) setRect(ref.current.getBoundingClientRect())
  }, [open])
  return (
    <>
      <button
        ref={ref}
        type="button"
        role="menuitem"
        className={'menu-item' + (item.checked ? ' checked' : '')}
        disabled={item.disabled}
        onMouseEnter={onHover}
        onFocus={onHover}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (hasSub && (e.key === 'ArrowRight' || e.key === 'Enter')) {
            e.preventDefault()
            onActivate()
          }
        }}
      >
        <span className="menu-check">{item.checked ? <CheckIcon /> : null}</span>
        {item.swatch && (
          <span className="menu-swatch">
            {item.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
          </span>
        )}
        <span
          ref={labelRef}
          className="menu-label"
          style={lazy === undefined ? item.labelStyle : undefined}
          data-font-family={lazy === undefined ? undefined : item.labelStyle?.fontFamily}
        >
          {item.label}
        </span>
        {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
        {hasSub && <span className="menu-arrow"><ChevronIcon /></span>}
      </button>
      {hasSub && open && rect && !item.disabled && (
        <Panel items={item.items!} x={rect.right - 2} flipX={rect.left + 2} y={rect.top - 5} onClose={onClose} />
      )}
    </>
  )
}

/** A menu at a fixed point (context menus). */
export function ContextMenu(props: { items: MenuItem[]; x: number; y: number; onClose(): void }) {
  return <Panel {...props} />
}

interface DropdownProps {
  items: MenuItem[]
  children: ReactNode
  title?: string
  className?: string
  alignRight?: boolean
  disabled?: boolean
}

/** A button that opens a dropdown menu beneath it. */
export function Dropdown({ items, children, title, className, alignRight, disabled }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const r = ref.current!.getBoundingClientRect()
          setAnchor({ x: alignRight ? r.right : r.left, y: r.bottom + 4 })
          setOpen((o) => !o)
        }}
      >
        {children}
      </button>
      {open && <Panel items={items} x={anchor.x} y={anchor.y} alignRight={alignRight} onClose={close} ignore={ref} />}
    </>
  )
}
