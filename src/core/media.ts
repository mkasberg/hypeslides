// Slide media: parsing `![options](file)` / ```svg blocks and rewriting the
// options. Ported from ~/code/hype/src/renderer.cpp (parseMedia, withMedia,
// withMediaDirectives, withReplacedMedia, speakerNotes, outsideCode) and the
// setMedia* functions in deck.cpp.

import { isValidColor } from './colors'
import { matchFence } from './parse'
import type { MediaPosition, SlideMedia } from './types'

export const MEDIA_POSITIONS: readonly MediaPosition[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
]
export const DEFAULT_PLACED_SIZE = 10

const MEDIA_RE = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)/
const COMMENT_RE = /<!--[\s\S]*?-->/g
const TOKEN_RE = /([a-z]+)(?:=("(?:[^"\\]|\\.)*"|[^\s]+))?/g
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv']

function extension(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}
export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(extension(name))
}
/** The directory a bare media file name lives in by convention. */
export function mediaDir(name: string): 'images' | 'videos' {
  return isVideoFile(name) ? 'videos' : 'images'
}

function blank(s: string, from: number, length: number): string {
  return s.slice(0, from) + ' '.repeat(length) + s.slice(from + length)
}

/** The source with code (fenced, indented, optionally inline) blanked to spaces; same length. */
export function outsideCode(source: string, maskInline = true): string {
  let position = 0
  let fenceLength = 0
  let fence = ''
  while (position < source.length) {
    let end = source.indexOf('\n', position)
    if (end < 0) end = source.length
    const line = source.slice(position, end)
    const run = matchFence(line)
    let protectedLine = fenceLength > 0
    if (run) {
      protectedLine = true
      if (!fenceLength) {
        fence = run.char
        fenceLength = run.length
      } else if (run.char === fence && run.length >= fenceLength && run.info.trim() === '') {
        fenceLength = 0
      }
    }
    if (protectedLine || line.startsWith('    ')) source = blank(source, position, end - position)
    position = end + 1
  }
  if (!maskInline) return source
  const inline = /(`+)([^`]|`(?!`))*?\1/g
  for (const m of [...source.matchAll(inline)]) source = blank(source, m.index, m[0].length)
  return source
}

function withoutComments(source: string): string {
  const ranges = [...outsideCode(source).matchAll(COMMENT_RE)]
  for (let i = ranges.length - 1; i >= 0; i--)
    source = source.slice(0, ranges[i].index) + source.slice(ranges[i].index + ranges[i][0].length)
  return source
}

/** Speaker notes: comments outside code that aren't `hype:` directives, joined by blank lines. */
export function speakerNotes(slideSource: string): string {
  const visible = outsideCode(slideSource)
  const notes: string[] = []
  for (const m of visible.matchAll(COMMENT_RE)) {
    const note = slideSource.slice(m.index + 4, m.index + m[0].length - 3).trim()
    if (note && !/^hype:/i.test(note)) notes.push(note)
  }
  return notes.join('\n\n')
}

/** The first fence in this language: taken out of the text, its lines returned as body. */
function takeFence(text: string, language: string): { text: string; body?: string } {
  let position = 0
  let fenceLength = 0
  let start = -1
  let content = 0
  let fence = ''
  while (position < text.length) {
    let end = text.indexOf('\n', position)
    if (end < 0) end = text.length
    const run = matchFence(text.slice(position, end))
    if (run) {
      if (!fenceLength) {
        fence = run.char
        fenceLength = run.length
        if (run.info.trim().split(' ')[0].toLowerCase() === language) {
          start = position
          content = Math.min(text.length, end + 1)
        }
      } else if (run.char === fence && run.length >= fenceLength && run.info.trim() === '') {
        fenceLength = 0
        if (start >= 0) {
          const cut = Math.min(text.length, end + 1)
          return { text: text.slice(0, start) + text.slice(cut), body: text.slice(content, position) }
        }
      }
    }
    position = end + 1
  }
  return { text }
}

