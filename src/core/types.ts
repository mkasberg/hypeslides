// Shared contracts for the document core. Everything in src/core is pure
// TypeScript: no DOM, no React, no browser storage. It must run in Node so it
// can later back a CLI / WebMCP tools (check, slides outline, etc.).
//
// Ported from ~/code/hype/src/deck.{h,cpp}. The Markdown source string is the
// single source of truth; slides are derived from it.

/** One slide's span within the full source. */
export interface Slide {
  /** The slide's Markdown, without the surrounding separator blank lines. */
  source: string
  /** Offset of the slide's first character in the full document source. */
  start: number
  /** Offset just past the slide's last character in the full document source. */
  end: number
  /**
   * The separator line that follows this slide exactly as written (`---\n`,
   * `---\r\n`, or `---` at EOF). Absent on the last slide. Lets a parsed deck be
   * re-serialized losslessly.
   */
  separator?: string
}

export interface ParsedDeck {
  /** Front matter body (between the `---` fences), without the fences. '' if none. */
  header: string
  slides: Slide[]
  /** Set when the front matter or a code fence is unfinished. */
  error?: string
  /** Offset where the unfinished front matter / code fence opens. */
  errorOffset?: number
}

/**
 * Editor state that commands operate on. Selection is a contiguous range
 * between `anchor` and `selected` (inclusive), like Hype.
 */
export interface DocState {
  source: string
  selected: number
  anchor: number
  /**
   * Optional cached slide structure for `source`, valid only while
   * `structure.source === source`. Commands set it so that editing an
   * unfinished code fence never swallows the following slides (Hype reparses
   * only the edited slide). Safe to drop: commands fall back to parseDeck.
   */
  structure?: { source: string; parsed: ParsedDeck }
}

export type MediaPosition =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

/** Parsed `![options](file)` media for a slide (or an ```svg block). */
export interface SlideMedia {
  /** Filename as written, e.g. `city.jpg`. '' when the slide uses an svg block. */
  file: string
  /** Directory the file lives in by convention: `images` or `videos`. */
  dir: 'images' | 'videos'
  video: boolean
  /** Inline SVG markup from an ```svg block, if any. */
  svg?: string
  /** Explicit directive: 'fit' / 'span', or 'auto' when neither is written. */
  mode: 'auto' | 'fit' | 'span'
  /** Effective span (an image with a `# ` heading spans by default). */
  span: boolean
  /** First problem found in the media directives, if any. */
  error?: string
  /** 'theme' | 'white' | 'black' | 'auto' | 'blur' | '#rrggbb' | undefined (default). */
  background?: string
  overlay?: number
  loop: boolean
  muted: boolean
  autoplay: boolean
  poster?: string
  position?: MediaPosition
  /** Percent 1..100 when `position` is set (default 10). */
  size?: number
  /** The slide's Markdown with the media line / svg block removed. */
  text: string
}

export interface Palette {
  background: string
  foreground: string
  accent: string
  green: string
  red: string
  yellow: string
  magenta: string
  cyan: string
  dark_foreground: string
}

export interface Theme {
  name: string // e.g. 'tokyo-night'
  /** The slide palette (what presentations use). */
  colors: Palette
  /** Every hex key of the theme's Omarchy colors.toml (selection, muted, bright_*, ...), for the app UI theme. */
  all: Record<string, string>
  /** True for light themes (`mode = "light"`). */
  light?: boolean
}

export type ProblemKind =
  | 'front-matter' // unfinished front matter
  | 'fence' // unfinished code fence
  | 'layout' // invalid media / layout option
  | 'media' // missing media or poster, or more than one media item
  | 'svg' // an ```svg block that can't be drawn
  | 'theme' // theme not installed
  | 'empty' // empty slide
  | 'shrink' // text shrinks below a readable size

/** A problem found by `check` (Hype's `Problem` in cli.cpp). */
export interface Problem {
  /** 0-based slide index, or null for the presentation as a whole. */
  slide: number | null
  /** 1-based line within the document. */
  line: number
  severity: 'error' | 'warning'
  kind: ProblemKind
  message: string
}
