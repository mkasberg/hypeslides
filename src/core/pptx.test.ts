import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildPptx, fitVideoRect, type PptxImage, type PptxVideo } from './pptx'

const jpeg: PptxImage = { data: new Uint8Array([0xff, 0xd8, 1]), format: 'jpeg' }
const png: PptxImage = { data: new Uint8Array([0x89, 0x50, 2]), format: 'png' }
const video = (over: Partial<PptxVideo> = {}): PptxVideo => ({
  data: new Uint8Array([9, 9, 9]),
  name: 'demo.mp4',
  key: 'demo.mp4',
  poster: jpeg,
  rect: { x: 0, y: 0, w: 1920, h: 1080 },
  autoplay: true,
  loop: false,
  muted: false,
  ...over,
})
const unpack = (bytes: Uint8Array) => {
  const files = unzipSync(bytes)
  return { files, text: (name: string) => strFromU8(files[name]) }
}

describe('buildPptx', () => {
  it('writes one full-bleed picture per slide', () => {
    const { files, text } = unpack(buildPptx({ title: 'Q3 <Review> & "Plans"', slides: [{ image: jpeg }, { image: png }] }))
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml',
      'ppt/_rels/presentation.xml.rels', 'ppt/media/slide1.jpg', 'ppt/media/slide2.png', 'ppt/presentation.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideMasters/slideMaster1.xml',
      'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/_rels/slide2.xml.rels',
      'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/theme/theme1.xml',
    ])
    expect(files['ppt/media/slide1.jpg']).toEqual(jpeg.data)
    expect(text('docProps/core.xml')).toContain('<dc:title>Q3 &lt;Review&gt; &amp; &quot;Plans&quot;</dc:title>')
    expect(text('ppt/presentation.xml')).toContain('<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>')
    expect(text('ppt/presentation.xml')).toContain('<p:sldId id="257" r:id="rId3"/>')
    expect(text('ppt/_rels/presentation.xml.rels')).toContain('Target="slides/slide2.xml"')
    expect(text('[Content_Types].xml')).toContain('PartName="/ppt/slides/slide2.xml"')
    const slide = text('ppt/slides/slide1.xml')
    expect(slide).toContain('<a:blip r:embed="rId2"/>')
    expect(slide).toContain('<a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/>')
    expect(slide).not.toContain('p:timing')
    expect(text('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../media/slide2.png"')
  })

  it('stores entries uncompressed', () => {
    const bytes = buildPptx({ title: 't', slides: [{ image: jpeg }] })
    // Local file header: compression method at offset 8 is 0 (stored).
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true)).toBe(0)
  })

  it('embeds a video with poster, overlay and timing, sharing one movie between slides', () => {
    const { files, text } = unpack(
      buildPptx({
        title: 't',
        slides: [
          { image: jpeg, video: video({ overlay: png, loop: true, muted: true }) },
          { image: jpeg, video: video({ rect: { x: 100, y: 280, w: 1720, h: 730 }, autoplay: false }) },
        ],
      }),
    )
    expect(files['ppt/media/video1.mp4']).toBeDefined()
    expect(files['ppt/media/video2.mp4']).toBeUndefined()
    const rels2 = text('ppt/slides/_rels/slide2.xml.rels')
    expect(rels2).toContain('Id="rId3" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="../media/video1.mp4"')
    expect(rels2).toContain('Target="../media/poster2.jpg"')
    expect(rels2).not.toContain('rId6')

    const s1 = text('ppt/slides/slide1.xml')
    expect(s1).toContain('<p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="rId3"/>')
    expect(s1).toContain('<a:videoFile r:link="rId4"/>')
    expect(s1).toContain('name="Overlay"')
    expect(s1).toContain('<p:cMediaNode vol="0">')
    expect(s1).toContain('repeatCount="indefinite"')
    expect(s1).toContain('<p:cond delay="0"/>')
    expect(text('ppt/slides/_rels/slide1.xml.rels')).toContain('Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/overlay1.png"')

    const s2 = text('ppt/slides/slide2.xml')
    expect(s2).toContain('<a:off x="635000" y="1778000"/><a:ext cx="10922000" cy="4635500"/>')
    expect(s2).toContain('<p:cond delay="indefinite"/>')
    expect(s2).toContain('<p:cMediaNode vol="100000">')
    expect(s2).not.toContain('repeatCount')
    expect(s2).not.toContain('Overlay')
  })

  it('writes a repeat count for finite repeats', () => {
    const { text } = unpack(buildPptx({ title: 't', slides: [{ image: jpeg, video: video({ repeatCount: 3 }) }] }))
    expect(text('ppt/slides/slide1.xml')).toContain('repeatCount="3000"')
  })

  it('refuses an empty deck', () => {
    expect(() => buildPptx({ title: 't', slides: [] })).toThrow(/no slides/)
  })
})

describe('fitVideoRect', () => {
  it('centers the video inside its box, keeping its shape', () => {
    expect(fitVideoRect({ x: 70, y: 50, w: 1780, h: 980 }, 1080, 1920)).toEqual({
      x: 70 + (1780 - 980 * (1080 / 1920)) / 2, y: 50, w: 980 * (1080 / 1920), h: 980,
    })
    expect(fitVideoRect({ x: 100, y: 280, w: 1720, h: 730 }, 1920, 1080).w).toBeCloseTo(730 * (16 / 9))
  })
})
