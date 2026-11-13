import { THEMES } from '../core'
import { SYSTEM, SYSTEM_DARK, SYSTEM_LIGHT, prettyThemeName } from '../app/appTheme'

export interface ThemeOption {
  value: string
  label: string
  /** Color chips shown after the label. */
  chips: string[]
}

/** Chips for a bundled theme: background, foreground, accent, then a few palette colors. */
export function themeOption(name: string): ThemeOption {
  const t = THEMES.find((x) => x.name === name)
  const c = t?.colors
  return {
    value: name,
    label: prettyThemeName(name),
    chips: c ? [c.background, c.foreground, c.accent, c.green, c.red, c.yellow, c.magenta] : [],
  }
}

/** 'System (light/dark)': chips of both themes it can resolve to. */
export function systemOption(): ThemeOption {
  const d = themeOption(SYSTEM_DARK).chips
  const l = themeOption(SYSTEM_LIGHT).chips
  return { value: SYSTEM, label: 'System (light/dark)', chips: [d[0], d[2], l[0], l[2]] }
}

export const allThemeOptions = (): ThemeOption[] => THEMES.map((t) => themeOption(t.name))
