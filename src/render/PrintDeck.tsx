import { useEffect, useEffectEvent, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Palette } from '../core/types'
import { ensureStyles } from './styles'
import { whenPrintReady } from './printReady'
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
  // Always the latest onReady, without re-running the readiness effect when it changes.
  const ready = useEffectEvent(() => onReady?.())
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let cancelled = false
    void whenPrintReady(root).then(() => !cancelled && ready())
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
