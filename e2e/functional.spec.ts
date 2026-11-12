import { unzlibSync } from 'fflate'
import type { Page } from '@playwright/test'
import { deckSeed, fixture, menuItem, pasteImage, slides, typeInEditor } from './helpers.ts'
import { expect, fakeText, test } from './fixtures.ts'

/** Slide titles ("# First slide" -> "First") in the saved presentation.md. */
async function order(page: Page) {
  const md = (await fakeText(page, 'presentation.md')) ?? ''
  return [...md.matchAll(/^# (\w+) slide$/gm)].map((m) => m[1])
}

test('imports a folder into the browser working copy and survives reload', async ({ openOpfs }) => {
  const page = await openOpfs()
  const chooser = page.waitForEvent('filechooser')
  await menuItem(page, 'File menu', /Import folder/)
  await (await chooser).setFiles(fixture('deck'))

  await expect(slides(page)).toHaveCount(4)
  await expect(page.locator('.deck-title')).toContainText('E2E Deck')
  await expect(page.locator('.storage-label')).toHaveText(/Stored in this browser/)

  // Edit the selected (first) slide.
  await typeInEditor(page, 'Slide Markdown', '# Edited headline\n\nPersisted body')
  await expect(page.locator('.preview-box')).toContainText('Edited headline')
  await expect(page.locator('.storage-label')).toHaveText(/Stored in this browser/) // autosave done

  await page.reload()
  await expect(slides(page)).toHaveCount(4)
  await expect(page.locator('.deck-title')).toContainText('E2E Deck')
  await expect(page.locator('.preview-box')).toContainText('Edited headline')
  await expect(page.locator('.preview-box')).toContainText('Persisted body')
})

test('Markdown mode edits the whole deck', async ({ openOpfs }) => {
  const page = await openOpfs()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await typeInEditor(page, 'Presentation Markdown', '# One\n\n---\n\n# Two\n\n---\n\n# Three\n')
  await expect(slides(page)).toHaveCount(3)
})

test('saves a new deck through the directory picker', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs()
  await expect(page.locator('.storage-label')).toContainText('Ctrl+S chooses a folder')

  await typeInEditor(page, 'Slide Markdown', '# Saved by the e2e suite')
  await page.keyboard.press('Control+S')

  await expect(page.locator('.storage-label')).toHaveText('Saved to disk · e2e-folder')
  const md = await fakeText(page, 'presentation.md')
  expect(md).toContain('# Saved by the e2e suite')

  // Subsequent edits autosave into the same folder.
  await typeInEditor(page, 'Slide Markdown', '# Edited after save')
  await expect.poll(() => fakeText(page, 'presentation.md'), { timeout: 10_000 }).toContain('# Edited after save')
})

test('adds a pasted image as slide media', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs()
  await typeInEditor(page, 'Slide Markdown', '# Picture time')
  await page.keyboard.press('Control+S')
  await expect(page.locator('.storage-label')).toHaveText(/Saved to disk/)

  await pasteImage(page, fixture('sample.png'), 'sample.png')
  // Like Hype, paste asks what to call the file (default: its base name).
  const name = page.getByRole('textbox', { name: 'Filename' })
  await expect(name).toHaveValue('sample')
  await page.getByRole('button', { name: 'Save image' }).click()

  await expect(page.locator('.preview-box img')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeFs: { size(p: string): number | null } }).__fakeFs.size('images/sample.png'))).toBeGreaterThan(1000)
  await expect.poll(() => fakeText(page, 'presentation.md'), { timeout: 10_000 }).toContain('sample.png')
})

test('adds media to an unsaved deck and writes it on first save', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs()
  await typeInEditor(page, 'Slide Markdown', '# Draft')
  await pasteImage(page, fixture('sample.png'), 'sample.png')
  await page.getByRole('textbox', { name: 'Filename' }).press('Enter')

  await expect(page.locator('.preview-box img')).toBeVisible()
  expect(await fakeText(page, 'images/sample.png')).toBeNull()

  await page.keyboard.press('Control+S')
  await expect(page.locator('.storage-label')).toHaveText(/Saved to disk/)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeFs: { size(p: string): number | null } }).__fakeFs.size('images/sample.png'))).toBeGreaterThan(1000)
  await expect(page.locator('.preview-box img')).toBeVisible()
})

