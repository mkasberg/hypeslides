/// <reference lib="webworker" />
// Decodes, fits to 4K and losslessly re-encodes a pasted still image off the
// main thread. Port of readSizedImage / compressedImage in
// ~/code/hype/src/images.cpp; the decisions live in src/core/mediaImport.ts.

import { MEDIA_CANVAS, imageSizeForCanvas, pickLossless, shouldTryWebp } from '../core/mediaImport'

export interface ImageJob {
  file: Blob
  span: boolean
}
export type ImageWorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; blob: Blob; ext: 'png' | 'webp'; resized: boolean }
  | { type: 'error'; message: string }

const post = (m: ImageWorkerMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = async (ev: MessageEvent<ImageJob>) => {
  try {
    const { file, span } = ev.data
    post({ type: 'progress', value: 0.05 })
    // createImageBitmap applies EXIF orientation by default.
    let bitmap = await createImageBitmap(file)
    post({ type: 'progress', value: 0.3 })
    const original = { width: bitmap.width, height: bitmap.height }
    const target = imageSizeForCanvas(original, MEDIA_CANVAS, span)
    const resized = target.width !== original.width || target.height !== original.height
    if (resized) {
      const scaled = await createImageBitmap(bitmap, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' })
      bitmap.close()
      bitmap = scaled
    }
    post({ type: 'progress', value: 0.55 })
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D context')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const png = await canvas.convertToBlob({ type: 'image/png' })
    post({ type: 'progress', value: 0.8 })
    let best: { blob: Blob; ext: 'png' | 'webp' } = { blob: png, ext: 'png' }
    if (shouldTryWebp(png.size)) {
      // Quality 1 selects lossless WebP in Chromium; other engines may not encode WebP at all.
      const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 1 })
      if (webp.type === 'image/webp' && pickLossless(png.size, webp.size) === 'webp') best = { blob: webp, ext: 'webp' }
    }
    post({ type: 'progress', value: 1 })
    post({ type: 'done', ...best, resized })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
