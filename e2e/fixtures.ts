import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { installFakeFs } from './support/fakeFs.ts'
import type { FakeFsOptions } from './support/fakeFs.ts'

export { expect }

/** Frozen "now" for every test. */
export const FIXED_TIME = new Date('2026-01-15T12:00:00Z')

// Kill every view transition and animation, in case a stylesheet or the
// reduced-motion check misses one.
const NO_MOTION_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
`

function disableMotion() {
  const doc = document as unknown as { startViewTransition?: unknown }
  doc.startViewTransition = ((cb?: () => void) => {
    cb?.()
    const done = Promise.resolve()
    return { ready: done, finished: done, updateCallbackDone: done, skipTransition() {} }
  }) as unknown
  const add = () => {
    const style = document.createElement('style')
    style.textContent = (window as unknown as { __noMotionCss: string }).__noMotionCss
    document.head.appendChild(style)
  }
  if (document.head) add()
  else document.addEventListener('DOMContentLoaded', add)
}

export const test = base.extend<{
  /** A page with a frozen clock and no motion; storage is fresh per test (new context). */
  app: Page
  /** Open the app using an in-memory fake `showDirectoryPicker`. */
  openWithFakeFs: (opts?: FakeFsOptions) => Promise<Page>
  /** Open the app as in browsers without a directory picker (OPFS working copy). */
  openOpfs: () => Promise<Page>
}>({
  app: async ({ page }, run) => {
    await page.clock.install({ time: FIXED_TIME })
    await page.addInitScript(`window.__noMotionCss = ${JSON.stringify(NO_MOTION_CSS)}`)
    await page.addInitScript(disableMotion)
    await run(page)
  },
  openWithFakeFs: async ({ app }, run) => {
    await run(async (opts = {}) => {
      await app.addInitScript(installFakeFs, opts)
      await app.goto('/')
      await ready(app)
      return app
    })
  },
  openOpfs: async ({ app }, run) => {
    await run(async () => {
      await app.addInitScript(() => {
        delete (window as unknown as Record<string, unknown>).showDirectoryPicker
      })
      await app.goto('/')
      await ready(app)
      return app
    })
  },
})

/** App booted, fonts loaded. */
export async function ready(page: Page) {
  await expect(page.locator('.topbar')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/** Raw text of the file the fake folder holds, or null. */
export const fakeText = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __fakeFs: { text(p: string): string | null } }).__fakeFs.text(p), path)
