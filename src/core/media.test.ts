import { describe, expect, it } from 'vitest'
import {
  isVideoFile, mediaDir, mediaWithBackground, mediaWithMode, mediaWithPosition, mediaWithSize,
  parseMedia, speakerNotes, withMedia, withReplacedMedia, MEDIA_POSITIONS,
} from './media'

const m = (s: string) => parseMedia(s)!

describe('speakerNotes', () => {
  it('ignores directives and code', () => {
    const s =
      '<!-- First note -->\n\n<!-- hype: background="#112233" -->\n\n# Title\n\n' +
      '```html\n<!-- Shown as code, not a note -->\n```\n\n<!-- Second\nline -->'
    expect(speakerNotes(s)).toBe('First note\n\nSecond\nline')
    expect(speakerNotes('# Title\n<!-- Hype makes Markdown presentations. -->')).toBe(
      'Hype makes Markdown presentations.',
    )
  })
})

describe('parseMedia', () => {
  it('defaults and directives', () => {
    let x = m('![](<City at night.JPG>)\n\n# Hello')
    expect(x.file).toBe('City at night.JPG')
    expect(x.dir).toBe('images')
    expect(x.span).toBe(true)
    expect(x.overlay).toBe(0.25)
    x = m('![fit](images/chart.png)\n\n# Chart')
    expect(x.span).toBe(false)
    expect(x.mode).toBe('fit')
    x = m('![span loop muted poster="demo still.jpg"](demo.MP4)')
    expect(x.video && x.span && x.loop && x.muted).toBe(true)
    expect(x.dir).toBe('videos')
    expect(x.poster).toBe('demo still.jpg')
    expect(m('![autoplay=false](demo.mp4)').autoplay).toBe(false)
    expect(m('![span fit](photo.jpg)').error).toBeTruthy()
    // A lone "left" is ordinary alt text.
    x = m('![left](photo.jpg)\n\n# Text')
    expect(x.error).toBeUndefined()
    expect(x.span).toBe(true)
  })

  it('placed images', () => {
    let x = m('# Headline\n\n![position=bottom-right size=10%](logo.png)')
    expect(x.error).toBeUndefined()
    expect(x.position).toBe('bottom-right')
    expect(x.size).toBe(10)
    expect(x.span).toBe(false)
    expect(x.overlay).toBe(0)
    x = m('![position=top](logo.png)')
    expect(x.size).toBe(10)
    x = m('![size=20%](logo.png)')
    expect(x.position).toBe('center')
    expect(m('![size=12.5%](logo.png)').size).toBe(12.5)
    expect(m('![](logo.png)').position).toBeUndefined()
    expect(MEDIA_POSITIONS).toHaveLength(9)
    for (const bad of [
      'position=middle', 'size=0%', 'size=101%', 'size=10', 'size=nan%', 'size=NaN%', 'size=1e1%',
      'size=%', 'size=-5%', 'fit position=left', 'span size=10%', 'position=left background=white',
      'position=left overlay=0.5',
    ])
      expect(m(`![${bad}](logo.png)`).error, bad).toBeTruthy()
    expect(m('![position=left](demo.mp4)').error).toBeTruthy()
    expect(m('![position="<b>x</b>"](logo.png)').error).toBe('Unknown position')
  })

  it('code is not media', () => {
    const src = '```markdown\n![](missing.png)\n<!-- Keep this code -->\n```'
    expect(parseMedia(src)).toBeNull()
    expect(parseMedia('An inline `![](missing.png)` example.')).toBeNull()
    expect(parseMedia('# Plain')).toBeNull()
  })

  it('extracts svg blocks', () => {
    const x = m('# T\n\n```svg\n<svg viewBox="0 0 1 1"/>\n```\n')
    expect(x.file).toBe('')
    expect(x.svg).toBe('<svg viewBox="0 0 1 1"/>\n')
    expect(x.text).not.toContain('svg')
  })

  it('classifies files', () => {
    expect(isVideoFile('a.MOV')).toBe(true)
    expect(isVideoFile('a.png')).toBe(false)
    expect(mediaDir('x.webm')).toBe('videos')
    expect(mediaDir('x.jpg')).toBe('images')
  })
})

