import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Palette } from '../core/types'
import { highlighterIdle } from './highlight'
import { ensureStyles } from './styles'
import { SlideView } from './SlideView'
import type { MediaResolver } from './types'

// PDF export renders through the browser's print dialog so text stays vector
// (Hype's QPdfWriter pages are 13.333in x 7.5in = 1280x720 CSS px, the @page size). Each page
// holds a normal <SlideView> in 'export' mode, which scales the 1920x1080 slide
// to the page's width (2/3). Print CSS lives in styles.ts.

export interface PrintDeckProps {
  /** Each slide's Markdown (core `slideAt(...).source`), one printed page each. */
  slides: string[]
  palette: Palette
  font: string
  resolveMedia: MediaResolver
  /** Called once, when the output is final (see `whenPrintReady`). Safe to call `window.print()` then. */
  onReady?: () => void
}

/** Portaled into <body> so print CSS can hide the app by hiding its siblings. */
export function PrintDeck({ slides, palette, font, resolveMedia, onReady }: PrintDeckProps) {
  ensureStyles()
  const rootRef = useRef<HTMLDivElement>(null)
  const ready = useRef(onReady)
  ready.current = onReady
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let cancelled = false
    void whenPrintReady(root).then(() => !cancelled && ready.current?.())
    return () => {
      cancelled = true
    }
    // Re-run if the inputs change: the earlier readiness no longer holds.
  }, [slides, palette, font, resolveMedia])
  return createPortal(
    <div ref={rootRef} className="hs-print-root" aria-hidden="true">
      {slides.map((source, i) => (
        <div key={i} className="hs-print-page">
          <SlideView source={source} palette={palette} font={font} resolveMedia={resolveMedia} mode="export" />
        </div>
      ))}
    </div>,
    document.body,
  )
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Everything the painted output depends on that we can read back from the DOM. */
function signature(root: HTMLElement): string {
  const sizes = Array.from(root.querySelectorAll<HTMLElement>('.hs-body'), (b) => b.style.fontSize + '/' + b.innerHTML.length)
  const imgs = Array.from(root.querySelectorAll('img'), (i) => i.getAttribute('src'))
  return sizes.join(',') + '|' + imgs.join(',')
}

/**
 * Resolves when the printed output has settled: fonts loaded, syntax grammars
 * loaded, every slide's media resolved (`data-pending` cleared by SlideView),
 * images decoded, and the text-fit pass stable (the DOM signature unchanged
 * across two animation frames, since fonts/highlighting re-run the fit).
 * Resolves anyway after `timeoutMs` so a stuck asset can't block exporting.
 */
export function whenPrintReady(root: HTMLElement, timeoutMs = 15000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))
  let stopped = false
  const settle = async () => {
    for (let last = ''; !stopped; ) {
      await document.fonts?.ready
      await highlighterIdle()
      while (root.querySelector('[data-pending]')) await frame()
      await Promise.all(
        Array.from(root.querySelectorAll('img'), (img) => (img.getAttribute('src') ? img.decode?.().catch(() => undefined) : undefined)),
      )
      await frame()
      await frame()
      const sig = signature(root)
      if (sig === last && !root.querySelector('[data-pending]')) return
      last = sig
    }
  }
  return Promise.race([settle(), timeout]).finally(() => {
    stopped = true
    clearTimeout(timer)
  })
}
