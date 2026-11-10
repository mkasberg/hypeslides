import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

export const fixture = (...p: string[]) => fileURLToPath(new URL(['./fixtures', ...p].join('/') + '', import.meta.url))

/** The fixture deck, as seed files for the fake folder. */
export function deckSeed(): Record<string, string | { base64: string }> {
  return {
    'presentation.md': readFileSync(fixture('deck', 'presentation.md'), 'utf8'),
    'photo.png': { base64: readFileSync(fixture('deck', 'photo.png')).toString('base64') },
  }
}

export async function openMenu(page: Page, title: 'File menu' | 'Appearance' | 'Font' | 'Presentation theme') {
  await page.getByTitle(title, { exact: true }).click()
}

export async function menuItem(page: Page, title: 'File menu', name: string | RegExp) {
  await openMenu(page, title)
  await page.getByRole('menuitem', { name }).click()
}

export const slides = (page: Page) => page.getByRole('listbox', { name: 'Slides' }).getByRole('option')

/** Replace the whole text of the focused-or-given CodeMirror editor. */
export async function typeInEditor(page: Page, label: 'Slide Markdown' | 'Presentation Markdown', text: string) {
  const ed = page.getByRole('textbox', { name: label })
  await ed.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(text)
}

/** Simulate pasting an image from the clipboard. */
export async function pasteImage(page: Page, file: string, name: string) {
  const base64 = readFileSync(file).toString('base64')
  await page.evaluate(
    ([b64, n]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], n, { type: 'image/png' }))
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [base64, name],
  )
}
