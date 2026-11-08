import { describe, expect, it } from 'vitest'
import { renderSlideHtml } from './markdown'
import { sanitizeSvg, textMode } from './layout'

describe('renderSlideHtml', () => {
  it('reads *x* as italic, **x** as bold, _x_ as underline', () => {
    const html = renderSlideHtml('*it* **bold** _under_ __under2__')
    expect(html).toContain('<em>it</em>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<u>under</u>')
    expect(html).toContain('<u>under2</u>')
    expect(html).not.toMatch(/<em>under/)
  })
  it('hides comments', () => {
    const html = renderSlideHtml('Hello\n\n<!-- speaker note -->\n\nWorld')
    expect(html).not.toContain('speaker')
    expect(html).not.toContain('&lt;!--')
    expect(html).toContain('Hello')
  })
  it('keeps comment-like text inside code', () => {
    expect(renderSlideHtml('```\n<!-- keep -->\n```')).toContain('&lt;!-- keep --&gt;')
  })
  it('preserves line breaks', () => {
    expect(renderSlideHtml('one\ntwo\nthree')).toContain('one<br>\ntwo<br>\nthree')
    expect(renderSlideHtml('a\\\nb')).toContain('<br>')
  })
  it('does not pass raw html through', () => {
    const html = renderSlideHtml('<script>alert(1)</script> <b>x</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
  })
  it('renders tables with alignment', () => {
    const html = renderSlideHtml('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |')
    expect(html).toContain('<table>')
    expect(html).toMatch(/<th style="text-align:center">B<\/th>/)
    expect(html).toMatch(/<td style="text-align:right">3<\/td>/)
    expect(html).toMatch(/<th style="text-align:left">A<\/th>/)
  })
  it('pads cells with more than one space beside the text', () => {
    const html = renderSlideHtml('| A |\n| --- |\n|   x   |')
    expect(html).toContain('<td>&nbsp;&nbsp;x&nbsp;&nbsp;</td>')
    expect(renderSlideHtml('| A |\n| --- |\n| x |')).toContain('<td>x</td>')
  })
  it('tags fenced code with its language', () => {
    const html = renderSlideHtml('```ruby\nputs "hi"\n```')
    expect(html).toContain('<code class="language-ruby">')
    expect(html).toContain('puts &quot;hi&quot;')
  })
  it('uses the highlighter when given', () => {
    const html = renderSlideHtml('```js\nx\n```', { highlight: (code, lang) => `<i>${lang}:${code}</i>` })
    expect(html).toContain('<i>js:x</i>')
  })
  it('renders headings, lists, quotes and inline code', () => {
    const html = renderSlideHtml('# H\n\n- a\n- b\n\n> q\n\n`c`')
    expect(html).toContain('<h1>H</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<code>c</code>')
  })
  it('marks attribution paragraphs', () => {
    expect(renderSlideHtml('— Hype')).toContain('<p class="attribution">')
  })
})

describe('layout helpers', () => {
  it('sanitizes svg', () => {
    const out = sanitizeSvg('<svg onload="x()"><script>bad()</script><rect onclick=\'y\' fill="red"/></svg>')
    expect(out).not.toMatch(/script|onload|onclick/)
    expect(out).toContain('fill="red"')
  })
  it('picks text sizes like Hype', () => {
    expect(textMode('# Hi', '', false).high).toBe(76)
    expect(textMode('a\nb', '', false).high).toBe(128)
    expect(textMode('- a', '', false)).toMatchObject({ list: true, centered: false, high: 72 })
    expect(textMode('```ruby\nx\n```', '', false)).toMatchObject({ code: true, high: 56 })
    expect(textMode('| a |\n| - |\n| b |', '', false)).toMatchObject({ table: true, centered: true })
  })
})
