import { useCallback, useEffect, useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { parsedDeck, selectedSlide, slideText, sourcePosition } from '../core'
import { SlideView } from '../render'
import { useApp } from '../app/useApp'
import { CodeEditor, setCursorQuietly } from './CodeEditor'
import { FormatBar } from './FormatBar'
import { SlideList } from './SlideList'
import { useDeckLook, useElementSize } from './slideHooks'

function Preview() {
  const source = useApp((s) => selectedSlide(s.doc))
  const { palette, font, resolveMedia } = useDeckLook()
  const [ref, size] = useElementSize<HTMLDivElement>()
  const pad = 24
  const w = Math.max(0, Math.min(size.w - pad * 2, (size.h - pad * 2) * (16 / 9)))
  return (
    <div className="preview-pane" ref={ref}>
      {w > 40 && (
        <div className="preview-box" style={{ width: w }}>
          <SlideView source={source} palette={palette} font={font} resolveMedia={resolveMedia} mode="preview" />
        </div>
      )}
    </div>
  )
}

function Divider({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const onDown = (e: React.PointerEvent) => {
    const el = containerRef.current
    if (!el) return
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      useApp.getState().setSplitRatio((ev.clientY - r.top) / r.height)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  return <div className="divider" role="separator" aria-orientation="horizontal" aria-label="Resize preview" onPointerDown={onDown} />
}

export function VisualView() {
  const text = useApp((s) => slideText(selectedSlide(s.doc)))
  const selected = useApp((s) => s.doc.selected)
  const ratio = useApp((s) => s.splitRatio)
  const col = useRef<HTMLDivElement>(null)
  return (
    <div className="workspace">
      <aside className="sidebar"><SlideList variant="sidebar" /></aside>
      <div className="main-col" ref={col}>
        <div style={{ flex: `${ratio} 1 0`, minHeight: 80, display: 'flex' }}><Preview /></div>
        <Divider containerRef={col} />
        <div className="editor-pane" style={{ flex: `${1 - ratio} 1 0`, minHeight: 120 }}>
          <FormatBar />
          <CodeEditor
            value={text}
            docKey={selected}
            normalize={slideText}
            onChange={(t) => useApp.getState().typeSlide(t)}
            ariaLabel="Slide Markdown"
            placeholder="Write this slide in Markdown"
          />
        </div>
      </div>
    </div>
  )
}

export function MarkdownView() {
  const source = useApp((s) => s.doc.source)
  const selected = useApp((s) => s.doc.selected)
  const view = useRef<EditorView | null>(null)

  // Slide selection from elsewhere (sidebar, shortcuts) moves the cursor to that slide.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const st = useApp.getState()
    const slides = parsedDeck(st.doc).slides
    const cursorSlide = slideIndexAt(slides, v.state.selection.main.head)
    if (cursorSlide === st.doc.selected) return
    const start = sourcePosition(st.doc)
    const body = slides[st.doc.selected]?.source ?? ''
    const lead = body.length - body.replace(/^\s+/, '').length
    setCursorQuietly(v, start + lead, true)
  }, [selected])

  const onReady = useCallback((v: EditorView | null) => {
    view.current = v
    if (v) {
      // Entering Markdown mode: reveal the selected slide.
      const st = useApp.getState()
      const slides = parsedDeck(st.doc).slides
      const body = slides[st.doc.selected]?.source ?? ''
      const lead = body.length - body.replace(/^\s+/, '').length
      setCursorQuietly(v, sourcePosition(st.doc) + lead, true)
    }
  }, [])

  return (
    <div className="workspace">
      <aside className="sidebar"><SlideList variant="sidebar" /></aside>
      <div className="main-col source-col">
        <FormatBar />
        <CodeEditor
          value={source}
          docKey="source"
          onChange={(t) => useApp.getState().typeSource(t)}
          onCursor={(offset) => {
            const st = useApp.getState()
            if (slideIndexAt(parsedDeck(st.doc).slides, offset) !== st.doc.selected) st.selectAtOffset(offset)
          }}
          onReady={onReady}
          lineNumbers
          ariaLabel="Presentation Markdown"
        />
      </div>
    </div>
  )
}

function slideIndexAt(slides: { start: number }[], offset: number): number {
  for (let i = slides.length - 1; i >= 0; i--) if (offset >= slides[i].start) return i
  return 0
}

export function OverviewView() {
  return (
    <div className="workspace overview-ws">
      <SlideList variant="overview" />
    </div>
  )
}
