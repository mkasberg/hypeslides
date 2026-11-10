// The app (UI) theme: a per-browser preference, separate from the presentation
// theme saved in a deck's front matter. Colors come from the same bundled
// Omarchy themes; `uiTokens` is a port of AppTheme::reload in
// ~/code/hype/src/apptheme.cpp (plus a few tokens this UI needs that Hype lacks).

import { getTheme } from '../core'
import type { Theme } from '../core'

export const SYSTEM = 'system'
export const SYSTEM_DARK = 'tokyo-night'
export const SYSTEM_LIGHT = 'catppuccin-latte'
const PREF_KEY = 'hype-app-theme'
const TOKENS_KEY = 'hype-app-theme-tokens'
/** CSS custom properties are `--ui-<token>`, so they never collide with the slide's own `--background`, `--accent`, ... */
export const TOKEN_PREFIX = '--ui-'

type RGB = [number, number, number] // 0..1

function parse(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Qt stores 16-bit channels and QColor::name() takes the high byte; reproduce that. */
function toHex([r, g, b]: RGB): string {
  const ch = (v: number) => {
    const c = Math.min(255, Math.max(0, Math.round(v * 65535) >> 8))
    return c.toString(16).padStart(2, '0')
  }
  return '#' + ch(r) + ch(g) + ch(b)
}

/** `base` moved `amount` of the way toward `ink`. */
export function mix(base: string, ink: string, amount: number): string {
  const a = parse(base)
  const b = parse(ink)
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as RGB)
}

/** Near-black or white, whichever reads on `color` (Hype's luminance threshold .179). */
export function contrastInk(color: string): string {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const [r, g, b] = parse(color)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.179 ? '#111111' : '#ffffff'
}

/** Token names (kebab-case, unprefixed) to CSS values. `color-scheme` is a plain CSS property, not a variable. */
export function uiTokens(theme: Theme): Record<string, string> {
  const v = theme.all
  const pal = theme.colors
  const bg = v.background ?? pal.background
  const fg = v.foreground ?? pal.foreground
  const accent = v.accent ?? pal.accent
  const selection = v.selection ?? mix(bg, accent, 0.3)
  const border = mix(bg, fg, 0.22)
  const inactiveSelection = mix(border, accent, 0.7)
  return {
    background: bg,
    foreground: fg,
    accent,
    panel: mix(bg, fg, 0.025),
    button: v.lighter_background ?? mix(bg, fg, 0.08),
    hover: mix(bg, accent, 0.22),
    border,
    muted: mix(bg, fg, 0.62),
    selection,
    'selection-text': contrastInk(selection),
    'inactive-selection': inactiveSelection,
    'inactive-selection-text': contrastInk(inactiveSelection),
    'accent-text': contrastInk(accent),
    'accent-hover': mix(accent, fg, 0.15),
    'window-border': v.active_border_color ?? accent,
    error: v.red ?? '#d94b4b',
    // Not in Hype:
    warning: v.yellow ?? pal.yellow,
    'error-text': contrastInk(v.red ?? '#d94b4b'),
    canvas: v.dark_background ?? mix(bg, '#000000', 0.12),
    'active-line': mix(bg, fg, 0.05),
    'syntax-heading': accent,
    'syntax-code': v.green ?? pal.green,
    'syntax-string': v.yellow ?? pal.yellow,
    'syntax-comment': v.dark_foreground ?? pal.dark_foreground,
    'syntax-link': v.cyan ?? pal.cyan,
    'syntax-keyword': v.magenta ?? pal.magenta,
    'syntax-quote': mix(bg, fg, 0.62),
    'shadow-sm': theme.light ? '0 1px 3px rgba(0, 0, 0, 0.18)' : '0 1px 4px rgba(0, 0, 0, 0.55)',
    scrim: 'color-mix(in srgb, black 50%, transparent)',
    shadow: theme.light ? '0 8px 28px rgba(0, 0, 0, 0.18)' : '0 8px 28px rgba(0, 0, 0, 0.5)',
    'color-scheme': theme.light ? 'light' : 'dark',
  }
}

/** The theme a preference means right now. */
export function resolveAppTheme(pref: string, prefersDark: boolean): Theme {
  const name = pref === SYSTEM ? (prefersDark ? SYSTEM_DARK : SYSTEM_LIGHT) : pref
  return getTheme(name) ?? getTheme(prefersDark ? SYSTEM_DARK : SYSTEM_LIGHT)!
}

export function prettyThemeName(name: string): string {
  return name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function loadAppThemePref(): string {
  try {
    const v = localStorage.getItem(PREF_KEY)
    if (v && (v === SYSTEM || getTheme(v))) return v
  } catch { /* storage blocked */ }
  return SYSTEM
}

export function saveAppThemePref(pref: string): void {
  try {
    localStorage.setItem(PREF_KEY, pref)
  } catch { /* storage blocked */ }
}

/** Set the tokens as CSS variables on <html>, update color-scheme and the browser chrome color; when `cache`, keep them for the next load. */
export function applyAppTheme(tokens: Record<string, string>, cache = true): void {
  const root = document.documentElement
  for (const [k, val] of Object.entries(tokens)) {
    if (k === 'color-scheme') root.style.colorScheme = val
    else root.style.setProperty(TOKEN_PREFIX + k, val)
  }
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = tokens.panel
  if (!cache) return
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  } catch { /* storage blocked */ }
}

/** Run `update` inside a View Transition (a crossfade) when supported and motion is allowed. */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (doc.startViewTransition && !reduced) doc.startViewTransition(update)
  else update()
}

// --- live state -----------------------------------------------------------

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)
let committed = SYSTEM
let preview: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function render(transition: boolean) {
  const pref = preview ?? committed
  const tokens = uiTokens(resolveAppTheme(pref, darkQuery()?.matches ?? true))
  // Never cache a hover preview: the next load should show the committed theme.
  const apply = () => applyAppTheme(tokens, preview === null)
  if (transition) withViewTransition(apply)
  else apply()
}

/** Load the saved preference, apply it, and follow the OS setting while it is 'system'. Returns a cleanup. */
export function initAppTheme(): () => void {
  committed = loadAppThemePref()
  render(false)
  emit()
  const q = darkQuery()
  const onChange = () => {
    if ((preview ?? committed) === SYSTEM) render(true)
    emit()
  }
  q?.addEventListener('change', onChange)
  return () => q?.removeEventListener('change', onChange)
}

/** The committed preference (not a hover preview). */
export const getAppThemePref = () => committed
/** The preference being shown (preview, else committed). */
export const getShownAppThemePref = () => preview ?? committed
export function subscribeAppTheme(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Commit and persist a preference. */
export function setAppThemePref(pref: string): void {
  const wasShown = (preview ?? committed) === pref
  committed = pref
  preview = null
  saveAppThemePref(pref)
  if (!wasShown) render(true)
  emit()
}

/** Show a theme without saving it; `null` reverts. Instant, so sweeping the pointer down a list stays smooth. */
export function previewAppTheme(pref: string | null): void {
  if (preview === pref) return
  preview = pref
  render(false)
  emit()
}
