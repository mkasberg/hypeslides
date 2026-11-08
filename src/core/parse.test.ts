import { describe, expect, it } from 'vitest'
import { parseDeck, replaceSlides, replaceHeader, scalar, serializeDeck, setScalar, slideText } from './parse'

describe('parseDeck', () => {
  it('handles fences and front matter', () => {
    const source =
      '---\ntitle: Test\n---\n\n# One\n\n---\n\n````ruby\n---\n```\n````\n\n---\n\n~~~sh\n---\n~~~\n'
    const p = parseDeck(source)
    expect(p.slides).toHaveLength(3)
    expect(p.error).toBeUndefined()
    expect(scalar(p.header, 'title')).toBe('Test')
    expect(p.slides[1].source).toContain('---')
    for (const s of p.slides) expect(source.slice(s.start, s.end)).toBe(s.source)
  })

  it('handles empty boundaries and unicode', () => {
    const p = parseDeck('# Æble 🍎\n---\n\n---\n')
    expect(p.slides).toHaveLength(3)
    expect(p.slides[0].source).toBe('# Æble 🍎\n')
    expect(p.slides[2].source).toBe('')
  })

  it('reports unfinished front matter and fences with offsets', () => {
    const fm = parseDeck('---\ntitle: x\n# no close\n')
    expect(fm.error).toBe('Front matter needs a closing ---')
    expect(fm.errorOffset).toBe(0)
    expect(fm.slides).toHaveLength(1)
    const src = '# A\n---\n```rust\nfn main() {}\n'
    const f = parseDeck(src)
    expect(f.error).toBe('Unclosed code fence')
    expect(f.errorOffset).toBe(src.indexOf('```'))
  })

  it('splits on --- without requiring blank lines, and keeps CRLF tails', () => {
    const p = parseDeck('# 🍎\r\n---\r\n# Code\r\n---\r\n# café\r\n')
    expect(p.slides.map((s) => s.source)).toEqual(['# 🍎\r\n', '# Code\r\n', '# café\r\n'])
  })

  it('skips a BOM before front matter', () => {
    const p = parseDeck('﻿---\ntitle: B\n---\n# Hi\n')
    expect(scalar(p.header, 'title')).toBe('B')
    expect(p.slides).toHaveLength(1)
  })

  it('round-trips losslessly', () => {
    for (const s of [
      '',
      '# One\n',
      '---\ntitle: T\n---\n\n# One\n\n---\n\n# Two\n',
      '# A\r\n---\r\n# B\r\n---',
      '---\ntitle: x\n# unclosed',
      '# A\n---\n```x\nunclosed\n---\n# B',
      '﻿# bom\n---\n# x\n',
    ])
      expect(serializeDeck(parseDeck(s))).toBe(s)
  })
})

describe('scalar / setScalar', () => {
  it('reads quoted and plain values', () => {
    const h = '---\na: plain\nb: "q\\"x"\nc: \'it\'\'s\'\nd:   spaced  \n---\n'
    expect(scalar(h, 'a')).toBe('plain')
    expect(scalar(h, 'b')).toBe('q"x')
    expect(scalar(h, 'c')).toBe("it's")
    expect(scalar(h, 'd')).toBe('spaced')
    expect(scalar(h, 'zzz', 'fb')).toBe('fb')
  })
  it('sets, adds, and creates front matter', () => {
    expect(setScalar('---\ntheme: a\n---\n', 'theme', 'b')).toBe('---\ntheme: "b"\n---\n')
    expect(setScalar('---\ntheme: a\n---\n', 'font', 'F F')).toBe('---\ntheme: a\nfont: "F F"\n---\n')
    expect(setScalar('', 'title', 'T')).toBe('---\ntitle: "T"\n---\n')
    expect(scalar(setScalar('', 'title', 'a "b"'), 'title')).toBe('a "b"')
  })
})

describe('replaceSlides / replaceHeader', () => {
  it('normalizes spacing and tracks offsets', () => {
    const { source, parsed } = replaceSlides('---\ntitle: T\n---\n', ['# One\n', '\n\n', '# Three'])
    expect(source).toBe('---\ntitle: T\n---\n\n# One\n\n---\n\n---\n\n# Three\n')
    for (const s of parsed.slides) expect(source.slice(s.start, s.end)).toBe(s.source)
    expect(parseDeck(source).slides.map((s) => slideText(s.source))).toEqual(['# One', '', '# Three'])
  })
  it('replaces the header', () => {
    const src = '---\ntitle: T\n---\n\n# One\n'
    const p = parseDeck(src)
    const r = replaceHeader(src, p, '---\ntitle: Longer title\n---\n')
    expect(r.source).toBe('---\ntitle: Longer title\n---\n\n# One\n')
    expect(r.parsed.slides[0].start).toBe(parseDeck(r.source).slides[0].start)
  })
})
