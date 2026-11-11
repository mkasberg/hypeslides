// Pure layout rules ported from ~/code/hype/src/renderer.cpp (mediaRect,
// text mode detection, svg theming). No DOM, so they are unit-testable.

import type { MediaPosition, SlideMedia } from '../core'
import { hasTable } from './markdown'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: Rect = { x: 0, y: 0, w: 1920, h: 1080 }

/** `<!-- hype: key="value" -->` slide property (background / foreground / alignment). */
export function slideProperty(source: string, key: string): string {
  const m = new RegExp(`<!--\\s*hype:[\\s\\S]*?\\b${key}="([^"]*)"[\\s\\S]*?-->`).exec(source)
  return m ? m[1] : ''
}

export function horizontal(position: MediaPosition | undefined): 'left' | 'center' | 'right' {
  if (!position) return 'center'
  return position.includes('left') ? 'left' : position.includes('right') ? 'right' : 'center'
}
export function vertical(position: MediaPosition | undefined): 'top' | 'center' | 'bottom' {
  if (!position) return 'center'
  return position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'center'
}

/** The box an image/video is drawn in. */
export function mediaRect(media: SlideMedia): Rect {
  if (media.position) {
    const size = media.size ?? 10
    const w = (1920 * size) / 100
    const h = (1080 * size) / 100
    // The margin shrinks as the box grows, so large images stay on the slide.
    const margin = Math.min(60, (1080 - h) / 2)
    const inner: Rect = { x: margin, y: margin, w: 1920 - 2 * margin, h: 1080 - 2 * margin }
    const hz = horizontal(media.position)
    const vt = vertical(media.position)
    return {
      x: hz === 'left' ? inner.x : hz === 'right' ? inner.x + inner.w - w : inner.x + (inner.w - w) / 2,
      y: vt === 'top' ? inner.y : vt === 'bottom' ? inner.y + inner.h - h : inner.y + (inner.h - h) / 2,
      w,
      h,
    }
  }
  if (media.span) return FULL
  if (!media.video || media.text.trim() === '') return { x: 70, y: 50, w: 1780, h: 980 }
  return { x: 100, y: 280, w: 1720, h: 730 }
}

export const DEFAULT_AREA: Rect = { x: 130, y: 90, w: 1660, h: 900 }
export const BAND_AREA: Rect = { x: 130, y: 40, w: 1660, h: 205 }

export interface TextMode {
  code: boolean
  quote: boolean
  list: boolean
  table: boolean
  centered: boolean
  /** Largest font size (px at 1080p) to try. */
  high: number
}

export function textMode(text: string, alignment: string, videoFit: boolean): TextMode {
  const code = /^ {0,3}(`{3,}|~{3,})/m.test(text)
  const quote = text.startsWith('>')
  const list = /^\s*(?:[-*+] |[0-9]+[.)] )/m.test(text)
  const table = hasTable(text)
  const tableOnly = table && !text.split('\n').some((l) => !l.includes('|') && /\S/.test(l))
  let centered = tableOnly || !(code || quote || list || table)
  if (alignment === 'left') centered = false
  if (alignment === 'center') centered = true
  const stack = /[\r\n]/.test(text) && !text.startsWith('#') && !quote && !list && !code
  let high = code ? 56 : quote ? 64 : list || table ? 72 : stack ? 128 : 76
  if (videoFit) high = 48
  return { code, quote, list, table, centered, high }
}

/** Remove scripts, event handlers and script URLs from author SVG. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*script\b[^>]*\/?>/gi, '')
    .replace(/<\s*foreignObject\b[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\b(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '')
}

/** Ensure the root `<svg>` can scale: give it a viewBox from width/height if missing. */
export function scalableSvg(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (whole, attrs: string) => {
    if (/\sviewBox\s*=/i.test(attrs)) return whole
    const w = /\swidth\s*=\s*["']?([\d.]+)/i.exec(attrs)
    const h = /\sheight\s*=\s*["']?([\d.]+)/i.exec(attrs)
    return w && h ? `<svg viewBox="0 0 ${w[1]} ${h[1]}"${attrs}>` : whole
  })
}

/** Luminance-based readable ink for text over `rgb`, like Hype's edge-color match. */
export function inkFor(r: number, g: number, b: number): string {
  return (r / 255) * 0.2126 + (g / 255) * 0.7152 + (b / 255) * 0.0722 > 0.55 ? '#161616' : '#ffffff'
}

/** Parse a Hype color (#rgb, #rrggbb, #aarrggbb, CSS names via `named`) to rgb + CSS string. */
export function parseColor(
  value: string,
  named?: (name: string) => [number, number, number] | null,
): { css: string; rgb: [number, number, number] } | null {
  const v = value.trim()
  const hex = /^#([0-9a-f]+)$/i.exec(v)
  if (hex) {
    const h = hex[1]
    if (h.length === 3) {
      const rgb = [...h].map((c) => parseInt(c + c, 16)) as [number, number, number]
      return { css: v, rgb }
    }
    if (h.length === 6) return { css: v, rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number] }
    if (h.length === 8) {
      const [a, r, g, b] = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16))
      return { css: `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`, rgb: [r, g, b] }
    }
    return null
  }
  if (/^[a-z]+$/i.test(v)) {
    const rgb = v.toLowerCase() === 'white' ? [255, 255, 255] : v.toLowerCase() === 'black' ? [0, 0, 0] : named?.(v) ?? null
    return rgb ? { css: v, rgb: rgb as [number, number, number] } : null
  }
  return null
}

/**
 * Natural line height (hhea ascent + descent + lineGap, in em) of the bundled
 * fonts. Qt's ProportionalHeight(N%) scales the font's natural line height,
 * not its size, but CSS `line-height: <number>` scales the font size, so we
 * multiply the two ourselves.
 */
const NATURAL_LINE_HEIGHT: Record<string, number> = {
  'jetbrains mono': 1.32,
  'fira code': 1.312,
  'source code pro': 1.257,
  inter: 1.21,
}

/** CSS unitless `line-height` equal to Qt's `percent`/100 of the font's natural line height. */
export function lineHeightEm(font: string, scale: number): string {
  const name = font.replace(/["'\\]/g, '').trim().toLowerCase()
  const natural = NATURAL_LINE_HEIGHT[name] ?? (/mono|code|courier|consol/.test(name) ? 1.3 : 1.2)
  return String(+(natural * scale).toFixed(4))
}

/**
 * Qt adds a proportional line height's extra leading below each line, so glyphs sit at the top of
 * their line box; CSS splits it above and below. This is half of that extra (in em), the amount to
 * shift a block up by to match Qt.
 */
export function halfLeadingEm(font: string, scale: number): string {
  return `${+((Number(lineHeightEm(font, 1)) * (scale - 1)) / 2).toFixed(4)}em`
}

/**
 * Column widths for a table wider than `available`, like Qt's table layout: a column whose
 * max-content width fits an equal share of what is left keeps that width; the rest split the
 * remainder equally, but never below their min-content width.
 */
export function tableColumnWidths(min: number[], max: number[], available: number): number[] {
  const widths = max.map((w, i) => Math.max(w, min[i]))
  if (widths.reduce((a, b) => a + b, 0) <= available) return widths
  const open = new Set(widths.keys())
  let remaining = available
  for (let changed = true; changed && open.size; ) {
    changed = false
    const share = remaining / open.size
    for (const i of [...open]) {
      if (widths[i] <= share) {
        remaining -= widths[i]
        open.delete(i)
        changed = true
      }
    }
  }
  const share = remaining / open.size
  for (const i of open) widths[i] = Math.max(min[i], Math.floor(share))
  return widths
}
