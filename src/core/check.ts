// `check`: everything wrong with a presentation. Ported from
// ~/code/hype/src/renderer.cpp (slideProblems, svgProblem) and
// ~/code/hype/src/cli.cpp (slideProblemsAt, findProblems, firstLine, lineAt).
//
// Pure and DOM-free so it also runs in Node (CLI / WebMCP tools). Hype's
// checks that need I/O or a renderer are inputs here:
//  - which media files exist -> `mediaExists`
//  - how small the text had to shrink -> `textSize` (layout needs a browser;
//    the app measures with the real renderer, see src/render/fit.ts)
//  - Hype's "Cannot decode image" is not ported (needs an image decoder).

import { parseMedia, mediaItemCount } from './media'
import { parseDeck, scalar } from './parse'
import { themeNames, themeName } from './themes'
import type { ParsedDeck, Problem, ProblemKind, Slide } from './types'

/** Hype's readability floor: text fitted below this (px on a 1080p slide) draws a warning. */
export const MIN_READABLE_TEXT_SIZE = 24

export interface CheckOptions {
  /**
   * Does this media file exist? Called with a name as written in the slide
   * (`photo.png`, a video's `poster`). Omit to skip the missing-media checks.
   */
  mediaExists?: (file: string) => boolean
  /**
   * The font size (px at 1080p) the slide's text fits at, or undefined if
   * unknown / no text. Omit to skip the shrink warning.
   */
  textSize?: (slideSource: string, index: number) => number | undefined
}

export interface SlideProblem {
  kind: ProblemKind
  message: string
}

const THEME_COLORS = [
  'background', 'foreground', 'accent', 'green', 'red', 'yellow', 'magenta', 'cyan', 'dark_foreground', 'font',
]

/** 1-based line of an offset. */
export function lineAt(source: string, offset: number): number {
  let line = 1
  for (let i = source.indexOf('\n'); i >= 0 && i < offset; i = source.indexOf('\n', i + 1)) line++
  return line
}

/** A slide starts on the blank line after its separator; point at its content, or at the separator when there is none. */
function firstLine(source: string, slide: Slide): number {
  let offset = slide.start
  while (offset < slide.end && /\s/.test(source[offset])) offset++
  return lineAt(source, offset < slide.end ? offset : Math.max(0, slide.start - 1))
}

// ---- svg ---------------------------------------------------------------------

/**
 * A minimal well-formedness check standing in for Qt's QXmlStreamReader: tag
 * nesting, attribute quoting, one root. Returns "SVG line N: why" (lines
 * count within the block) or undefined. Not a validating parser.
 */
function xmlError(xml: string): { line: number; message: string } | undefined {
  const lineOf = (pos: number) => lineAt(xml, pos)
  const stack: string[] = []
  let roots = 0
  let i = 0
  const fail = (pos: number, message: string) => ({ line: lineOf(pos), message })
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    const text = xml.slice(i, lt < 0 ? xml.length : lt)
    if (stack.length === 0 && /\S/.test(text)) return fail(i, 'Extra content at the end of the document.')
    if (lt < 0) break
    i = lt
    const skip = (open: string, close: string, what: string) => {
      const end = xml.indexOf(close, i + open.length)
      if (end < 0) return fail(i, `Unterminated ${what}.`)
      i = end + close.length
      return undefined
    }
    let err
    if (xml.startsWith('<!--', i)) err = skip('<!--', '-->', 'comment')
    else if (xml.startsWith('<![CDATA[', i)) err = skip('<![CDATA[', ']]>', 'CDATA section')
    else if (xml.startsWith('<?', i)) err = skip('<?', '?>', 'processing instruction')
    else if (xml.startsWith('<!', i)) err = skip('<!', '>', 'declaration')
    else if (xml.startsWith('</', i)) {
      const m = /^<\/([^\s>]+)\s*>/.exec(xml.slice(i))
      if (!m) return fail(i, 'Invalid end tag.')
      if (stack.pop() !== m[1]) return fail(i, 'Opening and ending tag mismatch.')
      i += m[0].length
    } else {
      const m = /^<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(xml.slice(i))
      if (!m) return fail(i, 'Invalid start tag.')
      if (stack.length === 0 && ++roots > 1) return fail(i, 'Extra content at the end of the document.')
      if (!m[3]) stack.push(m[1])
      i += m[0].length
    }
    if (err) return err
  }
  if (stack.length || roots === 0) return { line: lineOf(xml.length), message: 'Premature end of document.' }
  return undefined
}

