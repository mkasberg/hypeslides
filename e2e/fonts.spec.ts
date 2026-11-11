import { openMenu, slides } from './helpers.ts'
import { expect, test } from './fixtures.ts'

type W = Record<string, unknown>

test('installed fonts: loads via Local Font Access and selecting one sets the deck font', async ({ app }) => {
  await app.addInitScript(() => {
    const faces = ['Zapfino', 'Alegreya Sans', 'Alegreya Sans', 'Arial'].map((family) => ({ family }))
    ;(window as unknown as W).queryLocalFonts = async () => faces
  })
  await app.goto('/')
  await expect(slides(app).first()).toBeVisible()

  await openMenu(app, 'Font')
  await app.getByRole('menuitem', { name: /Show installed fonts/ }).click()

  await openMenu(app, 'Font')
  await app.getByRole('menuitem', { name: /Installed fonts \(2\)/ }).hover()
  const item = app.getByRole('menuitem', { name: 'Alegreya Sans' })
  await expect(item).toHaveCount(1)
  await expect(app.getByRole('menuitem', { name: 'Zapfino' })).toHaveCount(1)
  await item.click()

  await expect(app.locator('.font-name')).toHaveText('Alegreya Sans')
  await app.getByRole('button', { name: 'Markdown', exact: true }).click()
  await expect(app.getByRole('textbox', { name: 'Presentation Markdown' })).toContainText('Alegreya Sans')
})

test('installed fonts: a denied permission is handled gracefully', async ({ app }) => {
  await app.addInitScript(() => {
    ;(window as unknown as W).queryLocalFonts = async () => {
      throw new DOMException('denied', 'NotAllowedError')
    }
  })
  await app.goto('/')
  await openMenu(app, 'Font')
  await app.getByRole('menuitem', { name: /Show installed fonts/ }).click()
  await openMenu(app, 'Font')
  await expect(app.getByText(/Installed fonts are blocked/)).toBeVisible()
})

test('installed fonts: without queryLocalFonts there is no installed-fonts UI', async ({ app }) => {
  await app.addInitScript(() => {
    delete (window as unknown as W).queryLocalFonts
  })
  await app.goto('/')
  await openMenu(app, 'Font')
  await expect(app.getByRole('menuitem', { name: 'Inter' })).toBeVisible()
  await expect(app.getByRole('menuitem', { name: /installed fonts/i })).toHaveCount(0)
})
