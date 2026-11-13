// Shared by the parity specs: hand a fixture deck to the harness page.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Page } from '@playwright/test'

export const DECKS = join(import.meta.dirname, 'decks')
export const REFERENCE = join(import.meta.dirname, 'reference')

/** Fixture decks that have a Hype reference rendering. */
export function referenceDecks(): string[] {
  return readdirSync(REFERENCE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

/**
 * Serves the deck's media files from disk under `/__deck/<deck>/`, opens the
 * harness page, and returns the deck's Markdown plus the media map (path
 * relative to the deck folder -> URL) the harness takes.
 */
export async function openDeck(page: Page, baseURL: string | undefined, deck: string) {
  const deckDir = join(DECKS, deck)
  const markdown = readFileSync(join(deckDir, 'presentation.md'), 'utf8')
  const prefix = `/__deck/${encodeURIComponent(deck)}/`
  const media: Record<string, string> = {}
  for (const file of walk(deckDir)) {
    const rel = relative(deckDir, file).split(sep).join('/')
    if (rel === 'presentation.md') continue
    media[rel] = `${baseURL}${prefix}${rel.split('/').map(encodeURIComponent).join('/')}`
  }
  await page.route(`**${prefix}**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(prefix, ''))
    await route.fulfill({ path: join(deckDir, path) })
  })
  await page.goto('/harness.html')
  await page.waitForFunction(() => !!window.hypeHarness)
  return { markdown, media }
}

declare global {
  interface Window {
    hypeHarness: {
      render(req: { markdown: string; media: Record<string, string>; slide: number }): Promise<{ slideCount: number }>
      renderPdf(req: { markdown: string; media: Record<string, string> }): Promise<{ slideCount: number }>
    }
  }
}
