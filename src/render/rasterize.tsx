// Slide rasterization: renders a <SlideView> in 'export' mode offscreen at its
// logical 1920×1080 size, waits until it has settled (`whenPrintReady`), and
// captures it into a canvas with snapdom. Used by PowerPoint export (3840×2160,
// as Hype renders) and, later, the agent `render_slide` tool. Browser only.

import { snapdom } from '@zumer/snapdom'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Palette } from '../core/types'
import { whenPrintReady } from './printReady'
import { ensureStyles } from './styles'
import { SlideView } from './SlideView'
import { SLIDE_HEIGHT, SLIDE_WIDTH, type MediaResolver } from './types'

export interface RasterizeOptions {
  /** Output width in pixels (height follows 16:9). Default 3840. */
  width?: number
  /** 'overlay': only the text and darkening overlay, on transparency (see SlideViewProps.layer). */
  layer?: 'overlay'
}

export interface SlideRasterizer {
  render(source: string, options?: RasterizeOptions): Promise<HTMLCanvasElement>
  /** Unmount the offscreen host. */
  dispose(): void
}

export interface DeckLook {
  palette: Palette
  font: string
  resolveMedia: MediaResolver
}

/** An offscreen host that renders one slide at a time. Calls must not overlap. */
export function createSlideRasterizer({ palette, font, resolveMedia }: DeckLook): SlideRasterizer {
  ensureStyles()
  const host = document.createElement('div')
  host.className = 'hs-raster-root'
  host.setAttribute('aria-hidden', 'true')
  // Offscreen but visible: a capture copies computed styles, so visibility:hidden would capture nothing.
  Object.assign(host.style, {
    position: 'fixed', left: '-100000px', top: '0', width: `${SLIDE_WIDTH}px`, height: `${SLIDE_HEIGHT}px`,
    pointerEvents: 'none', contain: 'strict',
  })
  document.body.appendChild(host)
  const root = createRoot(host)
  return {
    async render(source, { width = 3840, layer } = {}) {
      flushSync(() =>
        root.render(
          <SlideView source={source} palette={palette} font={font} resolveMedia={resolveMedia} mode="export" layer={layer} />,
        ),
      )
      await whenPrintReady(host)
      const slide = host.querySelector<HTMLElement>('.hs-outer')
      if (!slide) throw new Error('Slide did not render')
      const capture = await snapdom(slide, { width, height: (width * 9) / 16, dpr: 1, embedFonts: true, invalidate: true })
      return capture.toCanvas()
    },
    dispose() {
      root.unmount()
      host.remove()
    },
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the slide image'))), type, quality),
  )
}

/** A video's first frame at its full size, as a JPEG (Hype's generated poster). Null if it can't be decoded. */
export function videoFrame(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    let done = false
    const finish = (blob: Blob | null) => {
      if (done) return
      done = true
      video.removeAttribute('src')
      video.load()
      resolve(blob)
    }
    video.onloadeddata = () => {
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) return finish(null)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return finish(null)
      ctx.drawImage(video, 0, 0, w, h)
      canvasBlob(canvas, 'image/jpeg', 0.92).then(finish, () => finish(null))
    }
    video.onerror = () => finish(null)
    setTimeout(() => finish(null), 15000)
    video.src = url + '#t=0.001'
  })
}

/** Re-encode any decodable image as PNG (PowerPoint takes PNG and JPEG). */
export async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    return await canvasBlob(canvas, 'image/png')
  } finally {
    bitmap.close()
  }
}
