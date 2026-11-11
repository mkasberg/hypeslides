import { describe, expect, it } from 'vitest'
import { halfLeadingEm, tableColumnWidths } from './layout'

describe('tableColumnWidths', () => {
  it('keeps content widths when they fit', () => {
    expect(tableColumnWidths([50, 50], [100, 200], 400)).toEqual([100, 200])
  })
  it('wraps only the wide column, as Qt does', () => {
    // Narrow columns keep their max-content width; the wide one takes what is left.
    expect(tableColumnWidths([100, 300, 100], [260, 990, 280], 1000)).toEqual([260, 460, 280])
  })
  it('splits equally between several wide columns', () => {
    expect(tableColumnWidths([50, 50, 50], [500, 500, 100], 700)).toEqual([300, 300, 100])
  })
  it('never goes below min-content', () => {
    expect(tableColumnWidths([400, 50], [900, 100], 300)).toEqual([400, 100])
  })
})

describe('halfLeadingEm', () => {
  it('is half the extra leading of a proportional line height', () => {
    expect(halfLeadingEm('JetBrains Mono', 1.15)).toBe('0.099em')
  })
})
