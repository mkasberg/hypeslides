// PDF parity: print each fixture deck through the app's PDF export path
// (<PrintDeck> + Chromium's print pipeline, which window.print() also uses) and
// compare the result with Hype's own `hype export` PDF. See README "Parity tests".
//
// Exact: page count, page size, document title. Per page: raster image count
// (embedded media; vector text and SVG drawings paint none) must match, and
// text similarity is baselined in pdf-scores.json like the slide SSIM scores.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { EPSILON, REPORT_DIR, loadPdfBaselines, type PdfDeckResult, type PdfPageResult } from './shared.ts'
import { REFERENCE, openDeck, referenceDecks } from './deck.ts'
import { readPdf, textSimilarity } from './pdf.ts'

const decks = referenceDecks().filter((d) => existsSync(join(REFERENCE, d, 'presentation.pdf')))

test.describe.configure({ mode: 'parallel' })

for (const deck of decks) {
  test(`pdf: ${deck}`, async ({ page, baseURL }) => {
    const hypePath = join(REFERENCE, deck, 'presentation.pdf')
    const { markdown, media } = await openDeck(page, baseURL, deck)
    await page.evaluate((req) => window.hypeHarness.renderPdf(req), { markdown, media })
    const ours = await page.pdf({ preferCSSPageSize: true, printBackground: true })

    const outDir = join(REPORT_DIR, 'pdf')
    const resultsDir = join(REPORT_DIR, 'results-pdf')
    mkdirSync(outDir, { recursive: true })
    mkdirSync(resultsDir, { recursive: true })
    writeFileSync(join(outDir, `${deck}-ours.pdf`), ours)
    copyFileSync(hypePath, join(outDir, `${deck}-hype.pdf`))

    const hype = await readPdf(new Uint8Array(readFileSync(hypePath)))
    const mine = await readPdf(new Uint8Array(ours))
    const baselines = loadPdfBaselines()
    const results: PdfPageResult[] = hype.pages.map((h, i) => {
      const o = mine.pages[i]
      const key = `${deck}/page-${String(i + 1).padStart(3, '0')}`
      const baseline = baselines[key] ?? null
      const score = o ? Math.round(textSimilarity(h.text, o.text) * 1000) / 1000 : 0
      const status = !o ? 'missing' : baseline === null ? 'no-baseline' : score < baseline - EPSILON ? 'regressed' : 'pass'
      return {
        deck, page: i + 1, key, score, baseline, status,
        hypeText: h.text, ourText: o?.text ?? '',
        hypeImages: h.images, ourImages: o?.images ?? 0,
        hypeSize: `${h.width}x${h.height}`, ourSize: o ? `${o.width}x${o.height}` : '',
      }
    })
    const file: PdfDeckResult = {
      deck, hypeTitle: hype.title, ourTitle: mine.title,
      hypePages: hype.pages.length, ourPages: mine.pages.length, results,
    }
    writeFileSync(join(resultsDir, `${deck}.json`), JSON.stringify(file, null, 1))

    expect.soft(mine.pages.length, `${deck}: PDF page count (ours vs Hype's)`).toBe(hype.pages.length)
    expect.soft(mine.title, `${deck}: PDF title`).toBe(hype.title)
    for (const r of results) {
      if (r.status === 'missing') continue
      expect.soft(r.ourSize, `${r.key}: page size in points`).toBe(r.hypeSize)
      expect.soft(r.ourImages, `${r.key}: raster images (embedded media)`).toBe(r.hypeImages)
      if (!process.env.PARITY_UPDATE) {
        expect.soft(r.status, `${r.key}: text score ${r.score} vs baseline ${r.baseline} (epsilon ${EPSILON})`).toBe('pass')
      }
    }
  })
}