describe('media rewriting', () => {
  it('withMedia replaces only real media', () => {
    const ex = '<!-- ![](comment.png) -->\n```md\n![](example.png)\n```\nInline `![](inline.png)`\n# Title\n'
    expect(withMedia(ex + '![fit](old.png)\nCaption', '![](<new.png>)')).toBe(ex + '![](<new.png>)\nCaption')
    expect(withMedia(ex, '![](<new.png>)')).toBe(ex + '\n![](<new.png>)\n')
  })

  it('controls preserve code and alt text', () => {
    const ex =
      '```markdown\n![](fenced.png)\n```\n    ![](indented.png)\n\n`![](inline.png)`\n<!-- ![](comment.png) -->\n'
    let s = mediaWithMode(ex + '![fit alt="fit left right span loop"](photo.png)', 'span')!
    expect(s.startsWith(ex)).toBe(true)
    expect(s.endsWith('![span alt="fit left right span loop"](photo.png)')).toBe(true)
    s = mediaWithBackground(s, 'blur')!
    expect(s).toContain('alt="fit left right span loop"')
    expect(s.startsWith(ex)).toBe(true)
    s = mediaWithBackground('# Headline\n![span](photo.png)', 'white')!
    expect(s.endsWith('![fit background=white](photo.png)')).toBe(true)
    expect(m(s).error).toBeUndefined()
    expect(m(s).span).toBe(false)
    expect(mediaWithBackground(s, 'black')!.endsWith('![fit background=black](photo.png)')).toBe(true)
    expect(m(mediaWithBackground(s, 'theme')!).background).toBe('theme')
    s = mediaWithMode('![Sloop rigging](photo.png)', 'fit')!
    expect(m(s).span).toBe(false)
    expect(m(s).error).toBeUndefined()
    expect(s).toContain('alt="Sloop rigging"')
    expect(parseMedia('```sh\n# Comment\n```\n![](photo.png)')!.span).toBe(false)
    expect(m('# Headline\n![](photo.png)').span).toBe(true)
    expect(mediaWithMode(s, 'invalid')).toBeNull()
  })

  it('placement controls', () => {
    let s = '# Headline\n![span background=blur alt="Company"](logo.png)'
    s = mediaWithPosition(s, 'bottom-right')!
    let x = m(s)
    expect(x.error).toBeUndefined()
    expect(x.position).toBe('bottom-right')
    expect(x.size).toBe(10)
    expect(x.background).toBeUndefined()
    expect(s).toContain('alt="Company"')
    s = mediaWithSize(s, 12.5)!
    expect(m(s).size).toBe(12.5)
    s = mediaWithSize(s, 20)!
    s = mediaWithPosition(s, 'top-left')!
    x = m(s)
    expect(x.position).toBe('top-left')
    expect(x.size).toBe(20)
    s = mediaWithMode(s, 'fit')!
    expect(m(s).error).toBeUndefined()
    expect(m(s).position).toBeUndefined()
    expect(mediaWithSize(s, 10)).toBeNull()
    expect(mediaWithPosition(s, 'nowhere')).toBeNull()
    expect(mediaWithPosition('![](demo.mp4)', 'bottom-right')).toBeNull()
    s = mediaWithBackground('![position=bottom-right size=20%](logo.png)', 'white')!
    x = m(s)
    expect(x.error).toBeUndefined()
    expect(x.position).toBeUndefined()
    expect(x.background).toBe('white')
  })

  it('replacing placed media keeps placement', () => {
    const placed = '# Headline\n\n![position=bottom-right size=20% alt="Old"](old.png)\n'
    const x = m(withReplacedMedia(placed, 'new.png'))
    expect(x.file).toBe('new.png')
    expect(x.position).toBe('bottom-right')
    expect(x.size).toBe(20)
    expect(x.error).toBeUndefined()
    const v = parseMedia(withReplacedMedia(placed, 'demo.mp4'))!
    expect(v.position).toBeUndefined()
    expect(v.error).toBeUndefined()
    expect(withReplacedMedia('# Headline\n![fit](old.png)', 'new.png')).toBe('# Headline\n![](<new.png>)')
    expect(withReplacedMedia('# Headline', 'new.png')).toBe('# Headline\n![](<new.png>)\n')
  })
})
