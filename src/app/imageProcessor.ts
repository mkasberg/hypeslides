// Main-thread side of pasted-image compression: runs imageWorker, reports
// progress, supports cancel, and falls back to the untouched file when workers
// or OffscreenCanvas are unavailable or the image cannot be decoded.

import { copiedAsIs, fileExtension, isAnimatedImage, isVideoFile, keepOriginal } from '../core'
import type { ImageWorkerMessage } from '../workers/imageWorker'

export interface ProcessedMedia {
  blob: Blob
  /** Extension of the bytes in `blob`, lowercase. */
  ext: string
  video: boolean
  /** True when the file was recompressed. */
  compressed: boolean
}

export interface ProcessHandle {
  promise: Promise<ProcessedMedia>
  cancel(): void
}

export const canCompress = () =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined'

export function processPastedMedia(file: File, span: boolean, onProgress: (v: number) => void): ProcessHandle {
  const ext = fileExtension(file.name) || 'png'
  const untouched = (video: boolean): ProcessedMedia => ({ blob: file, ext, video, compressed: false })
  let worker: Worker | null = null
  let cancelled = false

  const promise = (async (): Promise<ProcessedMedia> => {
    if (copiedAsIs(file.name)) return untouched(isVideoFile(file.name))
    if (!canCompress()) return untouched(false)
    if (isAnimatedImage(new Uint8Array(await file.slice(0, fileExtension(file.name) === 'gif' ? file.size : 65536).arrayBuffer()), file.name)) return untouched(false)
    if (cancelled) return new Promise<ProcessedMedia>(() => {})
    return new Promise<ProcessedMedia>((resolve) => {
      try {
        worker = new Worker(new URL('../workers/imageWorker.ts', import.meta.url), { type: 'module' })
      } catch {
        resolve(untouched(false))
        return
      }
      worker.onmessage = (ev: MessageEvent<ImageWorkerMessage>) => {
        const m = ev.data
        if (m.type === 'progress') onProgress(m.value)
        else if (m.type === 'done') {
          worker?.terminate()
          if (keepOriginal(m.resized, m.blob.size, file.size)) resolve(untouched(false))
          else resolve({ blob: m.blob, ext: m.ext, video: false, compressed: true })
        } else {
          worker?.terminate()
          resolve(untouched(false)) // Could not decode here: add the file as-is.
        }
      }
      worker.onerror = () => {
        worker?.terminate()
        resolve(untouched(false))
      }
      worker.postMessage({ file, span })
    })
  })()

  return {
    promise,
    cancel() {
      cancelled = true
      worker?.terminate()
    },
  }
}
