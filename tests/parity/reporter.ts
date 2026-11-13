// Playwright reporter for the parity project: merges per-deck results into
// parity-report/index.html and, with PARITY_UPDATE, rewrites scores.json (slide
// SSIM, parity.spec.ts) and pdf-scores.json (PDF text, pdf.spec.ts).
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FullResult, Reporter, TestCase } from '@playwright/test/reporter'
import {
  EPSILON, PDF_SCORES_FILE, REPORT_DIR, SCORES_FILE, loadBaselines, loadPdfBaselines,
  type PdfDeckResult, type SlideResult,
} from './shared.ts'

interface DeckFile { deck: string; ourCount: number; hypeCount: number; results: SlideResult[] }
interface Scored { key: string; deck: string; score: number; baseline: number | null; status: SlideResult['status'] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function readResults<T>(sub: string): T[] {
  const dir = join(REPORT_DIR, sub)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

/**
 * With PARITY_UPDATE, raise (or with `reset`, replace) the baselines of the given decks in `file`
 * and point each result at its new baseline. Decks in `skip` keep theirs: never baseline a deck
 * whose slide or page split differs from Hype's.
 */
function updateBaselines(file: string, old: Record<string, number>, decks: string[], results: Scored[], mode: string) {
  const next = { ...old }
  for (const deck of decks) {
    for (const k of Object.keys(next)) if (k.startsWith(deck + '/')) delete next[k]
    for (const r of results.filter((r) => r.deck === deck)) {
      next[r.key] = mode === 'reset' || old[r.key] === undefined ? r.score : Math.max(old[r.key], r.score)
    }
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n')
  for (const r of results) r.baseline = sorted[r.key] ?? null
  const changed = Object.keys(sorted).filter((k) => sorted[k] !== old[k]).length
  console.log(`parity: wrote ${file} (${changed} changed, mode ${mode})`)
}

/** Status against the (possibly just updated) baseline. */
function restatus<T extends Scored>(r: T, mode: string | undefined): T {
  let status = r.status
  if (mode && status !== 'missing') status = 'pass'
  else if (r.baseline !== null && status !== 'missing') status = r.score < r.baseline - EPSILON ? 'regressed' : 'pass'
  return { ...r, status }
}

export default class ParityReporter implements Reporter {
  private ran = false

  onBegin() {
    // Stale results from an earlier run must not leak into this report.
    rmSync(join(REPORT_DIR, 'results'), { recursive: true, force: true })
    rmSync(join(REPORT_DIR, 'results-pdf'), { recursive: true, force: true })
  }

  onTestEnd(test: TestCase) {
    if (test.parent.project()?.name === 'parity') this.ran = true
  }

  onEnd(_result: FullResult) {
    if (!this.ran) return
    const decks = readResults<DeckFile>('results')
    const pdfs = readResults<PdfDeckResult>('results-pdf')
    if (!decks.length && !pdfs.length) return
    const mode = process.env.PARITY_UPDATE

    const slides = decks.flatMap((d) => d.results)
    const pages = pdfs.flatMap((d) => d.results)
    if (mode && decks.length) {
      updateBaselines(SCORES_FILE, loadBaselines(), decks.filter((d) => d.ourCount === d.hypeCount).map((d) => d.deck), slides, mode)
    }
    if (mode && pdfs.length) {
      updateBaselines(PDF_SCORES_FILE, loadPdfBaselines(), pdfs.filter((d) => d.ourPages === d.hypePages).map((d) => d.deck), pages, mode)
    }

    const sections = [
      decks.length ? slideSection(decks, slides.map((r) => restatus(r, mode))) : '',
      pdfs.length ? pdfSection(pdfs, pages.map((r) => restatus(r, mode))) : '',
    ]
    writeFileSync(join(REPORT_DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Hype parity report</title>
<style>
body{font:14px system-ui;margin:20px;background:#1b1b1b;color:#ddd}a{color:#8ab4f8}table{border-collapse:collapse}td,th{padding:4px 12px;border:1px solid #444;text-align:left;vertical-align:top}
tr.fail td{background:#4a1f1f}section{margin:18px 0;padding:8px;border:1px solid #444}section.fail{border-color:#c44}h3{margin:0 0 8px;font-size:15px}h3 span{font-weight:normal;color:#999}
.row{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0}figcaption{color:#999}img{max-width:100%;height:auto;background:#000}
td.text{font:12px ui-monospace,monospace;max-width:520px;white-space:pre-wrap;word-break:break-word}
</style><h1>Hype parity report</h1>
${sections.join('\n')}`)
    console.log(`parity: report at ${join(REPORT_DIR, 'index.html')}`)
  }
}

function slideSection(decks: DeckFile[], all: SlideResult[]): string {
  const mismatched = decks.filter((d) => d.ourCount !== d.hypeCount)
  all.sort((a, b) => a.score - b.score)
  const summary = decks.map((d) => {
    const rs = all.filter((r) => r.deck === d.deck)
    const avg = rs.reduce((n, r) => n + r.score, 0) / (rs.length || 1)
    const bad = rs.filter((r) => r.status !== 'pass').length
    return `<tr class="${bad || d.ourCount !== d.hypeCount ? 'fail' : ''}"><td>${esc(d.deck)}</td><td>${rs.length}</td>` +
      `<td>${d.ourCount}${d.ourCount !== d.hypeCount ? ` (Hype ${d.hypeCount})` : ''}</td>` +
      `<td>${avg.toFixed(3)}</td><td>${Math.min(...rs.map((r) => r.score)).toFixed(3)}</td><td>${bad}</td></tr>`
  }).join('')
  const cards = all.map((r) => {
    const n = String(r.slide).padStart(3, '0')
    const base = `img/${r.deck}/slide-${n}`
    const fig = (kind: string, label: string) =>
      `<figure><a href="${base}-${kind}.png"><img loading="lazy" src="${base}-${kind}.png" width="640"></a><figcaption>${label}</figcaption></figure>`
    return `<section class="${r.status === 'pass' ? 'pass' : 'fail'}"><h3>${esc(r.key)} <span>score ${r.score.toFixed(3)} · baseline ` +
      `${r.baseline === null ? 'none' : r.baseline.toFixed(3)} · ${r.status}</span></h3><div class="row">` +
      (r.status === 'missing' ? '<p>Our renderer produced no such slide.</p>' : fig('hype', 'Hype') + fig('ours', 'Ours') + fig('diff', 'Diff')) +
      `</div></section>`
  }).join('')
  return `<h2>Slides</h2>
<p>${all.length} slides, worst first.${mismatched.length ? ` <b>Slide-count mismatches: ${mismatched.map((d) => d.deck).join(', ')}.</b>` : ''}</p>
<table><tr><th>Deck</th><th>Slides</th><th>Our count</th><th>Mean score</th><th>Min score</th><th>Failing</th></tr>${summary}</table>
${cards}`
}

function pdfSection(pdfs: PdfDeckResult[], all: PdfDeckResult['results']): string {
  pdfs.sort((a, b) => a.deck.localeCompare(b.deck))
  const summary = pdfs.map((d) => {
    const rs = all.filter((r) => r.deck === d.deck)
    const structural = rs.filter((r) => r.status !== 'missing' && (r.ourSize !== r.hypeSize || r.ourImages !== r.hypeImages)).length
    const bad = rs.filter((r) => r.status !== 'pass').length
    const fail = bad || structural || d.ourPages !== d.hypePages || d.ourTitle !== d.hypeTitle
    const avg = rs.reduce((n, r) => n + r.score, 0) / (rs.length || 1)
    return `<tr class="${fail ? 'fail' : ''}"><td>${esc(d.deck)}</td>` +
      `<td><a href="pdf/${esc(d.deck)}-hype.pdf">Hype</a> · <a href="pdf/${esc(d.deck)}-ours.pdf">ours</a></td>` +
      `<td>${d.ourPages}${d.ourPages !== d.hypePages ? ` (Hype ${d.hypePages})` : ''}</td>` +
      `<td>${esc(d.ourTitle)}${d.ourTitle !== d.hypeTitle ? ` (Hype ${esc(d.hypeTitle)})` : ''}</td>` +
      `<td>${avg.toFixed(3)}</td><td>${structural}</td><td>${bad}</td></tr>`
  }).join('')
  const worst = all
    .filter((r) => r.status !== 'pass' || r.score < 1 || r.ourImages !== r.hypeImages || r.ourSize !== r.hypeSize)
    .sort((a, b) => a.score - b.score)
  const rows = worst.map((r) => {
    const fail = r.status !== 'pass' || r.ourImages !== r.hypeImages || r.ourSize !== r.hypeSize
    return `<tr class="${fail ? 'fail' : ''}"><td>${esc(r.key)}</td><td>${r.score.toFixed(3)}</td>` +
      `<td>${r.baseline === null ? 'none' : r.baseline.toFixed(3)}</td><td>${r.status}</td>` +
      `<td>${r.ourImages}${r.ourImages !== r.hypeImages ? ` (Hype ${r.hypeImages})` : ''}</td>` +
      `<td class="text">${esc(r.hypeText)}</td><td class="text">${esc(r.ourText)}</td></tr>`
  }).join('')
  return `<h2>PDF export</h2>
<p>Our PDF (&lt;PrintDeck&gt; printed by Chromium) against <code>hype export</code>. Page count, page size, title and
per-page raster image count must match; text (word overlap, order ignored) is baselined.</p>
<table><tr><th>Deck</th><th>PDFs</th><th>Pages</th><th>Title</th><th>Mean text score</th><th>Size/image mismatches</th><th>Failing text</th></tr>${summary}</table>
<h3>Pages with text differences, worst first (${worst.length} of ${all.length})</h3>
<table><tr><th>Page</th><th>Score</th><th>Baseline</th><th>Status</th><th>Images</th><th>Hype text</th><th>Our text</th></tr>${rows}</table>`
}
