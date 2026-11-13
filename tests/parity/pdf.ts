// Reads a PDF the same way for Hype's export and ours (pdfjs-dist, so it runs in
// the Playwright container without poppler): page count and size, the document
// title, each page's text, and how many raster images each page paints.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PdfPage {
  /** Page size in PDF points (1/72 in). */
  width: number
  height: number
  /** The page's text items in content order, joined with spaces and whitespace collapsed. */
  text: string
  /** Raster images painted on the page (vector text and SVG drawings don't count). */
  images: number
}

export interface PdfSummary {
  title: string
  pages: PdfPage[]
}

const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat])

export async function readPdf(data: Uint8Array): Promise<PdfSummary> {
  // pdfjs takes ownership of (detaches) the buffer it is given.
  const task = getDocument({ data: data.slice(), useSystemFonts: false, verbosity: 0 })
  try {
    const doc = await task.promise
    const meta = await doc.getMetadata()
    const info = meta.info as { Title?: string }
    const pages: PdfPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const [x0, y0, x1, y1] = page.view
      const content = await page.getTextContent()
      const text = content.items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      const ops = await page.getOperatorList()
      const images = ops.fnArray.filter((op) => IMAGE_OPS.has(op)).length
      pages.push({ width: Math.round(x1 - x0), height: Math.round(y1 - y0), text, images })
      page.cleanup()
    }
    return { title: info.Title ?? '', pages }
  } finally {
    await task.destroy()
  }
}

/**
 * Text similarity in [0, 1]: the Dice coefficient of the two pages' words as
 * multisets, 2·|A ∩ B| / (|A| + |B|). Order is ignored on purpose: the PDF
 * writers emit text in paint order (Hype paints the heading first, Chromium
 * follows the DOM), which says nothing about what is on the page.
 */
export function textSimilarity(a: string, b: string): number {
  const words = (s: string) => s.split(/\s+/).filter(Boolean)
  const x = words(a)
  const y = words(b)
  if (!x.length && !y.length) return 1
  const counts = new Map<string, number>()
  for (const w of x) counts.set(w, (counts.get(w) ?? 0) + 1)
  let common = 0
  for (const w of y) {
    const n = counts.get(w) ?? 0
    if (n > 0) {
      common++
      counts.set(w, n - 1)
    }
  }
  return (2 * common) / (x.length + y.length)
}
