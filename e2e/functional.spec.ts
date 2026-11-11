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
