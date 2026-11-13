// PowerPoint export, after Hype's Deck::exportPptx: render every slide at 4K,
// embed compatible videos, and package with core `buildPptx`. Rendering and
// media access are injected so the pipeline is testable without a browser.

import { buildPptx, fitVideoRect, isPowerPointMp4, parseMedia, probeMp4 } from '../core'
import type { PptxImage, PptxSlide, PptxVideo } from '../core'
import { FULL, mediaRect } from '../render/layout'

export interface PptxExportDeps {
  /** Rendered slide (3840×2160). 'overlay' is the transparent text layer for spanning video. */
  renderSlide(source: string, layer?: 'overlay'): Promise<Blob>
  /** A media file by name, or null if missing. */
  readMedia(name: string): Promise<Blob | null>
  /** First frame of a video file as an image, or null if it can't be decoded. */
  videoFrame(video: Blob): Promise<Blob | null>
  /** Re-encode an image PowerPoint can't take (e.g. WebP) as PNG. */
  toPng(image: Blob): Promise<Blob>
}

export interface PptxExportOptions {
  title: string
  /** Each slide's Markdown. */
  slides: string[]
  onProgress?(done: number, total: number): void
  signal?: AbortSignal
}

export interface PptxExportResult {
  bytes: Uint8Array
  /** Slides that exported with a compromise (e.g. a video kept as a still). */
  warnings: string[]
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

/** PNG or JPEG by content, as Hype checks contents rather than the file extension. */
function sniff(bytes: Uint8Array): PptxImage['format'] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return null
}

async function image(blob: Blob, deps: PptxExportDeps): Promise<PptxImage> {
  let data = await bytesOf(blob)
  let format = sniff(data)
  if (!format) {
    data = await bytesOf(await deps.toPng(blob))
    format = 'png'
  }
  return { data, format }
}

export async function exportPptx(options: PptxExportOptions, deps: PptxExportDeps): Promise<PptxExportResult> {
  const { slides, signal } = options
  const warnings: string[] = []
  const out: PptxSlide[] = []
  const movies = new Map<string, { data: Uint8Array; width: number; height: number } | null>()
  for (let i = 0; i < slides.length; i++) {
    signal?.throwIfAborted()
    options.onProgress?.(i, slides.length)
    const source = slides[i]
    const slide: PptxSlide = { image: await image(await deps.renderSlide(source), deps) }
    const media = parseMedia(source)
    if (media?.video && media.file) {
      const name = media.file
      let movie = movies.get(name)
      if (movie === undefined) {
        const file = await deps.readMedia(name)
        if (!file) throw new Error(`Slide ${i + 1}: Missing media ${name}`)
        const data = await bytesOf(file)
        const info = probeMp4(data)
        // Re-encoding (Hype runs ffmpeg) is not done yet: incompatible video stays a still.
        movie = /\.mp4$/i.test(name) && isPowerPointMp4(info) && info?.video
          ? { data, width: info.video.width, height: info.video.height }
          : null
        movies.set(name, movie)
      }
      if (!movie) {
        warnings.push(`Slide ${i + 1}: ${name} is not an H.264/AAC MP4, so it was exported as a still`)
      } else {
        if (media.span && Math.abs(movie.width / movie.height - 16 / 9) > 0.01)
          throw new Error(`Slide ${i + 1}: Spanning video must be 16:9 for PowerPoint: ${name}. Use fit.`)
        const posterFile = media.poster ? await deps.readMedia(media.poster) : null
        if (media.poster && !posterFile) throw new Error(`Slide ${i + 1}: Missing poster ${media.poster}`)
        const still = posterFile ?? (await deps.videoFrame(new Blob([movie.data as BlobPart], { type: 'video/mp4' })))
        if (!still) throw new Error(`Slide ${i + 1}: Cannot read the first frame of ${name}`)
        const video: PptxVideo = {
          data: movie.data,
          name,
          key: name,
          poster: await image(still, deps),
          rect: media.span ? FULL : fitVideoRect(mediaRect(media), movie.width, movie.height),
          autoplay: media.autoplay,
          loop: media.loop,
          muted: media.muted,
        }
        if (media.span) video.overlay = await image(await deps.renderSlide(source, 'overlay'), deps)
        slide.video = video
      }
    }
    out.push(slide)
  }
  signal?.throwIfAborted()
  options.onProgress?.(slides.length, slides.length)
  return { bytes: buildPptx({ title: options.title, slides: out }), warnings }
}
