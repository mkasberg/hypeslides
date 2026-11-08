import { describe, expect, it } from 'vitest'
import { newDeckSource } from './newDeck'
import { parseDeck, scalar } from './parse'
import { DEFAULT_PALETTE, THEMES, fontFor, getTheme, paletteFor, title } from './themes'

describe('themes', () => {
  it('ships Omarchy themes with complete palettes', () => {
    expect(THEMES.length).toBeGreaterThan(15)
    for (const t of THEMES) for (const v of Object.values(t.colors)) expect(v).toMatch(/^#[0-9a-f]{6}$/)
    expect(getTheme('tokyo-night')).toBeTruthy()
    expect(getTheme('white')!.light).toBe(true)
  })
  it('paletteFor applies theme then overrides', () => {
    expect(paletteFor('')).toEqual(getTheme('tokyo-night')!.colors)
    expect(paletteFor('---\ntheme: nope\n---\n')).toEqual(DEFAULT_PALETTE)
    const p = paletteFor('---\ntheme: nord\ncolor_accent: "#010203"\ncolor_red: bogus\n---\n')
    expect(p.accent).toBe('#010203')
    expect(p.red).toBe(getTheme('nord')!.colors.red)
  })
  it('font and title', () => {
    expect(fontFor('')).toBe('JetBrains Mono')
    expect(fontFor('---\nfont: "Fira Code"\n---\n')).toBe('Fira Code')
    expect(title('', 'talk')).toBe('talk')
    expect(title('---\ntitle: Hi\n---\n', 'talk')).toBe('Hi')
  })
})

describe('newDeckSource', () => {
  it('writes front matter and a first slide', () => {
    const src = newDeckSource({ title: 'My Talk', theme: 'nord' })
    const p = parseDeck(src)
    expect(p.error).toBeUndefined()
    expect(scalar(p.header, 'title')).toBe('My Talk')
    expect(scalar(p.header, 'theme')).toBe('nord')
    expect(scalar(p.header, 'font')).toBe('JetBrains Mono')
    expect(scalar(p.header, 'color_background')).toBe(getTheme('nord')!.colors.background)
    expect(p.slides).toHaveLength(1)
    expect(p.slides[0].source.trim()).toBe('# My Talk')
  })
})
