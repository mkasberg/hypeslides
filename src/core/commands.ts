// Document commands: pure `(DocState, ...args) => DocState`. Ported from the
// Deck methods in ~/code/hype/src/deck.cpp. Every document edit goes through
// here (UI, shortcuts, undo, agent tools).
//
// Commands that would be a no-op in Hype return the same state object.

import {
  mediaWithBackground, mediaWithMode, mediaWithPosition, mediaWithSize, withReplacedMedia,
} from './media'
import { parseDeck, replaceHeader, replaceSlides, setScalar, withoutSlidePadding } from './parse'
import { PALETTE_KEYS, getTheme } from './themes'
import type { DocState, ParsedDeck } from './types'

// ---- queries ----------------------------------------------------------

/** The slide structure for a state (cached structure when still valid). */
export function parsedDeck(state: DocState): ParsedDeck {
  return state.structure && state.structure.source === state.source
    ? state.structure.parsed
    : parseDeck(state.source)
}

export function slideCount(state: DocState): number {
  return parsedDeck(state).slides.length
}

/** Source of slide `i` ('' when out of range). */
export function slideAt(state: DocState, i: number): string {
  return parsedDeck(state).slides[i]?.source ?? ''
}

/** Source of the selected slide. */
export function selectedSlide(state: DocState): string {
  return slideAt(state, state.selected)
}

export function selectionRange(state: DocState): { first: number; last: number; count: number } {
  const first = Math.min(state.anchor, state.selected)
  const last = Math.max(state.anchor, state.selected)
  return { first, last, count: last - first + 1 }
}

/** Offset in the document where the selected slide starts. */
export function sourcePosition(state: DocState): number {
  return parsedDeck(state).slides[state.selected]?.start ?? 0
}

/** Offset just past the selected slide. */
export function sourceEndPosition(state: DocState): number {
  return parsedDeck(state).slides[state.selected]?.end ?? 0
}

export function headerOf(state: DocState): string {
  return parsedDeck(state).header
}

// ---- internals --------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Hype's apply(): install a new source (with optional known structure) and clamp the selection. */
function apply(state: DocState, source: string, selected: number, anchor?: number, structure?: ParsedDeck): DocState {
  if (source === state.source && !structure) {
    const n = slideCount(state)
    return {
      ...state,
      anchor: clamp(anchor ?? selected, 0, n - 1),
      selected: clamp(selected, 0, n - 1),
    }
  }
  let parsed = structure
  if (parsed) {
    // A slide body cannot contain front matter: prefix a plain line so a leading --- is a slide break.
    let error: string | undefined
    for (const slide of parsed.slides) {
      error = parseDeck('Slide\n' + slide.source).error
      if (error) break
    }
    parsed = { header: parsed.header, slides: parsed.slides }
    if (error) parsed.error = error
  } else {
    parsed = parseDeck(source)
  }
  const n = parsed.slides.length
  return {
    source,
    selected: clamp(selected, 0, n - 1),
    anchor: clamp(anchor ?? selected, 0, n - 1),
    structure: { source, parsed },
  }
}

function slideSources(state: DocState): string[] {
  return parsedDeck(state).slides.map((s) => s.source)
}

function rebuild(state: DocState, slides: string[], selected: number, anchor?: number): DocState {
  const { source, parsed } = replaceSlides(headerOf(state), slides)
  return apply(state, source, selected, anchor, parsed)
}

function replaceHeaderCmd(state: DocState, header: string): DocState {
  const parsed = parsedDeck(state)
  const r = replaceHeader(state.source, parsed, header)
  return apply(state, r.source, state.selected, undefined, r.parsed)
}

// ---- selection --------------------------------------------------------

export function select(state: DocState, index: number): DocState {
  index = clamp(index, 0, slideCount(state) - 1)
  if (state.selected === index && state.anchor === index) return state
  return { ...state, selected: index, anchor: index }
}

export function extendSelection(state: DocState, index: number): DocState {
  index = clamp(index, 0, slideCount(state) - 1)
  if (state.selected === index) return state
  return { ...state, selected: index }
}

/** Select the slide containing a document offset (front matter selects the first slide). */
export function selectAt(state: DocState, offset: number): DocState {
  const slides = parsedDeck(state).slides
  for (let i = slides.length - 1; i >= 0; i--) if (offset >= slides[i].start) return select(state, i)
  return select(state, 0)
}

// ---- editing ----------------------------------------------------------

/** Replace the whole document. */
export function editSource(state: DocState, source: string): DocState {
  return apply(state, source, state.selected)
}

/**
 * Replace one slide's Markdown (default: the selected slide). Only that slide
 * is reparsed, so an unfinished code fence cannot swallow the next slides.
 */
