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
