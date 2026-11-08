import type { PresentationStore } from './types.ts'

export interface MediaUrlCache {
  /** Object URL for a media filename, or null if missing. Cached per filename. */
  resolve(filename: string): Promise<string | null>
  /** Drop one entry (e.g. after the file was replaced). */
  invalidate(filename: string): void
  /** Revoke all URLs; call when switching presentations. */
  revokeAll(): void
}

export function createMediaUrlCache(store: PresentationStore): MediaUrlCache {
  const urls = new Map<string, Promise<string | null>>()
  let generation = 0
  return {
    resolve(filename) {
      let p = urls.get(filename)
      if (!p) {
        const gen = generation
        p = store.readMedia(filename).then((f) => {
          if (!f) {
            if (urls.get(filename) === p) urls.delete(filename) // allow retry once it exists
            return null
          }
          const url = URL.createObjectURL(f)
          if (gen !== generation) { // revoked while loading
            URL.revokeObjectURL(url)
            return null
          }
          return url
        })
        urls.set(filename, p)
      }
      return p
    },
    invalidate(filename) {
      const p = urls.get(filename)
      urls.delete(filename)
      p?.then((u) => u && URL.revokeObjectURL(u))
    },
    revokeAll() {
      generation++
      for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u))
      urls.clear()
    },
  }
}
