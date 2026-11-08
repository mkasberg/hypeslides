import { describe, expect, it } from 'vitest'
import * as c from './commands'
import { parseMedia } from './media'
import { parseDeck, scalar, slideText } from './parse'
import type { DocState } from './types'

const st = (source: string, selected = 0): DocState => ({ source, selected, anchor: selected })
const count = c.slideCount
const trimmed = (s: DocState, i: number) => c.slideAt(s, i).trim()
const text = (s: DocState) => slideText(c.selectedSlide(s))

describe('selection and navigation', () => {
  const doc = '---\ntitle: T\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n'
  it('selects, clamps, and finds slide at offset', () => {
    let s = st(doc)
    s = c.select(s, 99)
    expect(s.selected).toBe(2)
    const p = parseDeck(doc)
    for (const pos of [0, doc.indexOf('title'), p.slides[0].start - 1, p.slides[0].start]) {
      s = c.selectAt(c.select(s, 2), pos)
      expect(s.selected).toBe(0)
    }
    expect(c.selectAt(s, p.slides[1].start).selected).toBe(1)
    expect(c.sourcePosition(c.select(s, 1))).toBe(p.slides[1].start)
  })
})

describe('editing', () => {
  it('editing cannot eat the separator', () => {
    const s = c.editSlide(st('# One\n---\n# Two\n'), '# Changed')
    expect(count(s)).toBe(2)
    expect(c.slideAt(s, 1)).toBe('# Two\n')
  })

  it('single slide editor padding', () => {
    const original = '# First\n\n---\n\n\n    indented  \n\nparagraph  \n\n\n---\n\n# Last\n'
    let s = c.select(c.editSource(st(''), original), 1)
    const content = '    indented  \n\nparagraph  '
    expect(text(s)).toBe(content)
    expect(s.source).toBe(original)
    const edited = c.editSlide(s, content + 'more')
    expect(text(edited)).toBe(content + 'more')
    expect(edited.source).toBe('# First\n\n---\n\n    indented  \n\nparagraph  more\n\n---\n\n# Last\n')
    expect(count(edited)).toBe(3)
    s = c.editSlide(s, '')
    expect(text(s)).toBe('')
    expect(s.source).toBe('# First\n\n---\n\n---\n\n# Last\n')
    expect(count(s)).toBe(3)
    s = c.select(c.editSource(s, '---\r\ntitle: CRLF\r\n---\r\n\r\n# Title\r\n\r\n---\r\n\r\n# Next\r\n'), 0)
    expect(text(s)).toBe('# Title')
    s = c.editSource(s, '# One slide\n')
    expect(text(s)).toBe('# One slide')
    expect(c.editSlide(s, '# Changed\n\n').source).toBe('# Changed\n')
  })

  it('same text is a no-op', () => {
    const s = st('# One\n\n---\n# Two\n')
    expect(c.editSlide(s, '# One')).toBe(s)
  })

  it('incomplete slide code keeps following slides', () => {
    const tail = '---\n# Keep this slide\n---\n# And this one\n'
    let s = c.select(st('# Start\n---\n# Code goes here\n' + tail), 1)
    s = c.editSlide(s, '```rust')
    expect(s.source.endsWith(tail)).toBe(true)
    s = c.editSlide(s, '```rust\nfn main() {}')
    expect(s.source.endsWith(tail)).toBe(true)
    expect(count(s)).toBe(4)
    expect(s.structure!.parsed.error).toBe('Unclosed code fence')
    s = c.editSlide(s, '```rust\nfn main() {}\n```')
    expect(count(s)).toBe(4)
    expect(s.source.endsWith(tail)).toBe(true)
    expect(s.structure!.parsed.error).toBeUndefined()
  })

  it('a stale structure is ignored when source changes', () => {
    const s = c.editSlide(st('# A\n---\n# B\n'), '# A2')
    expect(count({ ...s, source: '# only\n' })).toBe(1)
  })

  it('slide boundaries survive incomplete edits', () => {
    const tail = '# Following code\n```ruby\nputs :hello\n```\n'
    let s = c.editSource(st(''), '# Start\n---\n```rust\nfn main() {}\n```\n---\n' + tail + '---\n# Last\n')
    s = c.select(s, 1)
    s = c.editSlide(s, '```rust\nfn main() {}\n``')
    expect(count(s)).toBe(4)
    expect(c.slideAt(s, 2)).toBe(tail)
    s = c.select(s, 2)
    s = c.editSlide(s, tail + 'A caption')
    expect(count(s)).toBe(4)
    expect(c.slideAt(s, 3)).toBe('# Last\n')
    s = c.select(c.editSlide(c.select(s, 1), '~~~rust\nfn main() {}\n~~~'), 1)
    expect(count(s)).toBe(4)
    expect(parseDeck(s.source).slides).toHaveLength(4)
    // UTF-16 offsets and CRLF tails
    s = c.select(c.editSource(s, '# 🍎\r\n---\r\n# Code\r\n---\r\n# café\r\n'), 1)
    for (const draft of ['~~~', '~~~rust\nfn main() {}', '~~~rust\nfn main() {}\n~~~']) {
      s = c.editSlide(s, draft)
      expect(count(s)).toBe(3)
      expect(c.slideAt(s, 2)).toBe('# café\r\n')
    }
  })
})

