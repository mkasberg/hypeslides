// Render harness: draws ONE slide at exactly 1920×1080 (no scaling, no chrome)
// with the same <SlideView>, theme and font resolution as the app. Used by the
// Hype parity suite and, later, PPTX export and the agent `render_slide` tool.
//
//   /harness.html?deck=<name>&slide=N   dev server: deck from tests/parity/decks
//   /harness.html?demo                  all-themes demo
//   /harness.html                       empty stage, for programmatic use
//   window.hypeHarness.render({ markdown, media, slide })
//                                       resolves once fonts, images and video
//                                       first frames are ready to screenshot.
//   window.hypeHarness.renderPdf({ markdown, media })
//                                       mounts the PDF export's <PrintDeck> (every
//                                       slide, one print page each) and resolves when
//                                       it is ready to print, e.g. with page.pdf().
import '../fonts.css'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { fontFor, mediaDir, paletteFor, parseDeck, slideText, title } from '../core'
import { PrintDeck, SlideView, loadLanguage } from './index'
import type { MediaResolver } from './types'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './types'

export interface HarnessRequest {
  /** The whole deck's Markdown (front matter included). */
  markdown: string
  /**
   * Media file -> URL, keyed by path relative to the deck folder. A name as
   * written in the Markdown (`a.jpg`) is looked up as the app's media store
   * does: by that name, else under `images/` or `videos/` (core `mediaDir`).
   */
  media?: Record<string, string>
  /** 1-based slide number. */
  slide: number
  /** Resolve media missing from `media` against this base URL (dev viewing). */
  mediaBase?: string
}

export interface HarnessResult {
  /** Number of slides in the deck, as our parser splits it. */
  slideCount: number
  slide: number
}

const TIMEOUT_MS = 15000
const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const once = (el: EventTarget, ...events: string[]) =>
  new Promise<void>((resolve) => {
    const done = () => {
      events.forEach((e) => el.removeEventListener(e, done))
      resolve()
    }
    events.forEach((e) => el.addEventListener(e, done))
  })

async function settleVideo(v: HTMLVideoElement) {
  if (v.error) return
  if (v.readyState < 2) await Promise.race([once(v, 'loadeddata', 'error'), sleep(5000)])
  v.pause()
  if (v.readyState >= 2) {
    if (v.currentTime !== 0) {
      v.currentTime = 0
      if (v.seeking) await Promise.race([once(v, 'seeked', 'error'), sleep(3000)])
    }
    // First frame actually composited.
    if ('requestVideoFrameCallback' in v) {
      await Promise.race([new Promise<void>((r) => v.requestVideoFrameCallback(() => r())), sleep(1000)])
    }
  }
}

/** Everything that can still change the picture; false once it is all quiet. */
async function pendingMedia(stage: HTMLElement): Promise<boolean> {
  let pending = false
  for (const img of stage.querySelectorAll('img')) {
    if (!img.complete) {
      pending = true
      await Promise.race([once(img, 'load', 'error'), sleep(3000)])
    }
    await img.decode().catch(() => undefined)
  }
  for (const v of stage.querySelectorAll('video')) {
    if (v.readyState < 2 && !v.error) pending = true
    await settleVideo(v)
  }
  return pending
}

async function settle(stage: HTMLElement, font: string) {
  const deadline = Date.now() + TIMEOUT_MS
  await document.fonts.load(`16px "${font}"`).catch(() => undefined)
  await document.fonts.load(`700 16px "${font}"`).catch(() => undefined)
  await document.fonts.ready
  let last = ''
  let stable = 0
  // Re-check until the DOM stops changing: image edge colors, font-load
  // refits and syntax highlighting all re-render asynchronously.
  while (stable < 3 && Date.now() < deadline) {
    await raf()
    const pending = await pendingMedia(stage)
    await document.fonts.ready
    await sleep(40)
    const sig = stage.innerHTML
    if (!pending && sig === last) stable++
    else stable = 0
    last = sig
  }
  await raf()
  await raf()
}

let root: ReturnType<typeof createRoot> | null = null

