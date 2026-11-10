import { describe, expect, it } from 'vitest'
import { THEMES, getTheme } from '../core'
import { contrastInk, mix, resolveAppTheme, uiTokens } from './appTheme'

describe('mix / contrastInk', () => {
  it('mixes channels linearly', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
  it('picks ink by luminance .179', () => {
    expect(contrastInk('#ffffff')).toBe('#111111')
    expect(contrastInk('#000000')).toBe('#ffffff')
    expect(contrastInk('#1a1b26')).toBe('#ffffff')
    expect(contrastInk('#7aa2f7')).toBe('#111111')
    expect(contrastInk('#1e66f5')).toBe('#ffffff') // dark-ish blue, luminance ~.16
  })
})

describe('uiTokens', () => {
  const tn = uiTokens(getTheme('tokyo-night')!)
  it('follows Hype for tokyo-night', () => {
    expect(tn.background).toBe('#1a1b26')
    expect(tn.foreground).toBe('#a9b1d6')
    expect(tn.accent).toBe('#7aa2f7')
    // border = mix(bg, fg, .22): (26,27,38) -> (57,60,77)
    expect(tn.border).toBe('#393c4d')
    expect(tn.button).toBe('#24283b') // lighter_background
    expect(tn.selection).toBe('#292e42') // theme selection
    expect(tn.error).toBe('#f7768e')
    expect(tn['accent-text']).toBe('#111111')
    expect(tn['window-border']).toBe('#7aa2f7') // no active_border_color
    expect(tn.hover).toBe(mix('#1a1b26', '#7aa2f7', 0.22))
    expect(tn['color-scheme']).toBe('dark')
  })
  it('light themes flag color-scheme', () => {
    expect(uiTokens(getTheme('catppuccin-latte')!)['color-scheme']).toBe('light')
  })
  it('every theme yields hex colors', () => {
    for (const t of THEMES) {
      const k = uiTokens(t)
      for (const [name, v] of Object.entries(k)) {
        if (['shadow', 'scrim', 'color-scheme'].includes(name)) continue
        expect(v, `${t.name} ${name}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})

describe('resolveAppTheme', () => {
  it('maps system to tokyo-night / catppuccin-latte', () => {
    expect(resolveAppTheme('system', true).name).toBe('tokyo-night')
    expect(resolveAppTheme('system', false).name).toBe('catppuccin-latte')
    expect(resolveAppTheme('nord', false).name).toBe('nord')
    expect(resolveAppTheme('bogus', true).name).toBe('tokyo-night')
  })
})
