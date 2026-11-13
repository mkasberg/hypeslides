import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const EPSILON = 0.005
export const REPORT_DIR = join(import.meta.dirname, '..', '..', 'parity-report')
export const SCORES_FILE = join(import.meta.dirname, 'scores.json')

export interface SlideResult {
  deck: string
  slide: number
  key: string
  score: number
  baseline: number | null
  status: 'pass' | 'regressed' | 'no-baseline' | 'missing'
}

export function loadBaselines(): Record<string, number> {
  return existsSync(SCORES_FILE) ? JSON.parse(readFileSync(SCORES_FILE, 'utf8')) : {}
}

export const PDF_SCORES_FILE = join(import.meta.dirname, 'pdf-scores.json')

export interface PdfPageResult {
  deck: string
  page: number
  /** `<deck>/page-NNN`, the pdf-scores.json key. */
  key: string
  /** Text similarity (pdf.ts `textSimilarity`), baselined like slide scores. */
  score: number
  baseline: number | null
  hypeText: string
  ourText: string
  hypeImages: number
  ourImages: number
  /** Page size in points, `WxH`. */
  hypeSize: string
  ourSize: string
  status: 'pass' | 'regressed' | 'no-baseline' | 'missing'
}

export interface PdfDeckResult {
  deck: string
  hypeTitle: string
  ourTitle: string
  hypePages: number
  ourPages: number
  results: PdfPageResult[]
}

export function loadPdfBaselines(): Record<string, number> {
  return existsSync(PDF_SCORES_FILE) ? JSON.parse(readFileSync(PDF_SCORES_FILE, 'utf8')) : {}
}
