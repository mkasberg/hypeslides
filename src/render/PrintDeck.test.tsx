// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrintDeck, whenPrintReady } from './PrintDeck'
import type { Palette } from '../core/types'

const palette = { background: '#000', foreground: '#fff', accent: '#0ff' } as unknown as Palette

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve(), addEventListener() {} }, configurable: true })
})
afterEach(() => void (document.body.innerHTML = ''))

const resolveMedia = async (name: string) => 'blob:' + name

async function mount(slides: string[], onReady?: () => void) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(
    <PrintDeck slides={slides} palette={palette} font="Inter" resolveMedia={resolveMedia} onReady={onReady} />,
  ))
  return root
}

describe('PrintDeck', () => {
  it('renders one page per slide', async () => {
    await mount(['# A', '# B', '# C'])
    expect(document.querySelectorAll('.hs-print-page')).toHaveLength(3)
  })

  it('paints a video slide as an image, never a <video>', async () => {
    await mount(['![](clip.mp4)\n\n# T'])
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('.hs-play')).toBeNull()
  })

  it('uses the poster when given', async () => {
    await mount(['![poster=p.jpg](clip.mp4)'])
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('.hs-print-page img')?.getAttribute('src')).toBe('blob:p.jpg')
  })

  it('calls onReady once slides settle', async () => {
    const ready = vi.fn()
    await mount(['# A', '![poster=p.jpg](clip.mp4)'], ready)
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })
})

describe('whenPrintReady', () => {
  it('waits for images to decode', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="blob:x">'
    document.body.appendChild(root)
    let finish!: () => void
    const decoded = new Promise<void>((r) => (finish = r))
    ;(root.querySelector('img') as HTMLImageElement).decode = () => decoded
    let done = false
    void whenPrintReady(root).then(() => (done = true))
    await new Promise((r) => setTimeout(r, 100))
    expect(done).toBe(false)
    finish()
    await vi.waitFor(() => expect(done).toBe(true))
  })

  it('waits while a slide is pending, and gives up at the timeout', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-pending></div>'
    document.body.appendChild(root)
    const t = Date.now()
    await whenPrintReady(root, 150)
    expect(Date.now() - t).toBeGreaterThanOrEqual(140)
  })

  it('ignores failed decodes', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="blob:x">'
    ;(root.querySelector('img') as HTMLImageElement).decode = () => Promise.reject(new Error('bad'))
    await expect(whenPrintReady(root)).resolves.toBeUndefined()
  })
})
