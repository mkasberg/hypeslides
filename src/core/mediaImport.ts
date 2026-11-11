// Pure decisions for pasted media: which files are recompressed, the 4K fit
// rule, PNG vs lossless WebP, and the filename prompt's validation. Ported
// from ~/code/hype/src/images.cpp (imageSizeForCanvas, compressedImage) and
// deck.cpp (pasteMedia, savePastedMedia). No DOM APIs: the pixel work lives in
// src/workers/imageWorker.ts.

import { isVideoFile } from './media'

export interface Size {
  width: number
  height: number
}

/** Stills are resized to fit (or, for span slides, cover) this canvas. */
export const MEDIA_CANVAS: Size = { width: 3840, height: 2160 }
/** PNGs at or below this size are kept; larger ones are compared with lossless WebP. */
export const WEBP_TRIAL_BYTES = 65536

export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** The file name without its extension (Qt's completeBaseName). */
export function baseName(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? base : base.slice(0, dot)
}

/**
 * Size to scale `original` to so it fits `canvas` (Hype's imageSizeForCanvas):
 * contain, or cover when `span`. Images are never enlarged.
 */
export function imageSizeForCanvas(original: Size, canvas: Size = MEDIA_CANVAS, span = false): Size {
  if (original.width <= 0 || original.height <= 0) return original
  const rw = canvas.width / original.width
  const rh = canvas.height / original.height
  const k = span ? Math.max(rw, rh) : Math.min(rw, rh)
  const target = {
    width: Math.max(1, Math.round(original.width * k)),
    height: Math.max(1, Math.round(original.height * k)),
  }
  return target.width < original.width ? target : original
}

/** Lossless WebP is only tried for PNGs bigger than the threshold. */
export function shouldTryWebp(pngBytes: number): boolean {
  return pngBytes > WEBP_TRIAL_BYTES
}

/** PNG unless lossless WebP is strictly smaller. */
export function pickLossless(pngBytes: number, webpBytes: number | null): 'png' | 'webp' {
  return webpBytes !== null && webpBytes < pngBytes ? 'webp' : 'png'
}

/**
 * Keep the pasted file byte-for-byte when re-encoding neither shrank the pixels
 * nor the file (Hype keeps an already-small JPEG/WebP over the lossless rewrite).
 */
export function keepOriginal(resized: boolean, encodedBytes: number, originalBytes: number): boolean {
  return !resized && encodedBytes >= originalBytes
}

const STILL_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']

/** Pasted files that skip the recompression step: video, SVG, unknown types. */
export function copiedAsIs(name: string): boolean {
  return isVideoFile(name) || !STILL_EXTENSIONS.includes(fileExtension(name))
}

/** True for multi-frame GIF, animated WebP and APNG (never rasterized). */
export function isAnimatedImage(bytes: Uint8Array, name: string): boolean {
  const ascii = (at: number, s: string) => [...s].every((c, i) => bytes[at + i] === c.charCodeAt(0))
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    // VP8X flags byte: bit 1 is the animation flag.
    return ascii(12, 'VP8X') && (bytes[20] & 0x02) !== 0
  }
  if (bytes[0] === 0x89 && ascii(1, 'PNG')) {
    let at = 8
    while (at + 8 <= bytes.length) {
      const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
      if (ascii(at + 4, 'acTL')) return true
      if (ascii(at + 4, 'IDAT')) return false
      at += 12 + length
    }
    return false
  }
  if (ascii(0, 'GIF8') || fileExtension(name) === 'gif') {
    if (!ascii(0, 'GIF8')) return false
    let at = 13
    if (bytes[10] & 0x80) at += 3 * (1 << ((bytes[10] & 7) + 1))
    let frames = 0
    const skipBlocks = () => {
      while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1
      at++
    }
    while (at < bytes.length) {
      const block = bytes[at++]
      if (block === 0x21) {
        at++
        skipBlocks()
      } else if (block === 0x2c) {
        if (++frames > 1) return true
        const flags = bytes[at + 8]
        at += 9
        if (flags & 0x80) at += 3 * (1 << ((flags & 7) + 1))
        at++ // LZW minimum code size
        skipBlocks()
      } else break
    }
  }
  return false
}

/** Default name in the prompt: the file's base name, or "image" / "video". */
export function defaultPasteName(fileName: string, video: boolean): string {
  return baseName(fileName).trim() || (video ? 'video' : 'image')
}

export type PasteNameResult = { ok: true; name: string } | { ok: false; error: string }

/**
 * Hype's savePastedMedia checks: strip a typed matching extension, reject empty
 * names, "." / "..", and path separators, angle brackets or control characters;
 * refuse names that already exist. `existing` is the deck's media file list.
 */
export function resolvePasteName(input: string, extension: string, existing: readonly string[]): PasteNameResult {
  let stem = input.trim()
  if (stem.toLowerCase().endsWith('.' + extension.toLowerCase())) stem = stem.slice(0, -(extension.length + 1))
  // oxlint-disable-next-line no-control-regex
  if (!stem || stem === '.' || stem === '..' || /[/\\<>\u0000-\u001f]/.test(stem))
    return { ok: false, error: 'Use a filename without folders or special characters.' }
  const name = `${stem}.${extension}`
  if (existing.includes(name)) return { ok: false, error: `${name} already exists. Choose another name.` }
  return { ok: true, name }
}