/** Why an ```svg block can't be drawn, or undefined when it can. */
function svgProblem(svg: string): string | undefined {
  const root = /<([A-Za-z_][\w:.-]*)/.exec(svg.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>/g, (m) => ' '.repeat(m.length)))
  const parseError = xmlError(svg)
  if (root && root[1] !== 'svg') return 'An svg block holds one <svg> element'
  if (parseError) return `SVG line ${parseError.line}: ${parseError.message}`
  for (const m of svg.matchAll(/var\(\s*--([a-z_-]+)\s*\)/g)) {
    if (!THEME_COLORS.includes(m[1].replace(/-/g, '_')))
      return `Unknown theme color --${m[1]}; use --` + THEME_COLORS.slice(0, 9).join(', --').replace(/_/g, '-')
  }
  const tag = /<svg\b([^>]*)>/.exec(svg)?.[1] ?? ''
  const attr = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)
  const box = attr('viewBox')
  const [bw, bh] = box ? (box[1] ?? box[2]).trim().split(/[\s,]+/).slice(2).map(Number) : [0, 0]
  const hasBox = bw > 0 && bh > 0
  const size = (name: string) => parseFloat((attr(name) ?? [])[1] ?? (attr(name) ?? [])[2] ?? '')
  if (!hasBox && !(size('width') > 0 && size('height') > 0)) return 'Give the SVG a viewBox, or a width and height'
  return undefined
}

// ---- per slide ---------------------------------------------------------------

/** Hype's slideProblems: every error for one slide, in Hype's order. */
export function slideProblems(slideSource: string, options: CheckOptions = {}): SlideProblem[] {
  const out: SlideProblem[] = []
  const exists = options.mediaExists
  const media = parseMedia(slideSource)
  if (media?.error) out.push({ kind: 'layout', message: media.error })
  if (media?.svg !== undefined) {
    const problem = svgProblem(media.svg)
    if (problem) out.push({ kind: 'svg', message: problem })
  }
  if (media?.file && exists && !exists(media.file)) out.push({ kind: 'media', message: 'Missing media: ' + media.file })
  if (media?.poster && exists && !exists(media.poster)) out.push({ kind: 'media', message: 'Missing poster' })
  if (mediaItemCount(slideSource) > 1)
    out.push({ kind: 'media', message: 'Use one media item per slide (combine artwork before importing)' })
  return out
}

// ---- whole presentation --------------------------------------------------------

/** Hype's findProblems: every problem in the presentation, in slide order. */
export function findProblems(source: string, options: CheckOptions = {}, parsedDeck?: ParsedDeck): Problem[] {
  const parsed = parsedDeck ?? parseDeck(source)
  // Slide boundaries are unreliable past unfinished front matter or a code fence.
  if (parsed.error)
    return [{
      slide: null,
      line: lineAt(source, parsed.errorOffset ?? 0),
      severity: 'error',
      kind: parsed.error.startsWith('Front matter') ? 'front-matter' : 'fence',
      message: parsed.error,
    }]
  const problems: Problem[] = []
  const name = themeName(parsed.header)
  if (scalar(parsed.header, 'theme') && !themeNames().includes(name) && !scalar(parsed.header, 'color_background')) {
    const at = /^theme:/m.exec(parsed.header)
    problems.push({
      slide: null,
      line: lineAt(source, Math.max(0, at?.index ?? 0)),
      severity: 'warning',
      kind: 'theme',
      message: `Theme ${name} is not installed; using the default colors`,
    })
  }
  parsed.slides.forEach((slide, index) => {
    const line = firstLine(source, slide)
    const found: Problem[] = slideProblems(slide.source, options).map((p) => ({
      slide: index, line, severity: 'error', ...p,
    }))
    if (slide.source.trim() === '')
      found.push({ slide: index, line, severity: 'warning', kind: 'empty', message: 'Empty slide' })
    // Only laying the slide out reveals text that had to shrink too far.
    if (found.length === 0 && options.textSize) {
      const size = options.textSize(slide.source, index)
      if (size !== undefined && size < MIN_READABLE_TEXT_SIZE)
        found.push({
          slide: index, line, severity: 'warning', kind: 'shrink',
          message: `Text fits below ${MIN_READABLE_TEXT_SIZE}px on a 1080p slide`,
        })
    }
    problems.push(...found)
  })
  return problems
}

/** Hype's status wording for a slide's errors: "Slide 3: a; b". */
export function slideProblemStatus(slide: number, problems: readonly { message: string }[]): string {
  return `Slide ${slide + 1}: ${problems.map((p) => p.message).join('; ')}`
}
