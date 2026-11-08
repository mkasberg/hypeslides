import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { DndContext, DragOverlay, PointerSensor, pointerWithin, closestCenter, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { CollisionDetection, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { parsedDeck, selectionRange } from '../core'
import type { Palette } from '../core'
import { SlideView } from '../render'
import type { MediaResolver } from '../render'
import { useApp } from '../app/useApp'
import { runCommand } from '../app/shortcuts'
import { ContextMenu } from './Menu'
import type { MenuItem } from './Menu'
import { PlusIcon } from './icons'
import { useDeckLook, useSeen } from './slideHooks'

interface ItemProps {
  index: number
  source: string
  selected: boolean
  primary: boolean
  dragging: boolean
  indicatorBefore: boolean
  indicatorAfter: boolean
  palette: Palette
  font: string
  resolveMedia: MediaResolver
  variant: 'sidebar' | 'overview'
  onPick(index: number, e: ReactMouseEvent): void
  onOpen(index: number): void
  onMenu(index: number, e: ReactMouseEvent): void
}

function Thumb({ source, palette, font, resolveMedia }: Pick<ItemProps, 'source' | 'palette' | 'font' | 'resolveMedia'>) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  return (
    <div className="thumb" ref={ref}>
      {seen && <SlideView source={source} palette={palette} font={font} resolveMedia={resolveMedia} mode="thumbnail" />}
    </div>
  )
}

const Item = memo(function Item(p: ItemProps) {
  const drag = useDraggable({ id: p.index })
  const drop = useDroppable({ id: p.index })
  return (
    <div
      ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el) }}
      id={`slide-item-${p.index}`}
      className={`slide-item ${p.variant}${p.selected ? ' selected' : ''}${p.primary ? ' primary' : ''}${p.dragging ? ' dragging' : ''}${p.indicatorBefore ? ' ind-before' : ''}${p.indicatorAfter ? ' ind-after' : ''}`}
      {...drag.attributes}
      role="option"
      aria-selected={p.selected}
      tabIndex={-1}
      onClick={(e) => p.onPick(p.index, e)}
      onDoubleClick={() => p.onOpen(p.index)}
      onContextMenu={(e) => p.onMenu(p.index, e)}
      {...drag.listeners}
    >
      <span className="slide-number">{p.index + 1}</span>
      <Thumb source={p.source} palette={p.palette} font={p.font} resolveMedia={p.resolveMedia} />
    </div>
  )
})

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : closestCenter(args)
}

/** The slide strip: sidebar column or Overview grid. */
export function SlideList({ variant }: { variant: 'sidebar' | 'overview' }) {
  const doc = useApp((s) => s.doc)
  const { palette, font, resolveMedia } = useDeckLook()
  const slides = parsedDeck(doc).slides
  const { first, last, count } = selectionRange(doc)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [slot, setSlot] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const justDragged = useRef(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const selRef = useRef({ first, last })
  selRef.current = { first, last }

  // Keep the selection in view.
  useEffect(() => {
    document.getElementById(`slide-item-${doc.selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [doc.selected, variant])

  // Overview: report how many slides fit in a row (up/down move by a row).
  useEffect(() => {
    const el = listRef.current
    if (variant !== 'overview' || !el) return
    const measure = () => useApp.getState().setRowStep(getComputedStyle(el).gridTemplateColumns.split(' ').length)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      useApp.getState().setRowStep(1)
    }
  }, [variant])

  // The wheel over the sidebar selects the previous / next slide.
  useEffect(() => {
    const el = listRef.current
    if (variant !== 'sidebar' || !el) return
    let acc = 0
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) < 40) return
      useApp.getState().step(acc > 0 ? 1 : -1)
      acc = 0
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [variant])

  const pick = useCallback((index: number, e: ReactMouseEvent) => {
    if (performance.now() - justDragged.current < 200) return
    const s = useApp.getState()
    if (e.shiftKey) s.extendTo(index)
    else s.select(index)
  }, [])
  const open = useCallback((index: number) => {
    const s = useApp.getState()
    s.select(index)
    if (s.mode === 'overview') runCommand('overview.open')
  }, [])
  const showMenu = useCallback((index: number, e: ReactMouseEvent) => {
    e.preventDefault()
    const s = useApp.getState()
    const r = selectionRange(s.doc)
    if (index < r.first || index > r.last) s.select(index)
    setMenu({ x: e.clientX, y: e.clientY, items: slideMenu() })
  }, [])

  const slotFor = (e: DragOverEvent): number | null => {
    const over = e.over
    if (!over) return null
    const o = Number(over.id)
    const { first: f, last: l } = selRef.current
    if (o >= f && o <= l) return null
    const ev = e.activatorEvent as PointerEvent
    const rect = over.rect
    const pointer = variant === 'overview' ? ev.clientX + e.delta.x : ev.clientY + e.delta.y
    const mid = variant === 'overview' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    const s = pointer < mid ? o : o + 1
    return s >= f && s <= l + 1 ? null : s
  }

  const onStart = (e: DragStartEvent) => {
    const i = Number(e.active.id)
    const s = useApp.getState()
    const r = selectionRange(s.doc)
    if (i < r.first || i > r.last) s.select(i)
    setActiveIndex(i)
  }
  const onEnd = () => {
    const target = slot
    setActiveIndex(null)
    setSlot(null)
    justDragged.current = performance.now()
    if (target !== null) useApp.getState().drop(target)
  }

  const activeSource = activeIndex === null ? '' : slides[activeIndex]?.source ?? ''

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onStart}
      onDragOver={(e) => setSlot(slotFor(e))}
      onDragEnd={onEnd}
      onDragCancel={() => { setActiveIndex(null); setSlot(null) }}
    >
      <div
        ref={listRef}
        className={`slide-list ${variant}`}
        data-slide-list
        role="listbox"
        aria-multiselectable="true"
        aria-label="Slides"
        tabIndex={0}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, items: slideMenu() })
          }
        }}
      >
        {slides.map((s, i) => (
          <Item
            key={i}
            index={i}
            source={s.source}
            selected={i >= first && i <= last}
            primary={i === doc.selected}
            dragging={activeIndex !== null && i >= first && i <= last}
            indicatorBefore={slot === i}
            indicatorAfter={slot === slides.length && i === slides.length - 1}
            palette={palette}
            font={font}
            resolveMedia={resolveMedia}
            variant={variant}
            onPick={pick}
            onOpen={open}
            onMenu={showMenu}
          />
        ))}
        {variant === 'sidebar' && (
          <button type="button" className="new-slide" onClick={() => runCommand('slide.add')}>
            <PlusIcon /> New slide
          </button>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeIndex !== null && (
          <div className="drag-ghost">
            <Thumb source={activeSource} palette={palette} font={font} resolveMedia={resolveMedia} />
            {count > 1 && <span className="drag-count">{count}</span>}
          </div>
        )}
      </DragOverlay>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </DndContext>
  )
}

function slideMenu(): MenuItem[] {
  const n = selectionRange(useApp.getState().doc).count
  return [
    { label: 'Add slide', shortcut: 'Ctrl+Enter', onSelect: () => runCommand('slide.add') },
    { label: n > 1 ? `Duplicate ${n} slides` : 'Duplicate slide', shortcut: 'Ctrl+D', onSelect: () => runCommand('slide.duplicate') },
    { separator: true },
    { label: n > 1 ? `Delete ${n} slides` : 'Delete slide', shortcut: 'Del', onSelect: () => runCommand('slide.delete') },
  ]
}
