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

  await expect(page.locator('.preview-box img')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeFs: { size(p: string): number | null } }).__fakeFs.size('images/sample.png'))).toBeGreaterThan(1000)
  await expect.poll(() => fakeText(page, 'presentation.md'), { timeout: 10_000 }).toContain('sample.png')
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