describe('slide operations', () => {
  const original = '---\ntitle: Test\n---\n\n# One\n\n---\n\n<!-- keep me -->\n# Two\n\n---\n\n# Three'
  it('reorder, duplicate, add', () => {
    let s = st(original, 2)
    const third = c.slideAt(s, 2)
    const second = c.slideAt(s, 1)
    s = c.moveSlide(s, 2, 0)
    expect(s.selected).toBe(0)
    expect(trimmed(s, 0)).toBe(third.trim())
    expect(trimmed(s, 2)).toBe(second.trim())
    s = c.select(s, 2)
    s = c.duplicateSlides(s)
    expect(count(s)).toBe(4)
    expect(trimmed(s, 2)).toBe(trimmed(s, 3))
    s = c.addSlide(s)
    expect(count(s)).toBe(5)
    expect(c.selectedSlide(s).trim()).toBe('')
    s = c.editSlide(s, '# New')
    expect(count(s)).toBe(5)
    expect(parseDeck(s.source).slides).toHaveLength(5)
  })

  it('range operations', () => {
    const original =
      '---\ntitle: Ranges\n---\n# A\n---\n# B\n![](photo.png)\n---\n# C\n```text\n---\n```\n---\n# D\n---\n# E\n'
    let d = st(original)
    const b = c.slideAt(d, 1)
    const cc = c.slideAt(d, 2)
    d = c.extendSelection(c.select(d, 1), 3)
    expect(c.selectionRange(d).count).toBe(3)
    d = c.extendSelection(d, 2)
    expect(c.selectionRange(d).count).toBe(2)
    expect(d.source).toBe(original)
    d = c.moveSelection(d, 1)
    expect(c.selectionRange(d)).toMatchObject({ first: 2, last: 3 })
    expect(d.selected).toBe(3)
    expect(trimmed(d, 2)).toBe(b.trim())
    expect(trimmed(d, 3)).toBe(cc.trim())
    d = c.dropSelection(d, 0)
    expect(trimmed(d, 0)).toBe(b.trim())
    expect(trimmed(d, 1)).toBe(cc.trim())
    expect(c.selectionRange(d).count).toBe(2)
    const atStart = d.source
    d = c.moveSelection(d, -1)
    d = c.dropSelection(d, 1)
    expect(d.source).toBe(atStart)

    d = c.extendSelection(c.select(d, 1), 0) // backward range keeps active end
    d = c.dropSelection(d, count(d))
    expect(d.selected).toBe(3)
    expect(c.selectionRange(d).last).toBe(4)
    expect(trimmed(d, 3)).toBe(b.trim())
    expect(trimmed(d, 4)).toBe(cc.trim())
    d = c.duplicateSlides(d)
    expect(count(d)).toBe(7)
    expect(c.selectionRange(d)).toMatchObject({ first: 5, last: 6 })
    expect(trimmed(d, 5)).toBe(b.trim())
    expect(trimmed(d, 6)).toBe(cc.trim())
    d = c.deleteSlides(d)
    expect(count(d)).toBe(5)
    d = c.extendSelection(c.select(d, 0), count(d) - 1)
    d = c.deleteSlides(d)
    expect(count(d)).toBe(1)
    expect(c.selectionRange(d).count).toBe(1)
    expect(c.selectedSlide(d).trim()).toBe('')
  })

  it('delete last slide leaves an empty one', () => {
    const s = c.deleteSlides(c.createState('---\ntheme: tokyo-night\n---\n\n# Your next idea\n'))
    expect(count(s)).toBe(1)
    expect(c.selectedSlide(s).trim()).toBe('')
    expect(s.source.startsWith('---\ntheme: tokyo-night\n---\n')).toBe(true)
  })
})

describe('theme and font', () => {
  it('setTheme writes theme and colors', () => {
    const s = c.setTheme(st('---\ntitle: T\ncolor_old: "#000000"\n---\n\n# A\n'), 'nord')
    const h = c.headerOf(s)
    expect(scalar(h, 'theme')).toBe('nord')
    expect(scalar(h, 'title')).toBe('T')
    expect(scalar(h, 'color_background')).toMatch(/^#[0-9a-f]{6}$/)
    expect(scalar(h, 'color_old')).toBe('')
    expect(c.slideAt(s, 0).trim()).toBe('# A')
    expect(parseDeck(s.source).header).toBe(h)
  })
  it('setFont adds front matter when absent', () => {
    const s = c.setFont(st('# A\n'), 'Fira Code')
    expect(s.source).toBe('---\nfont: "Fira Code"\n---\n# A\n')
    expect(c.slideAt(s, 0)).toBe('# A\n')
    expect(c.setFont(s, 'Fira Code')).toBe(s)
  })
})

describe('media commands', () => {
  it('apply to the selected slide and undo is just the previous state', () => {
    const s0 = st('# Headline\n\n![fit background=white alt="Logo"](logo.png)\n')
    const s1 = c.setMediaPosition(s0, 'bottom-right')
    expect(parseMedia(c.selectedSlide(s1))!.position).toBe('bottom-right')
    const s2 = c.setMediaSize(s1, 20)
    expect(parseMedia(c.selectedSlide(s2))!.size).toBe(20)
    expect(c.setMediaMode(s0, 'invalid')).toBe(s0)
    expect(c.setMediaPosition(s0, 'nowhere')).toBe(s0)
    expect(c.setMediaSize(s0, 10)).toBe(s0)
    expect(s0.source).toContain('alt="Logo"')
    expect(s2.source).toContain('alt="Logo"')
  })
  it('video cannot be placed', () => {
    const s = c.editSlide(st('# x'), '![](demo.mp4)')
    expect(c.setMediaPosition(s, 'bottom-right')).toBe(s)
    expect(parseMedia(c.selectedSlide(c.matchImageBackground(s, true)))!.background).toBe('auto')
  })
  it('replaceMedia keeps placement', () => {
    const s = c.replaceMedia(st('# H\n\n![position=top-left size=20%](a.png)\n'), 'b.png')
    const m = parseMedia(c.selectedSlide(s))!
    expect(m.file).toBe('b.png')
    expect(m.position).toBe('top-left')
  })
})