async function render(req: HarnessRequest): Promise<HarnessResult> {
  const stage = document.getElementById('stage')!
  const parsed = parseDeck(req.markdown)
  const slideCount = parsed.slides.length
  if (req.slide < 1 || req.slide > slideCount) throw new Error(`slide ${req.slide} out of range (deck has ${slideCount})`)
  const source = slideText(parsed.slides[req.slide - 1].source)
  const palette = paletteFor(parsed.header)
  const font = fontFor(parsed.header)
  const resolveMedia = mediaResolver(req)
  // Highlighting is lazy; load the fence languages up front so the first
  // paint is already highlighted.
  await loadFenceLanguages(source)

  root ??= createRoot(stage)
  flushSync(() =>
    root!.render(
      <SlideView source={source} palette={palette} font={font} resolveMedia={resolveMedia} mode="preview" />,
    ),
  )
  await settle(stage, font)
  return { slideCount, slide: req.slide }
}

function mediaResolver(req: Pick<HarnessRequest, 'media' | 'mediaBase'>): MediaResolver {
  const media = req.media ?? {}
  return async (name: string) => {
    const path = name in media || `${mediaDir(name)}/${name}` in media ? (name in media ? name : `${mediaDir(name)}/${name}`) : null
    if (path !== null) return media[path]
    if (req.mediaBase === undefined) return null
    // Dev viewing: probe the folder convention over HTTP.
    for (const candidate of [name, `${mediaDir(name)}/${name}`]) {
      const url = req.mediaBase + candidate.split('/').map(encodeURIComponent).join('/')
      const r = await fetch(url, { method: 'HEAD' }).catch(() => null)
      if (r?.ok && !r.headers.get('content-type')?.includes('text/html')) return url
    }
    return null
  }
}

async function loadFenceLanguages(markdown: string) {
  const langs = [...markdown.matchAll(/^\s*(?:```|~~~)\s*([\w+#-]+)/gm)].map((m) => m[1])
  await Promise.all(langs.map((l) => loadLanguage(l)))
}

type PdfRequest = Omit<HarnessRequest, 'slide'>

let printRoot: ReturnType<typeof createRoot> | null = null

/**
 * Mounts the same <PrintDeck> the app's Export as PDF uses and resolves once
 * its readiness check passes. The document title is set as the app sets it
 * for printing (Hype's fallback, the file's base name, is `presentation`).
 */
async function renderPdf(req: PdfRequest): Promise<{ slideCount: number }> {
  const parsed = parseDeck(req.markdown)
  const slides = parsed.slides.map((s) => s.source)
  await loadFenceLanguages(req.markdown)
  document.title = title(parsed.header, 'presentation')
  printRoot ??= createRoot(document.createElement('div'))
  await new Promise<void>((onReady) =>
    printRoot!.render(
      <PrintDeck
        slides={slides}
        palette={paletteFor(parsed.header)}
        font={fontFor(parsed.header)}
        resolveMedia={mediaResolver(req)}
        onReady={onReady}
      />,
    ),
  )
  return { slideCount: slides.length }
}

declare global {
  interface Window {
    hypeHarness: { render: typeof render; renderPdf: typeof renderPdf }
  }
}
window.hypeHarness = { render, renderPdf }

async function main() {
  const q = new URLSearchParams(location.search)
  const host = document.getElementById('root')!
  if (q.has('demo')) {
    document.body.style.background = '#222'
    const { mountDemo } = await import('./demo')
    mountDemo(host)
    return
  }
  host.innerHTML = `<div id="stage" style="position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden"></div>`
  const deck = q.get('deck')
  if (!deck) return // programmatic use: call window.hypeHarness.render(...)
  const base = `/tests/parity/decks/${encodeURIComponent(deck)}/`
  const res = await fetch(base + 'presentation.md')
  if (!res.ok) throw new Error(`deck ${deck}: ${res.status}`)
  await render({ markdown: await res.text(), slide: Number(q.get('slide') ?? 1), mediaBase: base })
}

void main()
