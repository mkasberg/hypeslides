import { useEffect, useState } from 'react'
import { findProblems, fontFor, headerOf, parseDeck, slideProblemStatus } from '../core'
import type { Problem } from '../core'
import { mediaExistsFor } from '../app/problems'
import { useApp } from '../app/useApp'
import { measureTextSize, subscribeFonts } from '../render/fit'

/**
 * Hype's `check` for the open deck: findProblems from core, fed by the media
 * the store can resolve and by the renderer's measured text sizes (layout
 * needs a browser). Debounced; the cheap checks land first, the text-size
 * warnings follow once every slide has been laid out (cached per slide text).
 */
function useDeckProblems(): Problem[] {
  const source = useApp((s) => s.doc.source)
  const font = useApp((s) => fontFor(headerOf(s.doc)))
  const media = useApp((s) => s.media)
  const mediaRev = useApp((s) => s.mediaRev)
  const [fontRev, setFontRev] = useState(0)
  const [problems, setProblems] = useState<Problem[]>([])

  useEffect(() => subscribeFonts(() => setFontRev((n) => n + 1)), [])

  useEffect(() => {
    let cancelled = false
    let later: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(async () => {
      const parsed = parseDeck(source)
      const mediaExists = await mediaExistsFor(parsed, media)
      if (cancelled) return
      setProblems(findProblems(source, { mediaExists }, parsed))
      later = setTimeout(async () => {
        await document.fonts?.ready
        if (cancelled) return
        setProblems(findProblems(source, { mediaExists, textSize: (s) => measureTextSize(s, font) }, parsed))
      }, 50)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(later)
    }
  }, [source, font, media, mediaRev, fontRev])

  return problems
}

function describe(p: Problem): string {
  return p.slide === null ? p.message : slideProblemStatus(p.slide, [p])
}

/** Status-line summary of the deck's problems; click jumps to the next slide that has one. */
export function ProblemsIndicator() {
  const problems = useDeckProblems()
  const selected = useApp((s) => s.doc.selected)
  if (problems.length === 0) return <span className="problems" hidden data-testid="problems" />
  const errors = problems.filter((p) => p.severity === 'error').length
  const first = problems[0]
  const jump = () => {
    const slides = [...new Set(problems.flatMap((p) => (p.slide === null ? [] : [p.slide])))]
    const next = slides.find((i) => i > selected) ?? slides[0]
    if (next !== undefined) useApp.getState().select(next)
  }
  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`
  return (
    <button
      type="button"
      className={'problems' + (errors ? ' error' : ' warning')}
      data-testid="problems"
      title={problems.map(describe).join('\n')}
      onClick={jump}
    >
      <b>{count}</b> · {describe(first)}
    </button>
  )
}
