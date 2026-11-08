import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { fontFor, headerOf, paletteFor } from '../core'
import { useApp } from '../app/useApp'

/** Palette, font and media resolver for rendering the current deck. */
export function useDeckLook() {
  const header = useApp((s) => headerOf(s.doc))
  const media = useApp((s) => s.media)
  const mediaRev = useApp((s) => s.mediaRev)
  const palette = useMemo(() => paletteFor(header), [header])
  const font = fontFor(header)
  const resolveMedia = useMemo(
    () => (name: string) => (media ? media.resolve(name) : Promise.resolve(null)),
    // mediaRev forces a new resolver (and re-render of slides) when files change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [media, mediaRev],
  )
  return { palette, font, resolveMedia }
}

/** Size of an element, updated on resize. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/** True once the element has come near the viewport (stays true). */
export function useSeen<T extends HTMLElement>(margin = '600px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, margin])
  return [ref, seen]
}
