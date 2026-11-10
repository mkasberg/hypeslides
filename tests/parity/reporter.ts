// Playwright reporter for the parity project: merges per-deck results into
// parity-report/index.html and, with PARITY_UPDATE, rewrites scores.json.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FullResult, Reporter, TestCase } from '@playwright/test/reporter'
import { EPSILON, REPORT_DIR, SCORES_FILE, loadBaselines, type SlideResult } from './shared.ts'

interface DeckFile { deck: string; ourCount: number; hypeCount: number; results: SlideResult[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default class ParityReporter implements Reporter {
  private ran = new Set<string>()

  onBegin() {
    // Stale results from an earlier run must not leak into this report.
    rmSync(join(REPORT_DIR, 'results'), { recursive: true, force: true })
  }

  onTestEnd(test: TestCase) {
    if (test.parent.project()?.name === 'parity') this.ran.add(test.title)
  }

  onEnd(_result: FullResult) {
    const dir = join(REPORT_DIR, 'results')
    if (!this.ran.size || !existsSync(dir)) return
    const decks: DeckFile[] = readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    const baselines = loadBaselines()
    const mode = process.env.PARITY_UPDATE
    const mismatched = decks.filter((d) => d.ourCount !== d.hypeCount)

    if (mode) {
      const next = { ...baselines }
      for (const d of decks) {
        if (d.ourCount !== d.hypeCount) continue // never baseline a deck whose slide split differs
        for (const k of Object.keys(next)) if (k.startsWith(d.deck + '/')) delete next[k]
        for (const r of d.results) {
          const old = baselines[r.key]
          next[r.key] = mode === 'reset' || old === undefined ? r.score : Math.max(old, r.score)
        }
      }
      const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
      writeFileSync(SCORES_FILE, JSON.stringify(sorted, null, 2) + '\n')
      for (const d of decks) for (const r of d.results) r.baseline = sorted[r.key] ?? null
      const changed = Object.keys(sorted).filter((k) => sorted[k] !== baselines[k]).length
      console.log(`parity: wrote ${SCORES_FILE} (${changed} changed, mode ${mode})`)
    }
    const all = decks.flatMap((d) => d.results).map((r) => {
      let status = r.status
      if (mode && status !== 'missing') status = 'pass'
      else if (r.baseline !== null && status !== 'missing') status = r.score < r.baseline - EPSILON ? 'regressed' : 'pass'
      return { ...r, status }
    })
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
    writeFileSync(join(REPORT_DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Hype parity report</title>
<style>
body{font:14px system-ui;margin:20px;background:#1b1b1b;color:#ddd}table{border-collapse:collapse}td,th{padding:4px 12px;border:1px solid #444;text-align:left}
tr.fail td{background:#4a1f1f}section{margin:18px 0;padding:8px;border:1px solid #444}section.fail{border-color:#c44}h3{margin:0 0 8px;font-size:15px}h3 span{font-weight:normal;color:#999}
.row{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0}figcaption{color:#999}img{max-width:100%;height:auto;background:#000}
</style><h1>Hype parity report</h1>
<p>${all.length} slides, worst first.${mismatched.length ? ` <b>Slide-count mismatches: ${mismatched.map((d) => d.deck).join(', ')}.</b>` : ''}</p>
<table><tr><th>Deck</th><th>Slides</th><th>Our count</th><th>Mean score</th><th>Min score</th><th>Failing</th></tr>${summary}</table>
${cards}`)
    console.log(`parity: report at ${join(REPORT_DIR, 'index.html')}`)
  }
}
