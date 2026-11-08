// Hype's Markdown dialect on top of markdown-it. Pure (no DOM) so it runs in
// Node tests. Ported from the rules in ~/code/hype/src/renderer.cpp
// (preserveLineBreaks, padTableCells, withoutComments) and Markdown.js.

import MarkdownIt from 'markdown-it'
import { outsideCode } from '../core'

/** Highlights `code` in `lang`; returns inner HTML, or null when unavailable. */
export type CodeHighlighter = (code: string, lang: string) => string | null

export interface RenderOptions {
  highlight?: CodeHighlighter
}

// Private-use stand-in for the padding spaces: markdown-it trims cells with
// String.trim(), which would eat a real no-break space.
const PAD = ''

const COMMENT_RE = /<!--[\s\S]*?-->/g

/** The source with `<!-- comments -->` (outside code) removed. */
export function withoutComments(source: string): string {
  const ranges = [...outsideCode(source).matchAll(COMMENT_RE)]
  for (let i = ranges.length - 1; i >= 0; i--)
    source = source.slice(0, ranges[i].index) + source.slice(ranges[i].index + ranges[i][0].length)
  return source
}

// A table delimiter row, with or without outer pipes: | --- | :-: | or --- | ---:
const DELIMITER_RE = /^ {0,3}(?=[^\n]*\|)\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/m
const DELIMITER_LINE = new RegExp(DELIMITER_RE.source)

/** True if the text holds a GFM table delimiter row. */
export function hasTable(text: string): boolean {
  return DELIMITER_RE.test(text)
}

// Markdown trims table cells. Keep the one space each side that reads as
// separation, and turn any more into padding that survives.
export function padTableCells(markdown: string): string {
  const lines = markdown.split('\n')
  const visible = outsideCode(markdown).split('\n')
  const pad = (index: number) => {
    let line = lines[index]
    const mask = visible[index]
    const pipes: number[] = []
    for (let i = 0; i < mask.length; i++) if (mask[i] === '|' && (i === 0 || mask[i - 1] !== '\\')) pipes.push(i)
    if (!pipes.length) return
    if (pipes[0] > 0 && mask.slice(0, pipes[0]).trim() !== '') pipes.unshift(-1)
    if (pipes[pipes.length - 1] < mask.length - 1 && mask.slice(pipes[pipes.length - 1] + 1).trim() !== '')
      pipes.push(mask.length)
    for (let c = pipes.length - 1; c > 0; c--) {
      const start = pipes[c - 1] + 1
      const end = pipes[c]
      if (line.slice(start, end).trim() === '') continue
      let trailing = 0
      let leading = 0
      while (line[end - 1 - trailing] === ' ') trailing++
      while (line[start + leading] === ' ') leading++
      if (trailing > 1) line = line.slice(0, end - trailing) + PAD.repeat(trailing - 1) + line.slice(end - 1)
      if (leading > 1) line = line.slice(0, start + 1) + PAD.repeat(leading - 1) + line.slice(start + leading)
    }
    lines[index] = line
  }
  for (let i = 1; i < lines.length; i++) {
    if (!DELIMITER_LINE.test(visible[i]) || !visible[i - 1].includes('|')) continue
    pad(i - 1)
    for (let row = i + 1; row < lines.length && visible[row].includes('|') && visible[row].trim() !== ''; row++) pad(row)
  }
  return lines.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function createMarkdown() {
  const md = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false })
  // Hype: *x* italic, **x** bold, _x_ and __x__ underline.
  md.core.ruler.push('hype_underline', (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== 'inline' || !blockToken.children) continue
      for (const t of blockToken.children) {
        if ((t.type === 'em_open' || t.type === 'strong_open' || t.type === 'em_close' || t.type === 'strong_close') &&
            t.markup[0] === '_') {
          t.tag = 'u'
        }
      }
    }
  })
  // A paragraph that opens with an em dash is an attribution: set smaller.
  md.core.ruler.push('hype_attribution', (state) => {
    const tokens = state.tokens
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (tokens[i].type === 'paragraph_open' && tokens[i + 1].content.startsWith('—'))
        tokens[i].attrJoin('class', 'attribution')
    }
  })
  md.renderer.rules.fence = (tokens, idx, _options, env?: RenderEnv) => {
    const token = tokens[idx]
    const lang = token.info.trim().split(/\s+/)[0].toLowerCase()
    const code = token.content.replace(/\n$/, '')
    const inner = (lang && env?.highlight?.(code, lang)) || escapeHtml(code)
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    return `<pre><code${cls}>${inner}</code></pre>\n`
  }
  // Only the slide's own media line shows an image; links read as plain accent text.
  md.renderer.rules.image = () => ''
  md.renderer.rules.link_open = () => '<a>'
  md.renderer.rules.link_close = () => '</a>'
  return md
}

type RenderEnv = { highlight?: CodeHighlighter } & Record<string, unknown>

let shared: ReturnType<typeof createMarkdown> | undefined

/** Render one slide's text (media already removed) to an HTML fragment. */
export function renderSlideHtml(text: string, options: RenderOptions = {}): string {
  shared ??= createMarkdown()
  const source = padTableCells(withoutComments(text.replace(/\r\n?/g, '\n')))
  const env: RenderEnv = { highlight: options.highlight }
  return shared.render(source, env).replaceAll(PAD, '&nbsp;')
}
