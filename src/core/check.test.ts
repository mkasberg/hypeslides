import { describe, expect, it } from 'vitest'
import { findProblems, slideProblems } from './check'

// Ported from ~/code/hype/tests/test_cli.py (check) and tests.cpp (inlineSvg, nested media).
const DECK = '# One\n\n---\n\n# Two\n\n- a\n- b\n\n---\n\n```ruby\na = 1\n---\nb = 2\n```\n'
const none = () => false
const brief = (source: string, options = {}) =>
  findProblems(source, options).map((p) => [p.slide, p.line, p.severity, p.message])
const messages = (s: string, exists?: (f: string) => boolean) =>
  slideProblems(s, { mediaExists: exists }).map((p) => p.message)

describe('findProblems', () => {
  it('reports every problem with slide and line', () => {
    const source = DECK + '\n---\n\n![](missing.png)\n\n---\n\n![bogus=1](gone.png)\n\n---\n'
    // Hype's CLI numbers slides from 1; ours are 0-based.
    expect(brief(source, { mediaExists: none })).toEqual([
      [3, 20, 'error', 'Missing media: missing.png'],
      [4, 24, 'error', 'Unknown media directive: bogus'],
      [4, 24, 'error', 'Missing media: gone.png'],
      [5, 26, 'warning', 'Empty slide'],
    ])
  })

  it('a clean deck has no problems, and existing media is fine', () => {
    expect(findProblems(DECK)).toEqual([])
    expect(findProblems('# One\n\n![](logo.gif)\n', { mediaExists: (f) => f === 'logo.gif' })).toEqual([])
  })

  it('reports invalid placement', () => {
    const exists = () => true
    expect(
      brief('# One\n\n![position=middle](logo.gif)\n\n---\n\n![position=left size=nan%](logo.gif)\n', {
        mediaExists: exists,
      }),
    ).toEqual([
      [0, 1, 'error', 'Unknown position'],
      [1, 7, 'error', 'Size must be a percentage from 1% to 100%'],
    ])
    expect(findProblems('# One\n\n![position=bottom-right size=10%](logo.gif)\n', { mediaExists: exists })).toEqual([])
  })

  it('locates an unclosed fence for the whole presentation', () => {
    expect(findProblems('# One\n\n---\n\n```ruby\na = 1\n')).toEqual([
      { slide: null, line: 5, severity: 'error', kind: 'fence', message: 'Unclosed code fence' },
    ])
    const fm = findProblems('---\ntitle: x\n\n# One\n')
    expect(fm[0]).toMatchObject({ slide: null, line: 1, kind: 'front-matter', message: 'Front matter needs a closing ---' })
  })

  it('warns when text fits below a readable size, only on otherwise clean slides', () => {
    const textSize = (s: string) => (s.includes('point number') ? 12 : 60)
    const crowded = Array.from({ length: 60 }, (_, i) => `- point number ${i}`).join('\n')
    const found = findProblems(`# One\n\n---\n\n${crowded}\n`, { textSize })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      slide: 1, line: 5, severity: 'warning', kind: 'shrink', message: 'Text fits below 24px on a 1080p slide',
    })
    expect(
      findProblems(`# One\n\n---\n\n![](gone.png)\n\n${crowded}\n`, { textSize, mediaExists: none }).map((p) => p.kind),
    ).toEqual(['media'])
    expect(findProblems('# a\n', { textSize: () => 24 })).toEqual([])
  })

  it('warns about a theme that is not installed unless colors are set', () => {
    expect(brief('---\ntitle: T\ntheme: nope\n---\n\n# One\n')).toEqual([
      [null, 3, 'warning', 'Theme nope is not installed; using the default colors'],
    ])
    expect(findProblems('---\ntheme: nope\ncolor_background: "#fff"\n---\n\n# One\n')).toEqual([])
    expect(findProblems('---\ntheme: tokyo-night\n---\n\n# One\n')).toEqual([])
  })
})

describe('slideProblems', () => {
  it('nested media', () => {
    expect(messages('![](images/gone.png)', none)).toEqual(['Missing media: images/gone.png'])
    expect(messages('![](photo.png)', (f) => f === 'photo.png')).toEqual([])
    expect(messages('![poster="p.jpg"](v.mp4)', (f) => f === 'v.mp4')).toEqual(['Missing poster'])
    // No resolver: the missing-media checks are skipped.
    expect(messages('![](gone.png)')).toEqual([])
  })

  it('ignores media in comments and code', () => {
    expect(messages('<!-- ![](a.png) -->\n\n```md\n![](b.png)\n```\n', none)).toEqual([])
  })

  it('inline svg', () => {
    const chart =
      '# Growth\n\n```svg\n<svg viewBox="0 0 200 100">\n  <rect width="200" height="100" fill="var(--accent)"/>\n' +
      '  <text x="10" y="50">Requests per second</text>\n</svg>\n```\n'
    expect(messages(chart)).toEqual([])
    expect(messages('```svg\n```\n')).not.toEqual([])
    expect(messages(chart + chart).join(' ')).toContain('one media item')
    expect(
      messages('```svg\n<svg xmlns = "http://www.w3.org/2000/svg" viewBox = "0 0 1 1" fill = "red" color = "red" font-family = "sans"/>\n```\n'),
    ).toEqual([])
    expect(messages('```svg\n<svg viewBox="0 0 1 1">\n<rect>\n</svg>\n```')[0]).toMatch(/^SVG line 3: /)
    expect(messages('```svg\n<svg viewBox="0 0 1 1"><rect fill="var(--purple)"/></svg>\n```')[0]).toMatch(
      /^Unknown theme color --purple; use --background/,
    )
    expect(messages('```svg\n<svg><rect/></svg>\n```')[0]).toContain('viewBox')
    expect(messages('```svg\n<svg width="10" height="5"/>\n```')).toEqual([])
    expect(messages('```svg\n<div/>\n```')[0]).toBe('An svg block holds one <svg> element')
    expect(messages('![](photo.jpg)\n\n```svg\n<svg viewBox="0 0 1 1"/>\n```').join(' ')).toContain('one media item')
  })
})
