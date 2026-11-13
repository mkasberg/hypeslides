import { highlighterIdle } from './highlight'

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Everything the painted output depends on that we can read back from the DOM. */
function signature(root: HTMLElement): string {
  const sizes = Array.from(root.querySelectorAll<HTMLElement>('.hs-body'), (b) => b.style.fontSize + '/' + b.innerHTML.length)
  const imgs = Array.from(root.querySelectorAll('img'), (i) => i.getAttribute('src'))
  return sizes.join(',') + '|' + imgs.join(',')
}

/**
 * Resolves when the printed output has settled: fonts loaded, syntax grammars
 * loaded, every slide's media resolved (`data-pending` cleared by SlideView),
 * images decoded, and the text-fit pass stable (the DOM signature unchanged
 * across two animation frames, since fonts/highlighting re-run the fit).
 * Resolves anyway after `timeoutMs` so a stuck asset can't block exporting.
 */
export function whenPrintReady(root: HTMLElement, timeoutMs = 15000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))
  let stopped = false
  const settle = async () => {
    for (let last = ''; !stopped; ) {
      await document.fonts?.ready
      await highlighterIdle()
      while (root.querySelector('[data-pending]')) await frame()
      await Promise.all(
        Array.from(root.querySelectorAll('img'), (img) => (img.getAttribute('src') ? img.decode?.().catch(() => undefined) : undefined)),
      )
      await frame()
      await frame()
      const sig = signature(root)
      if (sig === last && !root.querySelector('[data-pending]')) return
      last = sig
    }
  }
  return Promise.race([settle(), timeout]).finally(() => {
    stopped = true
    clearTimeout(timer)
  })
}