export function editSlide(state: DocState, newSource: string, index: number = state.selected): DocState {
  const parsed = parsedDeck(state)
  const range = parsed.slides[index]
  if (!range) return state
  let body = withoutSlidePadding(newSource)
  if (body) {
    if (range.start > 0) body = '\n' + body
    body += index < parsed.slides.length - 1 ? '\n\n' : '\n'
  } else {
    body = '\n'
  }
  const edited = state.source.slice(0, range.start) + body + state.source.slice(range.end)
  // A no-op must not create a new document state.
  if (edited === state.source) return state

  const prefix = 'Slide\n'
  const fragment = parseDeck(prefix + body)
  const shift = body.length - (range.end - range.start)
  const slides = parsed.slides.map((s, i) =>
    i > index ? { ...s, start: s.start + shift, end: s.end + shift } : s,
  )
  const inserted = fragment.slides.map((slide, i) => {
    const start = Math.max(0, slide.start - prefix.length)
    const end = slide.end - prefix.length
    return {
      source: body.slice(start, end),
      start: range.start + start,
      end: range.start + end,
      separator: i < fragment.slides.length - 1 ? slide.separator : undefined,
    }
  })
  // The edited slide's last fragment inherits the original slide's separator.
  const last = inserted[inserted.length - 1]
  last.separator = range.separator
  slides.splice(index, 1, ...inserted)
  const structure: ParsedDeck = { header: parsed.header, slides }
  return apply(state, edited, state.selected, undefined, structure)
}

// ---- slide structure --------------------------------------------------

/** Move one slide from `from` to `to`, selecting it. */
export function moveSlide(state: DocState, from: number, to: number): DocState {
  const n = slideCount(state)
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return state
  const list = slideSources(state)
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return rebuild(state, list, to)
}

/**
 * Move the selected range so it lands in drop slot `slot` (0..count; slot k is
 * the gap before slide k), keeping the selection on the moved slides.
 */
export function dropSelection(state: DocState, slot: number): DocState {
  const { first, last, count } = selectionRange(state)
  if (slot < 0 || slot > slideCount(state) || (slot >= first && slot <= last + 1)) return state
  const slides = slideSources(state)
  const moving = slides.splice(first, count)
  const destination = slot > last ? slot - count : slot
  slides.splice(destination, 0, ...moving)
  const offset = destination - first
  return rebuild(state, slides, state.selected + offset, state.anchor + offset)
}
export const moveSlides = dropSelection

/** Move the selected range one slide up (-1) or down (+1). */
export function moveSelection(state: DocState, direction: number): DocState {
  const { first, last } = selectionRange(state)
  if (direction < 0 && first > 0) return dropSelection(state, first - 1)
  if (direction > 0 && last < slideCount(state) - 1) return dropSelection(state, last + 2)
  return state
}

/** Insert an empty slide after the selection and select it. */
export function addSlide(state: DocState): DocState {
  const list = slideSources(state)
  const next = selectionRange(state).last + 1
  list.splice(next, 0, '\n\n')
  return rebuild(state, list, next)
}

/** Duplicate the selected slides right after themselves; selection moves to the copies. */
export function duplicateSlides(state: DocState): DocState {
  const list = slideSources(state)
  const { first, last, count } = selectionRange(state)
  list.splice(last + 1, 0, ...list.slice(first, first + count))
  return rebuild(state, list, state.selected + count, state.anchor + count)
}

/** Delete the selected slides; deleting everything leaves one empty slide. */
export function deleteSlides(state: DocState): DocState {
  const list = slideSources(state)
  const { first, count } = selectionRange(state)
  list.splice(first, count)
  if (!list.length) list.push('\n')
  return rebuild(state, list, Math.min(first, list.length - 1))
}

// ---- theme and font ---------------------------------------------------

/** Header with `theme` set and the theme's palette recorded as color_* lines. */
export function chooseThemeHeader(header: string, name: string): string {
  let out = setScalar(header, 'theme', name)
  // Remove the old palette before recording the newly selected theme.
  out = out.replace(/^color_[a-z_]+:[^\n]*\n/gm, '')
  const theme = getTheme(name)
  if (theme) for (const key of PALETTE_KEYS) out = setScalar(out, 'color_' + key, theme.colors[key])
  return out
}

export function setTheme(state: DocState, name: string): DocState {
  return replaceHeaderCmd(state, chooseThemeHeader(headerOf(state), name))
}

export function setFont(state: DocState, family: string): DocState {
  const header = headerOf(state)
  const next = setScalar(header, 'font', family)
  return next === header ? state : replaceHeaderCmd(state, next)
}

/** Set an arbitrary front matter scalar (e.g. title). */
export function setHeaderScalar(state: DocState, key: string, value: string): DocState {
  const header = headerOf(state)
  const next = setScalar(header, key, value)
  return next === header ? state : replaceHeaderCmd(state, next)
}

// ---- media ------------------------------------------------------------

function editSelected(state: DocState, next: string | null): DocState {
  return next === null ? state : editSlide(state, next)
}

export function setMediaMode(state: DocState, mode: string): DocState {
  return editSelected(state, mediaWithMode(selectedSlide(state), mode))
}
export function setMediaBackground(state: DocState, mode: string): DocState {
  return editSelected(state, mediaWithBackground(selectedSlide(state), mode))
}
export function matchImageBackground(state: DocState, enabled: boolean): DocState {
  return setMediaBackground(state, enabled ? 'auto' : 'theme')
}
export function setMediaPosition(state: DocState, position: string): DocState {
  return editSelected(state, mediaWithPosition(selectedSlide(state), position))
}
export function setMediaSize(state: DocState, percent: number): DocState {
  return editSelected(state, mediaWithSize(selectedSlide(state), percent))
}
/** Put a media file (bare name or relative path) in the selected slide's media slot. */
export function replaceMedia(state: DocState, file: string): DocState {
  return editSlide(state, withReplacedMedia(selectedSlide(state), file))
}

/** A fresh DocState for a document, with the first slide selected. */
export function createState(source: string): DocState {
  return { source, selected: 0, anchor: 0 }
}