interface Token {
  key: string
  value: string
  raw: string
  index: number
}
function tokenize(flags: string): Token[] {
  return [...flags.matchAll(TOKEN_RE)].map((m) => ({
    key: m[1],
    value: m[2] ?? '',
    raw: m[0],
    index: m.index,
  }))
}
function hasDirectives(flags: string): boolean {
  const first = tokenize(flags)[0]
  return !!first && first.index === 0 && (['fit', 'span', 'loop', 'muted'].includes(first.key) || first.value !== '')
}

function readMedia(source: string): SlideMedia | null {
  let text = withoutComments(source)
  const m = MEDIA_RE.exec(outsideCode(text))
  const media: SlideMedia = {
    file: '',
    dir: 'images',
    video: false,
    mode: 'auto',
    span: false,
    loop: false,
    muted: false,
    autoplay: true,
    text,
  }
  if (!m) return media
  media.file = m[2] || m[3]
  media.video = isVideoFile(media.file)
  media.dir = mediaDir(media.file)
  text = text.slice(0, m.index) + text.slice(m.index + m[0].length)
  media.text = text
  media.span = !media.video && /^# /m.test(outsideCode(text))

  const flags = m[1].trim()
  let explicitOverlay = ''
  let fit = false
  let span = false
  let error: string | undefined
  let size = 0
  if (hasDirectives(flags)) {
    let consumed = 0
    for (const token of tokenize(flags)) {
      if (flags.slice(consumed, token.index).trim() !== '') error = 'Invalid media directive'
      consumed = token.index + token.raw.length
      const key = token.key
      let value = token.value
      if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (key === 'span') {
        media.span = true
        span = true
        media.mode = 'span'
      } else if (key === 'fit') {
        media.span = false
        fit = true
        media.mode = 'fit'
      } else if (key === 'loop') media.loop = value !== 'false'
      else if (key === 'muted') media.muted = value !== 'false'
      else if (key === 'autoplay') media.autoplay = value !== 'false'
      else if (key === 'overlay') explicitOverlay = value
      else if (key === 'position') {
        media.position = value as MediaPosition
        if (!MEDIA_POSITIONS.includes(value as MediaPosition)) error = 'Unknown position'
      } else if (key === 'size') {
        const n = /^(\d{1,3}(?:\.\d+)?)%$/.exec(value)
        size = n ? parseFloat(n[1]) : 0
        if (size < 1 || size > 100) {
          error = 'Size must be a percentage from 1% to 100%'
          size = 0
        }
        if (!media.position) media.position = 'center'
      } else if (key === 'background') {
        media.background = value
        if (value !== 'auto' && value !== 'theme' && value !== 'blur' && !isValidColor(value))
          error = 'Invalid background color'
      } else if (key === 'poster') media.poster = value
      else if (key !== 'alt') error = 'Unknown media directive: ' + key
    }
    if (flags.slice(consumed).trim() !== '') error = 'Invalid media directive'
  }
  if (fit && span) error = 'Choose either span or fit'
  const placed = !!media.position
  if (placed) {
    if (media.video) error = 'Only images can be placed'
    else if (fit || span || media.background || explicitOverlay)
      error = 'A placed image cannot use fit, span, background, or overlay'
    media.size = size || DEFAULT_PLACED_SIZE
    media.span = false
    media.overlay = 0
    if (error) media.error = error
    return media
  }
  if (!span && (media.background === 'blur' || media.background === 'auto')) media.span = false
  media.overlay = (!media.video || media.span) && media.text.trim() !== '' ? 0.25 : 0
  if (explicitOverlay) {
    const n = Number(explicitOverlay)
    if (explicitOverlay.trim() === '' || !Number.isFinite(n) || n < 0 || n > 1)
      error = 'Overlay must be between 0 and 1'
    else media.overlay = n
  }
  if (error) media.error = error
  return media
}

/** Parse a slide's media: its `![...](file)` image/video or ```svg block. Null when it has none. */
export function parseMedia(slideSource: string): SlideMedia | null {
  const media = readMedia(slideSource)!
  const taken = takeFence(media.text, 'svg')
  if (taken.body !== undefined) {
    media.svg = taken.body
    media.text = taken.text
  }
  if (!media.file && media.svg === undefined) return null
  return media
}

/**
 * How many media items a slide declares: `![](file)` references outside code
 * and comments plus ```svg fences (counted up to two). Hype allows one.
 */