test('names a pasted image, rejects duplicates, and cancel leaves the deck untouched', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs()
  await typeInEditor(page, 'Slide Markdown', '# Naming')
  await page.keyboard.press('Control+S')
  await expect(page.locator('.storage-label')).toHaveText(/Saved to disk/)
  const fs = (p: string) => page.evaluate((x) => (window as unknown as { __fakeFs: { size(p: string): number | null } }).__fakeFs.size(x), p)
  const dialogName = page.getByRole('textbox', { name: 'Filename' })

  await pasteImage(page, fixture('sample.png'), 'sample.png')
  await dialogName.fill('My Picture')
  await page.keyboard.press('Enter')
  await expect.poll(() => fs('images/My Picture.png')).toBeGreaterThan(1000)

  // The same name again is refused inside the dialog.
  await pasteImage(page, fixture('sample.png'), 'sample.png')
  await dialogName.fill('My Picture.png')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText(/already exists/)
  await dialogName.fill('a/b')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText(/without folders/)

  // Cancel adds nothing.
  await page.keyboard.press('Escape')
  await expect(dialogName).toBeHidden()
  expect(await fs('images/a/b.png')).toBeNull()
  expect(await fs('images/sample.png')).toBeNull()
})

test('fits a huge pasted image to 4K and can cancel while compressing', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs()
  await typeInEditor(page, 'Slide Markdown', 'Plain text, so the image fits')
  await page.keyboard.press('Control+S')
  await expect(page.locator('.storage-label')).toHaveText(/Saved to disk/)
  const paste = () =>
    page.evaluate(async () => {
      const c = new OffscreenCanvas(5000, 2500)
      const ctx = c.getContext('2d')!
      const g = ctx.createLinearGradient(0, 0, 5000, 2500)
      g.addColorStop(0, '#f00')
      g.addColorStop(1, '#00f')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 5000, 2500)
      const dt = new DataTransfer()
      dt.items.add(new File([await c.convertToBlob({ type: 'image/png' })], 'huge.png', { type: 'image/png' }))
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
  const name = page.getByRole('textbox', { name: 'Filename' })

  await paste()
  await expect(name).toHaveValue('huge')
  await page.getByRole('button', { name: 'Save image' }).click()
  const img = page.locator('.preview-box img')
  await expect(img).toBeVisible()
  expect(await img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([3840, 1920])

  // Cancelling during compression leaves the deck as it was.
  await expect.poll(() => fakeText(page, 'presentation.md'), { timeout: 10_000 }).toContain('huge.webp')
  const before = await fakeText(page, 'presentation.md')
  await paste()
  await page.keyboard.press('Escape')
  await expect(name).toBeHidden()
  await expect(page.getByRole('progressbar')).toBeHidden()
  expect(await fakeText(page, 'presentation.md')).toBe(before)
})

test('opens a folder and reorders slides with the keyboard', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs({ seed: deckSeed() })
  await menuItem(page, 'File menu', /Open folder/)
  await expect(slides(page)).toHaveCount(4)
  await expect(page.locator('.storage-label')).toHaveText('Saved to disk · e2e-folder')

  expect(await order(page)).toEqual(['First', 'Second', 'Third', 'Photo'])

  // Move slide 1 down twice from the sidebar: Second, Third, First.
  await slides(page).first().click()
  await page.keyboard.press('Control+ArrowDown')
  await page.keyboard.press('Control+ArrowDown')
  await expect(page.locator('.deck-status')).toContainText('Slide 3 of 4')
  await page.keyboard.press('Control+S')
  await expect.poll(() => order(page)).toEqual(['Second', 'Third', 'First', 'Photo'])
})

test('reorders slides by dragging in the sidebar', async ({ openWithFakeFs }) => {
  const page = await openWithFakeFs({ seed: deckSeed() })
  await menuItem(page, 'File menu', /Open folder/)
  await expect(slides(page)).toHaveCount(4)

  const from = (await slides(page).nth(0).boundingBox())!
  const to = (await slides(page).nth(2).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 20, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, { steps: 10 })
  await page.mouse.up()

  await page.keyboard.press('Control+S')
  await expect.poll(async () => (await order(page))[0]).not.toBe('First')
  expect((await order(page)).sort()).toEqual(['First', 'Photo', 'Second', 'Third'])
})

