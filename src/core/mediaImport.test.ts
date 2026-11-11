import { describe, expect, it } from 'vitest'
import {
  copiedAsIs, defaultPasteName, imageSizeForCanvas, isAnimatedImage, keepOriginal, pickLossless, resolvePasteName,
  shouldTryWebp,
} from './mediaImport'

const bytes = (...v: (number | string)[]) =>
  new Uint8Array(v.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])))

describe('imageSizeForCanvas', () => {
  const canvas = { width: 3840, height: 2160 }
  it('never enlarges', () => {
    expect(imageSizeForCanvas({ width: 800, height: 600 }, canvas)).toEqual({ width: 800, height: 600 })
    expect(imageSizeForCanvas({ width: 3840, height: 2160 }, canvas)).toEqual({ width: 3840, height: 2160 })
  })
  it('fits within the canvas', () => {
    expect(imageSizeForCanvas({ width: 7680, height: 4320 }, canvas)).toEqual({ width: 3840, height: 2160 })
    expect(imageSizeForCanvas({ width: 4000, height: 4000 }, canvas)).toEqual({ width: 2160, height: 2160 })
  })
  it('covers the canvas when spanning', () => {
    expect(imageSizeForCanvas({ width: 4000, height: 4000 }, canvas, true)).toEqual({ width: 3840, height: 3840 })
    // A wide image whose cover size is not smaller stays as is.
    expect(imageSizeForCanvas({ width: 3000, height: 1000 }, canvas, true)).toEqual({ width: 3000, height: 1000 })
  })
})

describe('format choice', () => {
  it('tries WebP only for larger PNGs and needs a strict win', () => {
    expect(shouldTryWebp(65536)).toBe(false)
    expect(shouldTryWebp(65537)).toBe(true)
    expect(pickLossless(100, 99)).toBe('webp')
    expect(pickLossless(100, 100)).toBe('png')
    expect(pickLossless(100, null)).toBe('png')
  })
  it('keeps an unresized original that is not beaten', () => {
    expect(keepOriginal(false, 500, 400)).toBe(true)
    expect(keepOriginal(false, 300, 400)).toBe(false)
    expect(keepOriginal(true, 900, 400)).toBe(false)
  })
})

describe('what is recompressed', () => {
  it('copies videos, SVG and unknown types', () => {
    expect(copiedAsIs('a.mp4')).toBe(true)
    expect(copiedAsIs('a.svg')).toBe(true)
    expect(copiedAsIs('a.png')).toBe(false)
    expect(copiedAsIs('a.JPG')).toBe(false)
  })
  it('detects animated GIF / WebP / APNG', () => {
    const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0]
    const gif = (frames: number) => bytes('GIF89a', 1, 0, 1, 0, 0, 0, 0, ...Array.from({ length: frames }, () => frame).flat(), 0x3b)
    expect(isAnimatedImage(gif(1), 'a.gif')).toBe(false)
    expect(isAnimatedImage(gif(2), 'a.gif')).toBe(true)
    const webp = (flags: number) => bytes('RIFF', 0, 0, 0, 0, 'WEBP', 'VP8X', 10, 0, 0, 0, flags, 0, 0, 0)
    expect(isAnimatedImage(webp(0x02), 'a.webp')).toBe(true)
    expect(isAnimatedImage(webp(0), 'a.webp')).toBe(false)
    const chunk = (type: string, len = 0) => bytes(0, 0, 0, len, type, ...new Array<number>(len + 4).fill(0))
    const png = (...c: Uint8Array[]) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, ...c.flatMap((x) => [...x])])
    expect(isAnimatedImage(png(chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT')), 'a.png')).toBe(true)
    expect(isAnimatedImage(png(chunk('IHDR', 13), chunk('IDAT')), 'a.png')).toBe(false)
  })
})

describe('names', () => {
  it('defaults to the base name', () => {
    expect(defaultPasteName('Team photo.JPG', false)).toBe('Team photo')
    expect(defaultPasteName('image.png', false)).toBe('image')
    expect(defaultPasteName('', true)).toBe('video')
  })
  it('validates like Hype', () => {
    expect(resolvePasteName('  cat  ', 'png', [])).toEqual({ ok: true, name: 'cat.png' })
    expect(resolvePasteName('cat.PNG', 'png', [])).toEqual({ ok: true, name: 'cat.png' })
    expect(resolvePasteName('a/b', 'png', []).ok).toBe(false)
    expect(resolvePasteName('..', 'png', []).ok).toBe(false)
    expect(resolvePasteName('a<b', 'png', []).ok).toBe(false)
    expect(resolvePasteName('', 'png', []).ok).toBe(false)
    expect(resolvePasteName('cat', 'png', ['cat.png'])).toEqual({ ok: false, error: 'cat.png already exists. Choose another name.' })
  })
})