export function mediaItemCount(slideSource: string): number {
  const text = withoutComments(slideSource)
  const visible = outsideCode(text)
  let count = [...visible.matchAll(new RegExp(MEDIA_RE.source, 'g'))].length
  const first = takeFence(text, 'svg')
  if (first.body !== undefined) count += 1 + (takeFence(first.text, 'svg').body !== undefined ? 1 : 0)
  return count
}

/** True when the media is placed (a logo-style image with position/size). */
export function isPlaced(media: SlideMedia): boolean {
  return !!media.position
}

/** Replace the first real media reference, or append one to the slide. */
export function withMedia(source: string, reference: string): string {
  let visible = outsideCode(source)
  for (const c of [...visible.matchAll(COMMENT_RE)]) visible = blank(visible, c.index, c[0].length)
  const m = MEDIA_RE.exec(visible)
  if (m) return source.slice(0, m.index) + reference + source.slice(m.index + m[0].length)
  return source + '\n' + reference + '\n'
}

/** Put `file` in the slide's media slot; a replaced logo keeps its corner and size. */
export function withReplacedMedia(source: string, file: string): string {
  const current = parseMedia(source)
  const flags =
    current && isPlaced(current) && !isVideoFile(file)
      ? `position=${current.position} size=${current.size}%`
      : ''
  return withMedia(source, `![${flags}](<${file}>)`)
}

/** Remove some directives from the slide's media options and add others (`key` or `key=value`). */
export function withMediaDirectives(source: string, remove: string[], add: string[]): string {
  const marker = '\x01HYPE_MEDIA\x01'
  const marked = withMedia(source, marker)
  const start = marked.indexOf(marker)
  const length = source.length - marked.length + marker.length
  if (start < 0 || length <= 0) return source
  let reference = source.slice(start, start + length)
  const end = reference.indexOf('](')
  if (end < 2) return source
  let flags = reference.slice(2, end).trim()
  const kept = [...add]
  if (hasDirectives(flags)) {
    for (const t of tokenize(flags)) if (!remove.includes(t.key)) kept.push(t.raw)
  } else if (flags) {
    flags = flags.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    kept.push(`alt="${flags}"`)
  }
  reference = reference.slice(0, 2) + kept.join(' ') + reference.slice(end)
  return withMedia(source, reference)
}

// The functions below return the new slide source, or null when Hype's
// command would be a no-op (invalid argument, nothing to change).

export function mediaWithMode(slideSource: string, mode: string): string | null {
  if (mode !== 'fit' && mode !== 'span') return null
  return withMediaDirectives(slideSource, ['fit', 'span', 'position', 'size'], [mode])
}

export function mediaWithBackground(slideSource: string, mode: string): string | null {
  if (!['auto', 'theme', 'blur', 'white', 'black'].includes(mode)) return null
  const media = parseMedia(slideSource)
  if (!media || !media.file) return null
  // A background only shows around fitted media, so choosing one stops the media spanning.
  const fitted = mode === 'blur' || mode === 'white' || mode === 'black' || (media.video && mode === 'auto')
  // Backgrounds belong to full layouts, so choosing one unplaces the image.
  const remove = ['background', 'position', 'size']
  const add = ['background=' + mode]
  if (fitted) {
    remove.push('span', 'fit')
    add.unshift('fit')
  }
  return withMediaDirectives(slideSource, remove, add)
}

export function mediaWithPosition(slideSource: string, position: string): string | null {
  if (!MEDIA_POSITIONS.includes(position as MediaPosition)) return null
  const media = parseMedia(slideSource)
  if (!media || !media.file || media.video) return null
  // Placing replaces the full layout; a new placement starts at the default size.
  const size = isPlaced(media) ? media.size : DEFAULT_PLACED_SIZE
  return withMediaDirectives(
    slideSource,
    ['fit', 'span', 'background', 'overlay', 'position', 'size'],
    ['position=' + position, `size=${size}%`],
  )
}

export function mediaWithSize(slideSource: string, percent: number): string | null {
  const media = parseMedia(slideSource)
  if (!media || !isPlaced(media) || !(percent >= 1 && percent <= 100)) return null
  return withMediaDirectives(slideSource, ['size'], [`size=${percent}%`])
}
