// Slide stylesheet shared by <SlideView> and the offscreen text measurement.

import { SLIDE_HEIGHT, SLIDE_WIDTH } from './types'

export const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"

export function fontStack(font: string): string {
  const name = font.replace(/["'\\]/g, '').trim()
  if (!name) return MONO
  const mono = /mono|code|courier|consol/i.test(name)
  return `'${name}', ` + (mono ? MONO : "system-ui, -apple-system, 'Segoe UI', sans-serif")
}

const CSS = `
.hs-outer{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;contain:layout paint style}
.hs-slide{position:absolute;left:0;top:0;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;transform-origin:0 0;overflow:hidden;color:var(--foreground);font-family:var(--font);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.hs-slide *{box-sizing:border-box}
.hs-abs{position:absolute}
.hs-media{position:absolute;display:block;max-width:none}
.hs-text{position:absolute;display:flex;flex-direction:column}
.hs-body{display:flow-root;margin-block:auto;width:100%;line-height:var(--lh);overflow-wrap:anywhere;color:var(--foreground)}
.hs-body.center{text-align:center}
.hs-body.code{--half:var(--half-code);font-family:${MONO};line-height:var(--lh-code);overflow-wrap:normal;white-space:nowrap}
.hs-body.code *{font-family:${MONO}}
.hs-body p,.hs-body ul,.hs-body ol,.hs-body blockquote,.hs-body pre,.hs-body table{margin:0 0 .22em}
/* Hype sizes headings at 2, 1.5, 1.2, 1, .8, .7 x the body size (Qt FontSizeAdjustment), but sets
   their margins from the body size, so each margin is divided by the heading's own factor. */
.hs-body h1,.hs-body h2,.hs-body h3,.hs-body h4,.hs-body h5,.hs-body h6{font-weight:700;line-height:var(--lh)}
.hs-body h1{font-size:2.0em;margin:0.0750em 0 0.1100em}
.hs-body h2{font-size:1.5em;margin:0.1000em 0 0.1467em}
.hs-body h3{font-size:1.2em;margin:0.1250em 0 0.1833em}
.hs-body h4{font-size:1.0em;margin:0.1500em 0 0.2200em}
.hs-body h5{font-size:0.8em;margin:0.1875em 0 0.2750em}
.hs-body h6{font-size:0.7em;margin:0.2143em 0 0.3143em}
.hs-body :is(h1,h2,h3,h4,h5,h6){position:relative;top:calc(var(--half) * -1)}
.hs-body strong{color:var(--accent);font-weight:700}
.hs-body h1 strong,.hs-body h2 strong,.hs-body h3 strong,.hs-body h4 strong{color:inherit}
.hs-body a{color:var(--accent);text-decoration:none}
.hs-body u{text-decoration:underline}
.hs-body p.attribution{font-size:.7em}
.hs-body ul,.hs-body ol{padding-left:1.4em;text-align:left}
.hs-body li{margin:0 0 .22em}
.hs-body li>p{margin:0}
.hs-body li>ul,.hs-body li>ol{margin:.22em 0 0}
.hs-body blockquote{padding-left:40px;text-align:left}
.hs-body blockquote>:last-child{margin-bottom:0}
.hs-body code{font-family:${MONO}}
.hs-body pre{white-space:pre;tab-size:4;margin:0;text-align:left}
.hs-body pre code{display:block}
.hs-body table{border-collapse:collapse;width:auto;margin-bottom:.22em;overflow-wrap:normal}
.hs-body.center table{margin-inline:auto}
.hs-body th,.hs-body td{padding:.25em;vertical-align:top;border-bottom:.03em solid color-mix(in srgb,var(--foreground) 20%,transparent);text-align:left}
.hs-body th{font-weight:700;color:var(--accent);border-bottom:.06em solid var(--accent)}
.hs-body tr:last-child td{border-bottom:0}
.hs-body th:not(:first-child),.hs-body td:not(:first-child){padding-left:.8em}
.hs-body th:not(:last-child),.hs-body td:not(:last-child){padding-right:.8em}
.hs-svg{position:absolute;display:flex;align-items:center;justify-content:center;fill:var(--foreground);color:var(--foreground);font-family:var(--font)}
.hs-svg svg{width:100%;height:100%;display:block}
.hs-missing{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;color:var(--accent);font:32px system-ui,sans-serif;overflow:hidden;padding:8px;word-break:break-all}
.hs-undecodable{position:absolute;display:flex;flex-direction:column;gap:24px;align-items:center;justify-content:center;text-align:center;background:#111;color:#fff;font:36px system-ui,sans-serif;overflow:hidden;padding:40px;word-break:break-word}
.hs-undecodable small{font-size:26px;opacity:.7}
.hs-play{position:absolute;width:150px;height:150px;border-radius:50%;border:8px solid rgba(255,255,255,.9);background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.hs-play::after{content:'';margin-left:14px;border-left:50px solid rgba(255,255,255,.95);border-top:30px solid transparent;border-bottom:30px solid transparent}
/* PDF export: <PrintDeck> is portaled into <body>. On screen it is laid out (fonts and text fit
   measure the DOM) but offscreen and invisible; when printing only it remains. A page holds a
   1080px-tall slide scaled to 720px by a transform; without contain:strict Chrome paginates by
   the untransformed layout and drops everything below 720px into a clipped continuation. */
.hs-print-root{position:fixed;left:-100000px;top:0;width:1280px;visibility:hidden;pointer-events:none}
.hs-print-page{width:1280px;height:720px;overflow:hidden;position:relative;contain:strict;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hs-print-page>.hs-outer{width:1280px}
@page{size:1280px 720px;margin:0}
@media print{
body>*:not(.hs-print-root){display:none!important}
html,body{margin:0;padding:0;background:none!important;overflow:visible!important;height:auto!important}
.hs-print-root{position:static;left:auto;width:auto;visibility:visible}
.hs-print-page{break-after:page;page-break-after:always}
.hs-print-page:last-child{break-after:auto;page-break-after:auto}
}
.hs-problem{position:absolute;left:0;right:0;bottom:0;height:80px;background:#9b3030;color:#fff;font:21px system-ui,sans-serif;display:flex;align-items:center;padding:0 30px}
`

let styled = false
export function ensureStyles() {
  if (styled || typeof document === 'undefined') return
  styled = true
  const el = document.createElement('style')
  el.setAttribute('data-hype-slide', '')
  el.textContent = CSS
  document.head.appendChild(el)
}