test('duplicates and deletes slides from the sidebar', async ({ openOpfs }) => {
  const page = await openOpfs()
  await slides(page).first().click()
  await page.keyboard.press('Control+d')
  await expect(slides(page)).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(slides(page)).toHaveCount(1)
})

test('shows problems on the slide banner and the status line', async ({ openOpfs }) => {
  const page = await openOpfs()
  const problems = page.getByTestId('problems')
  await expect(problems).toBeHidden()

  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await typeInEditor(page, 'Presentation Markdown', '# One\n\n---\n\n![](gone.png)\n\n# Two\n\n---\n\n# Three\n')
  await expect(slides(page)).toHaveCount(3)
  await expect(problems).toContainText('1 problem')
  await expect(problems).toContainText('Slide 2: Missing media: gone.png')
  // The slide's own thumbnail carries Hype's banner.
  await expect(slides(page).nth(1).locator('.hs-problem')).toHaveText('Missing media: gone.png')
  await expect(slides(page).nth(0).locator('.hs-problem')).toHaveCount(0)
  await problems.click()
  await expect(slides(page).nth(1)).toHaveAttribute('aria-selected', 'true')

  // An unfinished code fence is reported for the whole presentation.
  await typeInEditor(page, 'Presentation Markdown', '# One\n\n---\n\n```ts\nconst a = 1\n')
  await expect(problems).toContainText('Unclosed code fence')

  // Text that must shrink below 24px is a warning, found by laying the slide out.
  const crowded = Array.from({ length: 70 }, (_, i) => `- point number ${i}`).join('\n')
  await typeInEditor(page, 'Presentation Markdown', `# One\n\n---\n\n${crowded}\n`)
  await expect(problems).toContainText('Slide 2: Text fits below 24px on a 1080p slide')
})

/** Wait until autosave has written the unsaved-draft file for the untitled deck (new deck, no folder yet). */
async function draftWritten(page: Page, containing: string) {
  await expect
    .poll(
      () => page.evaluate(async (needle) => {
        try {
          const root = await navigator.storage.getDirectory()
          const dir = await (await root.getDirectoryHandle('presentations')).getDirectoryHandle('drafts')
          const text = await (await (await dir.getFileHandle('untitled.json')).getFile()).text()
          return text.includes(needle)
        } catch {
          return false
        }
      }, containing),
      { timeout: 10_000 },
    )
    .toBe(true)
}

test.describe('crash recovery', () => {
  test('offers an unsaved draft after a reload, and recovers it (undoably)', async ({ openWithFakeFs }) => {
    const page = await openWithFakeFs()
    await typeInEditor(page, 'Slide Markdown', '# Crashed headline\n\nunsaved body')
    await draftWritten(page, 'Crashed headline')

    await page.reload() // stands in for a crash: the draft was never "saved"
    const prompt = page.getByRole('alertdialog', { name: 'Recover unsaved changes?' })
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('Untitled')
    await expect(page.locator('.preview-box')).not.toContainText('Crashed headline')

    await prompt.getByRole('button', { name: 'Recover' }).click()
    await expect(prompt).toBeHidden()
    await expect(page.locator('.preview-box')).toContainText('Crashed headline')
    await expect(page.locator('.preview-box')).toContainText('unsaved body')

    await page.keyboard.press('Control+Z')
    await expect(page.locator('.preview-box')).not.toContainText('Crashed headline')
  })

  test('discarding the draft clears it for good', async ({ openWithFakeFs }) => {
    const page = await openWithFakeFs()
    await typeInEditor(page, 'Slide Markdown', '# Throwaway text')
    await draftWritten(page, 'Throwaway text')

    await page.reload()
    const prompt = page.getByRole('alertdialog', { name: 'Recover unsaved changes?' })
    await prompt.getByRole('button', { name: 'Discard' }).click()
    await expect(prompt).toBeHidden()
    await expect(page.locator('.preview-box')).not.toContainText('Throwaway text')

    await page.reload()
    await expect(page.locator('.topbar')).toBeVisible()
    await expect(prompt).toBeHidden()
  })
})

