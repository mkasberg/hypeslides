// Screenshot regression suite. Baselines must be produced inside the Playwright
// Docker image (npm run test:e2e:update), see tools/playwright-docker.sh.
import type { Page } from '@playwright/test'
import { deckSeed, menuItem, openMenu, slides } from './helpers.ts'
import { expect, test } from './fixtures.ts'

/** Open the fixture deck from the fake folder and select slide `n` (1-based). */
async function openDeck(open: (o: { seed: ReturnType<typeof deckSeed> }) => Promise<Page>, n = 2) {
  const page = await open({ seed: deckSeed() })
  await menuItem(page, 'File menu', /Open folder/)
  await expect(slides(page)).toHaveCount(4)
  await expect(page.locator('.storage-label')).toHaveText('Saved to disk · e2e-folder')
  await slides(page).nth(n - 1).click()
  await expect(page.locator('.deck-status')).toHaveText(`Slide ${n} of 4`)
  return page
}

/** Fonts loaded, images decoded, layout and highlighting settled, pointer parked. */
async function settle(page: Page) {
  await page.mouse.move(1430, 890)
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {})))
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  })
}

async function shot(page: Page, name: string) {
  await settle(page)
  await expect(page).toHaveScreenshot(name + '.png')
}

test.describe('screenshots (dark)', () => {
  test('visual mode', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await shot(page, 'visual')
  })

  test('visual mode with code and image slides', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 3)
    await expect(page.locator('.preview-box')).toContainText('answer')
    await shot(page, 'visual-code')
    await slides(page).nth(3).click()
    await expect(page.locator('.preview-box img')).toBeVisible()
    await shot(page, 'visual-image')
  })

  test('markdown mode', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Presentation Markdown' })).toContainText('Second slide')
    await shot(page, 'markdown')
  })

  test('overview', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await page.getByRole('button', { name: /^Overview/ }).click()
    await expect(page.locator('.slide-list.overview')).toBeVisible()
    await shot(page, 'overview')
  })

  test('present mode', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await page.keyboard.press('F5')
    await expect(page.locator('.present')).toBeVisible()
    await shot(page, 'present')
  })

  test('appearance menu', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 1)
    await openMenu(page, 'Appearance')
    await expect(page.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible()
    await shot(page, 'appearance-menu')
  })

  test('presentation theme menu', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 1)
    await openMenu(page, 'Presentation theme')
    await expect(page.getByRole('menuitemradio', { name: /Nord/ })).toBeVisible()
    await shot(page, 'theme-menu')
  })

  test('shortcuts dialog', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 1)
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await shot(page, 'shortcuts-dialog')
  })

  test('confirm dialog', async ({ openWithFakeFs }) => {
    // Saving a new deck into a folder that already holds a presentation asks first.
    const page = await openWithFakeFs({ seed: deckSeed() })
    await page.keyboard.press('Control+S')
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await shot(page, 'confirm-dialog')
  })

  test('drop overlay', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'photo.png', { type: 'image/png' }))
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    })
    await expect(page.locator('.drop-overlay')).toBeVisible()
    await shot(page, 'drop-overlay')
  })

  test('light presentation theme', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await openMenu(page, 'Presentation theme')
    await page.getByRole('menuitemradio', { name: /Catppuccin Latte/ }).click()
    await expect(page.getByTitle('Presentation theme', { exact: true })).toContainText('Catppuccin Latte')
    await expect(page.locator('.storage-label')).toHaveText('Saved to disk · e2e-folder') // autosave finished
    await shot(page, 'light-presentation-theme')
  })
})

test.describe('screenshots (light app theme)', () => {
  test.use({ colorScheme: 'light' })

  test('visual mode', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await shot(page, 'visual-light-app')
  })

  test('overview', async ({ openWithFakeFs }) => {
    const page = await openDeck(openWithFakeFs, 2)
    await page.getByRole('button', { name: /^Overview/ }).click()
    await expect(page.locator('.slide-list.overview')).toBeVisible()
    await shot(page, 'overview-light-app')
  })
})
