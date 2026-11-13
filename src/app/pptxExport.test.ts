import demoMp4 from '../../tests/parity/decks/media/videos/demo.mp4?inline'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { exportPptx, type PptxExportDeps } from './pptxExport'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2])
const H264 = Uint8Array.from(atob(demoMp4.split(',')[1]), (c) => c.charCodeAt(0)) // 320×180

function deps(files: Record<string, Uint8Array> = {}): PptxExportDeps & { rendered: string[] } {
  const rendered: string[] = []
  return {
    rendered,
    renderSlide: vi.fn(async (source: string, layer?: 'overlay') => {
      rendered.push(layer ? `${layer}:${source}` : source)
      return new Blob([(layer ? PNG : JPEG) as BlobPart])
    }),
    readMedia: async (name) => (files[name] ? new Blob([files[name] as BlobPart]) : null),
    videoFrame: async () => new Blob([JPEG as BlobPart]),
    toPng: async () => new Blob([PNG as BlobPart]),
  }
}

const unpack = (bytes: Uint8Array) => {
  const files = unzipSync(bytes)
  return { files, text: (n: string) => strFromU8(files[n]) }
}

describe('exportPptx', () => {
  it('renders every slide and reports progress', async () => {
    const d = deps()
    const progress: number[] = []
    const { bytes, warnings } = await exportPptx(
      { title: 'Deck', slides: ['# One', '# Two'], onProgress: (n) => progress.push(n) },
      d,
    )
    expect(d.rendered).toEqual(['# One', '# Two'])
    expect(progress).toEqual([0, 1, 2])
    expect(warnings).toEqual([])
    const { files } = unpack(bytes)
    expect(files['ppt/media/slide1.jpg']).toEqual(JPEG)
    expect(files['ppt/media/slide2.jpg']).toBeDefined()
  })

  it('embeds a fitted H.264 video inside the media box, once per file', async () => {
    const d = deps({ 'demo.mp4': H264 })
    const { bytes } = await exportPptx({ title: 'Deck', slides: ['![fit](demo.mp4)', '![fit autoplay=false](demo.mp4)'] }, d)
    const { files, text } = unpack(bytes)
    expect(files['ppt/media/video1.mp4']).toEqual(H264)
    expect(files['ppt/media/video2.mp4']).toBeUndefined()
    expect(files['ppt/media/poster1.jpg']).toEqual(JPEG)
    // Box 70,50 1780×980 at 16:9 → 1742.2×980 centered; ×6350 EMU/px.
    const w = 980 * (16 / 9)
    const x = Math.trunc((70 + (1780 - w) / 2) * 6350)
    expect(text('ppt/slides/slide1.xml')).toContain(`<a:off x="${x}" y="${50 * 6350}"/>`)
    expect(text('ppt/slides/slide1.xml')).not.toContain('Overlay')
    expect(d.rendered.some((r) => r.startsWith('overlay:'))).toBe(false)
  })

  it('puts a transparent text overlay over a spanning video', async () => {
    const d = deps({ 'demo.mp4': H264, 'cover.webp': new Uint8Array([0x52, 0x49, 0x46, 0x46]) })
    const source = '![span poster=cover.webp](demo.mp4)\n\n# Title'
    const { bytes } = await exportPptx({ title: 'Deck', slides: [source] }, d)
    const { files, text } = unpack(bytes)
    expect(d.rendered).toEqual([source, `overlay:${source}`])
    expect(files['ppt/media/overlay1.png']).toEqual(PNG)
    // A WebP poster is re-encoded as PNG.
    expect(files['ppt/media/poster1.png']).toEqual(PNG)
    expect(text('ppt/slides/slide1.xml')).toContain('<a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/>')
  })

  it('keeps an incompatible video as a still, with a warning', async () => {
    const d = deps({ 'clip.webm': new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]) })
    const { bytes, warnings } = await exportPptx({ title: 'Deck', slides: ['# Intro', '![](clip.webm)'] }, d)
    expect(warnings).toEqual(['Slide 2: clip.webm is not an H.264/AAC MP4, so it was exported as a still'])
    expect(Object.keys(unpack(bytes).files).some((n) => n.endsWith('.mp4'))).toBe(false)
  })

  it('refuses a spanning video that is not 16:9, as Hype does', async () => {
    const square = H264.slice()
    // Patch the first sample entry's coded width (stsd body + 8, then 32 bytes in) to 180.
    const at = new TextDecoder('latin1').decode(square).indexOf('stsd') + 4 + 8 + 32
    new DataView(square.buffer).setUint16(at, 180)
    await expect(exportPptx({ title: 'D', slides: ['![span](sq.mp4)'] }, deps({ 'sq.mp4': square }))).rejects.toThrow(
      'Slide 1: Spanning video must be 16:9 for PowerPoint: sq.mp4. Use fit.',
    )
  })

  it('stops when aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(exportPptx({ title: 'D', slides: ['# a'], signal: ctl.signal }, deps())).rejects.toThrow()
  })
})