test.describe('version history', () => {
  test('lists versions after edits and restores one, undoably', async ({ openWithFakeFs }) => {
    const page = await openWithFakeFs()
    await typeInEditor(page, 'Slide Markdown', '# Version A')
    await expect(page.locator('.preview-box')).toContainText('Version A')
    await draftWritten(page, 'Version A')
    await typeInEditor(page, 'Slide Markdown', '# Version B')
    await draftWritten(page, 'Version B')

    await menuItem(page, 'File menu', /Version history/)
    const dialog = page.getByRole('dialog', { name: 'Version history' })
    await expect(dialog).toBeVisible()
    const rows = dialog.getByRole('option')
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2)
    await expect(rows.first()).toContainText('Current')
    await expect(rows.first()).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)

    // Find the row whose preview holds "Version A".
    const preview = dialog.getByLabel('Preview of the selected version')
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click()
      await expect(preview).not.toHaveText('Loading…')
      if ((await preview.textContent())?.includes('Version A')) break
    }
    await expect(preview).toContainText('Version A')
    await dialog.getByRole('button', { name: 'Restore' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.preview-box')).toContainText('Version A')

    await page.keyboard.press('Control+Z')
    await expect(page.locator('.preview-box')).toContainText('Version B')
  })

  test('closes with Escape', async ({ openWithFakeFs }) => {
    const page = await openWithFakeFs()
    await menuItem(page, 'File menu', /Version history/)
    const dialog = page.getByRole('dialog', { name: 'Version history' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('saving twice into a folder writes a .hype-backups/*.bak', async ({ openWithFakeFs }) => {
    const page = await openWithFakeFs()
    await typeInEditor(page, 'Slide Markdown', '# First save')
    await page.keyboard.press('Control+S')
    await expect(page.locator('.storage-label')).toHaveText(/Saved to disk/)
    await typeInEditor(page, 'Slide Markdown', '# Second save')
    const list = () => page.evaluate(() => (window as unknown as { __fakeFs: { list(): string[] } }).__fakeFs.list())
    await expect
      .poll(async () => (await list()).filter((p) => /^\.hype-backups\/presentation\.md\..+\.bak$/.test(p)).length, { timeout: 10_000 })
      .toBeGreaterThan(0)
    const bak = (await list()).find((p) => p.endsWith('.bak'))!
    expect(await fakeText(page, bak)).toContain('# First save')
  })
})

test('Ctrl+P exports the deck as one vector PDF page per slide via the print dialog', async ({ openOpfs }) => {
  const page = await openOpfs()
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: string[] }
    w.__prints = []
    window.print = () => void w.__prints.push(document.title)
  })
  await page.reload()
  const chooser = page.waitForEvent('filechooser')
  await menuItem(page, 'File menu', /Import folder/)
  await (await chooser).setFiles(fixture('deck'))
  await expect(slides(page)).toHaveCount(4)

  await page.keyboard.press('Control+P')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: string[] }).__prints.length)).toBe(1)
  expect(await page.evaluate(() => (window as unknown as { __prints: string[] }).__prints)).toEqual(['E2E Deck'])
  await expect(page.locator('.hs-print-root .hs-print-page')).toHaveCount(4)

  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const raw = pdf.toString('latin1')
  expect(raw.match(/\/Type\s*\/Page(?!s)/g)).toHaveLength(4)
  expect(raw).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+960\s+540\s*\]/)

  // Text stays vector: slide text is in (Flate-compressed) content streams as glyph runs, not images.
  let streams = ''
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    try {
      streams += Buffer.from(unzlibSync(new Uint8Array(pdf.subarray(start, end).subarray(0, end - start)))).toString('latin1')
    } catch {
      /* not a Flate stream */
    }
  }
  expect(streams).toMatch(/\bTj\b|\bTJ\b/)

  // Cleanup happens on afterprint, and the title is restored.
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.hs-print-root')).toHaveCount(0)
  await expect(page).toHaveTitle(/HypeSlides/)
})
