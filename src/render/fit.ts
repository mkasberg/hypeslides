// Text fitting (Hype's binary search for the largest size that fits the text
// area) and the font/highlighter change signals that invalidate it. Shared by
// <SlideView> and `measureTextSize`, which lays a slide's text out offscreen so
// `check` can warn about text that shrinks below a readable size without
// painting every slide.

import { parseMedia } from '../core'
import { onHighlighterChange } from './highlight'
import { halfLeadingEm, lineHeightEm, slideTextLayout, tableColumnWidths, type Rect } from './layout'
import { renderSlideHtml } from './markdown'
import { ensureStyles, fontStack } from './styles'

// ---- external stores: highlighter readiness and font loading -----------------

export let fontEpoch = 0
const fontListeners = new Set<() => void>()
let watchingFonts = false
export function watchFonts() {
  if (watchingFonts || typeof document === 'undefined' || !document.fonts) return
  watchingFonts = true
  document.fonts.addEventListener('loadingdone', () => {
    fontEpoch++
    fitCache.clear()
    fontListeners.forEach((fn) => fn())
  })
}
export const subscribeFonts = (fn: () => void) => {
  fontListeners.add(fn)
  return () => void fontListeners.delete(fn)
}
export let highlightVersion = 0
onHighlighterChange(() => highlightVersion++)
export const subscribeHighlight = (fn: () => void) => onHighlighterChange(fn)

// ---- text fitting -------------------------------------------------------------

export const fitCache = new Map<string, number>()
const FIT_CACHE_MAX = 4096

/**
 * Qt's proportional line height (115% / 120%) adds its extra leading to every line but the last,
 * so the document height Hype fits against is shorter than ours by one line's extra
 * (verified against the parity suite).
 */
function slack(el: HTMLElement, scale: number): number {
  let node: Element = el
  while (node.lastElementChild && node.lastElementChild.tagName !== 'TABLE') node = node.lastElementChild
  const lh = parseFloat(getComputedStyle(node).lineHeight)
  return Number.isFinite(lh) ? lh * (1 - 1 / scale) : 0
}

/**
 * Qt sizes table columns to their content and, when that is wider than the slide, wraps only the
 * wide columns: columns whose content fits an equal share keep it, the rest split what is left.
 * Browser auto layout shrinks every column in proportion instead, so set the widths ourselves.
 */
function layoutTables(el: HTMLElement, width: number) {
  for (const table of el.querySelectorAll('table')) {
    const cells = Array.from(table.rows[0]?.cells ?? [])
    if (!cells.length) continue
    const reset = () => {
      table.style.tableLayout = ''
      table.style.width = ''
      cells.forEach((c) => (c.style.width = ''))
    }
    reset()
    table.style.whiteSpace = 'nowrap'
    const max = cells.map((c) => c.offsetWidth + 1)
    table.style.whiteSpace = ''
    if (max.reduce((a, b) => a + b, 0) <= width) continue
    table.style.width = '1px'
    const min = cells.map((c) => c.offsetWidth + 1)
    table.style.width = ''
    const widths = tableColumnWidths(min, max, width)
    table.style.tableLayout = 'fixed'
    table.style.width = widths.reduce((a, b) => a + b, 0) + 'px'
    cells.forEach((c, i) => (c.style.width = widths[i] + 'px'))
  }
}

/**
 * Size `el` to the largest font size (8px..high) that fits `area`; returns it. `scale` is the
 * proportional line height (1.15 body, 1.2 code).
 */
export function fitText(el: HTMLElement, area: Rect, high: number, key: string, scale: number): number {
  const setSize = (size: number) => {
    el.style.fontSize = Math.round(size) + 'px'
    layoutTables(el, area.w)
  }
  const cached = fitCache.get(key)
  if (cached !== undefined) {
    setSize(cached)
    return cached
  }
  const fits = () => el.scrollHeight - slack(el, scale) <= area.h && el.scrollWidth <= area.w + 1
  let low = 8
  let size = high
  setSize(size)
  if (fits()) low = high
  else {
    for (let i = 0; i < 9; i++) {
      size = (low + high) / 2
      setSize(size)
      if (fits()) low = size
      else high = size
    }
    setSize(low)
  }
  if (fitCache.size >= FIT_CACHE_MAX) fitCache.clear()
  fitCache.set(key, low)
  return low
}

export function fitKeyFor(text: string, area: Rect, high: number, centered: boolean, code: boolean, font: string): string {
  return `${high} ${area.w} ${area.h} ${centered} ${code} ${font}\n${text}`
}

let host: HTMLDivElement | null = null

/**
 * The font size (px on a 1080p slide) a slide's text fits at, measured with the
 * real renderer's CSS in a hidden element. undefined when the slide has no
 * text. Colors never affect the fit, so no palette is needed. Browser only.
 */
export function measureTextSize(source: string, font: string): number | undefined {
  if (typeof document === 'undefined') return undefined
  const { text, area, tm } = slideTextLayout(source, parseMedia(source))
  if (!text) return undefined
  const key = fitKeyFor(text, area, tm.high, tm.centered, tm.code, font)
  const cached = fitCache.get(key)
  if (cached !== undefined) return cached
  ensureStyles()
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1920px;height:1080px;visibility:hidden;pointer-events:none'
    document.body.appendChild(host)
  }
  host.innerHTML = ''
  const slide = document.createElement('div')
  slide.className = 'hs-slide'
  slide.style.setProperty('--font', fontStack(font))
  slide.style.setProperty('--lh', lineHeightEm(font, 1.15))
  slide.style.setProperty('--half', halfLeadingEm(font, 1.15))
  slide.style.setProperty('--lh-code', lineHeightEm('JetBrains Mono', 1.2))
  slide.style.setProperty('--half-code', halfLeadingEm('JetBrains Mono', 1.2))
  const box = document.createElement('div')
  box.className = 'hs-text'
  Object.assign(box.style, { left: area.x + 'px', top: area.y + 'px', width: area.w + 'px', height: area.h + 'px' })
  const body = document.createElement('div')
  body.className = 'hs-body' + (tm.centered ? ' center' : '') + (tm.code ? ' code' : '')
  body.innerHTML = renderSlideHtml(text, {})
  box.appendChild(body)
  slide.appendChild(box)
  host.appendChild(slide)
  const size = fitText(body, area, tm.high, key, tm.code ? 1.2 : 1.15)
  host.innerHTML = ''
  return size
}
