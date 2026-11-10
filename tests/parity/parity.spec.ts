// Hype parity suite: render every fixture deck slide through the harness page
// and score it against Hype's reference PNG (SSIM). See README "Parity tests".
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { ssim } from 'ssim.js'
import { EPSILON, REPORT_DIR, loadBaselines, type SlideResult } from './shared.ts'

const ROOT = join(import.meta.dirname)
const DECKS = join(ROOT, 'decks')
const REFERENCE = join(ROOT, 'reference')
const W = 1920
const H = 1080

const decks = readdirSync(REFERENCE)
  .filter((d) => statSync(join(REFERENCE, d)).isDirectory())
  .sort()

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

function grayscale(png: PNG): { data: Uint8ClampedArray; width: number; height: number } {
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }
}

function score(ours: PNG, hype: PNG): number {
  const { mssim } = ssim(grayscale(hype), grayscale(ours), { ssim: 'bezkrovny' })
  return mssim
}

async function renderSlide(page: Page, markdown: string, media: Record<string, string>, slide: number) {
  return page.evaluate((req) => window.hypeHarness.render(req), { markdown, media, slide })
}

declare global {
  interface Window {
    hypeHarness: { render(req: { markdown: string; media: Record<string, string>; slide: number }): Promise<{ slideCount: number }> }
  }
}

test.describe.configure({ mode: 'parallel' })

for (const deck of decks) {
  test(deck, async ({ page, baseURL }) => {
    const deckDir = join(DECKS, deck)
    const markdown = readFileSync(join(deckDir, 'presentation.md'), 'utf8')
    const refSlides: { image: string }[] = JSON.parse(readFileSync(join(REFERENCE, deck, 'slides.json'), 'utf8')).slides

    // Serve the deck's media files from disk; the harness gets plain URLs.
    const media: Record<string, string> = {}
    for (const file of walk(deckDir)) {
      const rel = relative(deckDir, file).split(sep).join('/')
      if (rel === 'presentation.md') continue
      media[rel] = `${baseURL}/__deck/${encodeURIComponent(deck)}/${rel.split('/').map(encodeURIComponent).join('/')}`
    }
    await page.route(`**/__deck/${encodeURIComponent(deck)}/**`, async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(`/__deck/${encodeURIComponent(deck)}/`, ''))
      await route.fulfill({ path: join(deckDir, path) })
    })
    await page.goto('/harness.html')
    await page.waitForFunction(() => !!window.hypeHarness)

    const baselines = loadBaselines()
    const outDir = join(REPORT_DIR, 'img', deck)
    const resultsDir = join(REPORT_DIR, 'results')
    mkdirSync(outDir, { recursive: true })
    mkdirSync(resultsDir, { recursive: true })

    const results: SlideResult[] = []
    let ourCount = -1
    for (let i = 1; i <= refSlides.length; i++) {
      const name = `slide-${String(i).padStart(3, '0')}`
      const key = `${deck}/${name}`
      if (ourCount >= 0 && i > ourCount) {
        results.push({ deck, slide: i, key, score: 0, baseline: baselines[key] ?? null, status: 'missing' })
        continue
      }
      const { slideCount } = await renderSlide(page, markdown, media, i).catch((e: Error) => {
        throw new Error(`${key}: harness render failed: ${e.message}`)
      })
      ourCount = slideCount
      const shot = await page.locator('#stage').screenshot({ animations: 'disabled' })
      const ours = PNG.sync.read(shot)
      const hypePath = join(REFERENCE, deck, refSlides[i - 1].image)
      const hype = PNG.sync.read(readFileSync(hypePath))
      if (ours.width !== W || ours.height !== H || hype.width !== W || hype.height !== H) {
        throw new Error(`${key}: expected ${W}x${H}, got ours ${ours.width}x${ours.height}, hype ${hype.width}x${hype.height}`)
      }
      const s = Math.round(score(ours, hype) * 1000) / 1000
      const diff = new PNG({ width: W, height: H })
      pixelmatch(hype.data, ours.data, diff.data, W, H, { threshold: 0.1 })
      writeFileSync(join(outDir, `${name}-ours.png`), shot)
      writeFileSync(join(outDir, `${name}-diff.png`), PNG.sync.write(diff))
      copyFileSync(hypePath, join(outDir, `${name}-hype.png`))
      const baseline = baselines[key]
      const status = baseline === undefined ? 'no-baseline' : s < baseline - EPSILON ? 'regressed' : 'pass'
      results.push({ deck, slide: i, key, score: s, baseline: baseline ?? null, status })
    }
    writeFileSync(join(resultsDir, `${deck}.json`), JSON.stringify({ deck, ourCount, hypeCount: refSlides.length, results }, null, 1))

    const update = !!process.env.PARITY_UPDATE
    expect.soft(ourCount, `${deck}: slide count (ours vs Hype's slides.json)`).toBe(refSlides.length)
    if (!update) {
      for (const r of results) {
        expect.soft(r.status, `${r.key}: score ${r.score} vs baseline ${r.baseline} (epsilon ${EPSILON})`).toBe('pass')
      }
    }
  })
}
