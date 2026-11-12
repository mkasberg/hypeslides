import { parseMedia } from '../core'
import type { ParsedDeck } from '../core'
import type { MediaUrlCache } from '../storage'

/**
 * The deck's media/poster names that the store can resolve, as a `mediaExists`
 * predicate for core's `findProblems` (shared by the status-line check and PDF export).
 */
export async function mediaExistsFor(parsed: ParsedDeck, media: MediaUrlCache | null): Promise<(name: string) => boolean> {
  const files = new Set<string>()
  for (const slide of parsed.slides) {
    const m = parseMedia(slide.source)
    if (m?.file) files.add(m.file)
    if (m?.poster) files.add(m.poster)
  }
  const present = new Set<string>()
  await Promise.all(
    [...files].map(async (name) => {
      if (media && (await media.resolve(name).catch(() => null))) present.add(name)
    }),
  )
  return (name) => present.has(name)
}

