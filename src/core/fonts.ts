// Font family helpers. Pure: no DOM. The browser layer feeds in the families
// reported by the Local Font Access API (see src/app/localFonts.ts).

/** Fonts offered in the picker without any permission (bundled or generic). */
export const BUNDLED_FONTS = [
  'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Menlo', 'Consolas', 'Courier New',
  'Inter', 'system-ui', 'Helvetica', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino',
]

/**
 * Unique, sorted family names from Local Font Access results (one entry per
 * face there), excluding families already in `exclude` (case-insensitive).
 */
export function installedFamilies(fonts: readonly { family?: string }[], exclude: readonly string[] = BUNDLED_FONTS): string[] {
  const skip = new Set(exclude.map((f) => f.toLowerCase()))
  const seen = new Map<string, string>()
  for (const f of fonts) {
    const name = (f.family ?? '').trim()
    const key = name.toLowerCase()
    if (name && !skip.has(key) && !seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/**
 * Top-level picker list. A deck font that is neither bundled nor installed is
 * still listed (checked) so the current choice stays visible; rendering falls
 * back to the default stack, as Hype does for a missing family.
 */
export function pickerFonts(current: string, installed: readonly string[] = []): string[] {
  const known = new Set([...BUNDLED_FONTS, ...installed].map((f) => f.toLowerCase()))
  return current && !known.has(current.toLowerCase()) ? [current, ...BUNDLED_FONTS] : [...BUNDLED_FONTS]
}
