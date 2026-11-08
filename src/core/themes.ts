// Themes and palettes, ported from Deck::palette / Deck::chooseTheme in
// ~/code/hype/src/deck.cpp. Hype reads installed Omarchy `colors.toml` files;
// here the Omarchy themes are bundled as data (see themeData.ts).

import { isValidColor } from './colors'
import { scalar } from './parse'
import type { Palette, Theme } from './types'
import { THEMES } from './themeData'

export { THEMES }

export const DEFAULT_THEME = 'tokyo-night'
export const DEFAULT_FONT = 'JetBrains Mono'

/** Hype's built-in colors, used when a theme is unknown. */
export const DEFAULT_PALETTE: Palette = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  accent: '#7aa2f7',
  green: '#9ece6a',
  red: '#f7768e',
  yellow: '#e0af68',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  dark_foreground: '#787c99',
}

export const PALETTE_KEYS = Object.keys(DEFAULT_PALETTE) as (keyof Palette)[]

export function themeNames(): string[] {
  return THEMES.map((t) => t.name)
}

export function getTheme(name: string): Theme | undefined {
  return THEMES.find((t) => t.name === name)
}

/** The header's `theme:` value (default tokyo-night). */
export function themeName(header: string): string {
  return scalar(header, 'theme', DEFAULT_THEME)
}

/** The header's `font:` value (default JetBrains Mono). */
export function fontFor(header: string): string {
  return scalar(header, 'font', DEFAULT_FONT)
}

/** The theme's colors with the header's `color_*` overrides applied. */
export function paletteFor(header: string): Palette {
  const colors: Palette = { ...(getTheme(themeName(header))?.colors ?? DEFAULT_PALETTE) }
  for (const key of PALETTE_KEYS) {
    const v = scalar(header, 'color_' + key)
    if (isValidColor(v)) colors[key] = v
  }
  return colors
}

/** The presentation title: `title:` or the fallback (usually the file name). */
export function title(header: string, fallbackName = 'Untitled'): string {
  return scalar(header, 'title', fallbackName)
}
