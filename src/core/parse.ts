// Deck parsing, ported from ~/code/hype/src/deck.cpp (parseDeck, scalar,
// setScalar, replaceSlides, replaceHeader). All offsets are UTF-16 code unit
// offsets, like Qt's QString.

import type { ParsedDeck, Slide } from './types'

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/

export interface FenceRun {
  char: string
  length: number
  info: string
}

/** Matches an opening/closing code fence line (indent <= 3 spaces). */
export function matchFence(line: string): FenceRun | null {
  const m = FENCE_RE.exec(line)
  return m ? { char: m[1][0], length: m[1].length, info: m[2] } : null
}

/** Parse a document into front matter and slides, exactly as Hype does. */
export function parseDeck(source: string): ParsedDeck {
  const result: ParsedDeck = { header: '', slides: [] }
  let contentStart = source.startsWith('﻿') ? 1 : 0
  let next = 0
  const lineAt = (offset: number): string => {
    const nl = source.indexOf('\n', offset)
    next = nl < 0 ? source.length : nl + 1
    let line = source.slice(offset, nl < 0 ? source.length : nl)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    return line
  }

  if (lineAt(contentStart) === '---') {
    let offset = next
    let closed = false
    while (offset < source.length) {
      const line = lineAt(offset)
      if (line === '---') {
        contentStart = next
        closed = true
        break
      }
      offset = next
    }
    if (!closed) {
      result.error = 'Front matter needs a closing ---'
      result.errorOffset = contentStart
      result.slides.push({ source, start: 0, end: source.length })
      return result
    }
  }
  result.header = source.slice(0, contentStart)

  let start = contentStart
  let pos = start
  let fenceLength = 0
  let fenceStart = 0
  let fence = ''
  while (pos < source.length) {
    const line = lineAt(pos)
    const run = matchFence(line)
    if (run) {
      if (fenceLength === 0) {
        fence = run.char
        fenceLength = run.length
        fenceStart = pos
      } else if (run.char === fence && run.length >= fenceLength && run.info.trim() === '') {
        fenceLength = 0
      }
    } else if (fenceLength === 0 && line === '---') {
      result.slides.push({
        source: source.slice(start, pos),
        start,
        end: pos,
        separator: source.slice(pos, next),
      })
      start = next
    }
    pos = next
  }
  result.slides.push({ source: source.slice(start), start, end: source.length })
  if (fenceLength && !result.error) {
    result.error = 'Unclosed code fence'
    result.errorOffset = fenceStart
  }
  return result
}

/** Lossless inverse of parseDeck: header + slides joined by their original separators. */
export function serializeDeck(deck: ParsedDeck): string {
  let out = deck.header
  deck.slides.forEach((slide, i) => {
    out += slide.source
    if (i < deck.slides.length - 1) out += slide.separator ?? '---\n'
  })
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Read a `key: value` front matter scalar (plain, "JSON", or 'single' quoted). */
export function scalar(header: string, key: string, fallback = ''): string {
  const m = new RegExp('^' + escapeRe(key) + ':[ \\t]*([^\\r\\n]*)$', 'm').exec(header)
  if (!m) return fallback
  const value = m[1].trim()
  if (value.length >= 1 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const v: unknown = JSON.parse(value)
      if (typeof v === 'string') return v
    } catch {
      // fall through to the raw value
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'")
  return value
}

/** Set (or add) a front matter scalar, creating front matter if there is none. */
export function setScalar(header: string, key: string, value: string): string {
  const line = key + ': ' + JSON.stringify(value)
  const re = new RegExp('^' + escapeRe(key) + ':[^\\r\\n]*', 'm')
  const m = re.exec(header)
  if (m) return header.slice(0, m.index) + line + header.slice(m.index + m[0].length)
  const bom = header.startsWith('﻿') ? '﻿' : ''
  if (header.slice(bom.length) === '') return bom + '---\n' + line + '\n---\n'
  const end = header.lastIndexOf('---')
  return header.slice(0, end) + line + '\n' + header.slice(end)
}

/** Strip boundary blank lines (not indentation); whitespace-only becomes ''. */
export function withoutSlidePadding(text: string): string {
  const t = text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '')
  return t.trim() === '' ? '' : t
}

/** Slide text as the visual editor shows it (no padding). */
export const slideText = withoutSlidePadding

/**
 * Hype's replaceSlides: rebuild the document from a header and slide sources,
 * normalizing the blank lines around `---`. Returns the source and the slide
 * structure it implies (which can differ from parseDeck for unfinished fences).
 */
export function replaceSlides(header: string, slides: string[]): { source: string; parsed: ParsedDeck } {
  let out = header
  const parsed: ParsedDeck = { header, slides: [] }
  for (let i = 0; i < slides.length; i++) {
    if (i) out += '---\n'
    const start = out.length
    const body = withoutSlidePadding(slides[i])
    if (body) {
      if (out) out += '\n'
      out += body + '\n'
    }
    if (i < slides.length - 1 || !body) out += '\n'
    const slide: Slide = { source: out.slice(start), start, end: out.length }
    parsed.slides.push(slide)
  }
  // Separators exist between slides; derive them for lossless serialization.
  for (let i = 0; i < parsed.slides.length - 1; i++) parsed.slides[i].separator = '---\n'
  return { source: out, parsed }
}

/** Hype's replaceHeader: swap the header, shifting slide offsets. */
export function replaceHeader(
  source: string,
  parsed: ParsedDeck,
  header: string,
): { source: string; parsed: ParsedDeck } {
  const shift = header.length - parsed.header.length
  return {
    source: header + source.slice(parsed.header.length),
    parsed: {
      ...parsed,
      header,
      slides: parsed.slides.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })),
    },
  }
}
