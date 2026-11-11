import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { parseMedia } from '../core'
import type { SlideMedia } from '../core'
import { highlightCode, onHighlighterChange } from './highlight'
import { BAND_AREA, DEFAULT_AREA, FULL, horizontal, inkFor, lineHeightEm, mediaRect, parseColor, sanitizeSvg, scalableSvg,
  slideProperty, textMode, vertical, type Rect } from './layout'
import { renderSlideHtml, withoutComments } from './markdown'
import { mediaInfo, type MediaInfo } from './mediaInfo'
import { SLIDE_HEIGHT, SLIDE_WIDTH, type SlideViewProps } from './types'

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"

function fontStack(font: string): string {
  const name = font.replace(/["'\\]/g, '').trim()
  if (!name) return MONO
  const mono = /mono|code|courier|consol/i.test(name)
  return `'${name}', ` + (mono ? MONO : "system-ui, -apple-system, 'Segoe UI', sans-serif")
}

const CSS = `
.hs-outer{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;contain:layout paint style}
.hs-slide{position:absolute;left:0;top:0;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;transform-origin:0 0;overflow:hidden;color:var(--foreground);font-family:var(--font);-webkit-font-smoothing:antialiased}
.hs-slide *{box-sizing:border-box}
.hs-abs{position:absolute}
.hs-media{position:absolute;display:block;max-width:none}
.hs-text{position:absolute;display:flex;flex-direction:column}
.hs-body{display:flow-root;margin-block:auto;width:100%;line-height:var(--lh);overflow-wrap:anywhere;color:var(--foreground)}
.hs-body.center{text-align:center}
.hs-body.code{font-family:${MONO};line-height:var(--lh-code);overflow-wrap:normal}
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
.hs-problem{position:absolute;left:0;right:0;bottom:0;height:80px;background:#9b3030;color:#fff;font:21px system-ui,sans-serif;display:flex;align-items:center;padding:0 30px}
`

let styled = false
function ensureStyles() {
  if (styled || typeof document === 'undefined') return
  styled = true
  const el = document.createElement('style')
  el.setAttribute('data-hype-slide', '')
  el.textContent = CSS
  document.head.appendChild(el)
}

// ---- external stores: highlighter readiness and font loading -----------------

let fontEpoch = 0
const fontListeners = new Set<() => void>()
let watchingFonts = false
function watchFonts() {
  if (watchingFonts || typeof document === 'undefined' || !document.fonts) return
  watchingFonts = true
  document.fonts.addEventListener('loadingdone', () => {
    fontEpoch++
    fitCache.clear()
    fontListeners.forEach((fn) => fn())
  })
}
const subscribeFonts = (fn: () => void) => {
  fontListeners.add(fn)
  return () => void fontListeners.delete(fn)
}
let highlightVersion = 0
onHighlighterChange(() => highlightVersion++)
const subscribeHighlight = (fn: () => void) => onHighlighterChange(fn)

// ---- text fitting -------------------------------------------------------------

const fitCache = new Map<string, number>()
const FIT_CACHE_MAX = 4096

function fitText(el: HTMLElement, area: Rect, high: number, key: string) {
  const cached = fitCache.get(key)
  if (cached !== undefined) {
    el.style.fontSize = cached + 'px'
    return
  }
  const fits = () => el.scrollHeight <= area.h && el.scrollWidth <= area.w + 1
  let low = 8
  let size = high
  el.style.fontSize = size + 'px'
  if (fits()) low = high
  else {
    for (let i = 0; i < 9; i++) {
      size = (low + high) / 2
      el.style.fontSize = size + 'px'
      if (fits()) low = size
      else high = size
    }
    el.style.fontSize = low + 'px'
  }
  if (fitCache.size >= FIT_CACHE_MAX) fitCache.clear()
  fitCache.set(key, low)
}

// ---- media resolution ---------------------------------------------------------

type Resolved = { name: string; url: string | null } | null

function useResolved(name: string | undefined, resolve: SlideViewProps['resolveMedia']): string | null | undefined {
  const [state, setState] = useState<Resolved>(null)
  useEffect(() => {
    if (!name) return
    let cancelled = false
    resolve(name).then(
      (url) => !cancelled && setState((s) => (s && s.name === name && s.url === url ? s : { name, url })),
      () => !cancelled && setState({ name, url: null }),
    )
    return () => {
      cancelled = true
    }
  }, [name, resolve])
  if (!name) return undefined
  return state && state.name === name ? state.url : undefined
}

function useMediaInfo(url: string | null | undefined, video: boolean, enabled: boolean): MediaInfo | null {
  const [state, setState] = useState<{ url: string; info: MediaInfo } | null>(null)
  useEffect(() => {
    if (!url || !enabled) return
    let cancelled = false
    void mediaInfo(url, video).then((info) => !cancelled && setState({ url, info }))
    return () => {
      cancelled = true
    }
  }, [url, video, enabled])
  return enabled && state && state.url === url ? state.info : null
}

let colorCtx: CanvasRenderingContext2D | null | undefined
function namedColor(name: string): [number, number, number] | null {
  if (/^(blur|auto|theme|transparent)$/i.test(name)) return null
  colorCtx ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (!colorCtx) return null
  colorCtx.fillStyle = '#010203'
  colorCtx.fillStyle = name
  const out = colorCtx.fillStyle
  if (out === '#010203' && name.toLowerCase() !== 'black') return null
  const m = /^#([0-9a-f]{6})$/i.exec(out)
  return m ? ([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]) : null
}

function objectPosition(media: SlideMedia): string {
  if (!media.position) return 'center'
  return `${horizontal(media.position)} ${vertical(media.position)}`
}

const rectStyle = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h })

// ---- component ----------------------------------------------------------------

export function SlideView({ source, palette, font, resolveMedia, mode, playToggle }: SlideViewProps) {
  ensureStyles()
  watchFonts()
  const outerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [scale, setScale] = useState(0)
  const epoch = useSyncExternalStore(subscribeFonts, () => fontEpoch, () => 0)
  const hlVersion = useSyncExternalStore(subscribeHighlight, () => highlightVersion, () => 0)

  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / SLIDE_WIDTH)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const media = useMemo(() => parseMedia(source), [source])
  const fileUrl = useResolved(media?.file || undefined, resolveMedia)
  const posterUrl = useResolved(media?.video ? media.poster : undefined, resolveMedia)

  const bgProp = slideProperty(source, 'background')
  const fgProp = slideProperty(source, 'foreground')
  const text = (media ? media.text : withoutComments(source)).trim()
  const hasFile = !!media?.file
  const isVideo = !!media?.video
  const placed = !!media?.position
  const span = !!media?.span
  const background = media?.background ?? ''

  const wantsEdge = hasFile && !span && !placed && background !== 'theme' && background !== 'blur' &&
    (background === 'auto' || (!background && !isVideo)) && !bgProp
  const needsInfo = !!fileUrl && (wantsEdge || (isVideo && background === 'blur'))
  const info = useMediaInfo(fileUrl, isVideo, needsInfo)

  // ---- palette resolution, in the order of Hype's paintSlide ----
  const pal: Record<string, string> = { ...palette }
  if (parseColor(bgProp, namedColor)) pal.background = bgProp
  if (parseColor(fgProp, namedColor)) pal.foreground = fgProp
  let fill = pal.background
  const fgExplicit = !!fgProp && !!parseColor(fgProp, namedColor)
  let blurBackdrop: string | null = null
  if (media && hasFile && !span) {
    if (background === 'blur') blurBackdrop = isVideo ? info?.still ?? null : fileUrl ?? null
  }
  if (hasFile && !span && !placed && background !== 'theme' && (!bgProp || background) && (!isVideo || background)) {
    let color: { css: string; rgb: [number, number, number] } | null = null
    if (background === 'auto' || !background) {
      if (info?.edge) color = parseColor(info.edge)
    } else color = parseColor(background, namedColor)
    if (color) {
      fill = color.css
      if (!fgExplicit) {
        const ink = inkFor(...color.rgb)
        pal.foreground = ink
        pal.accent = ink
      }
    }
  }
  const overlaid = hasFile && !placed && (!isVideo || span)
  if (overlaid && !fgExplicit && text) pal.foreground = '#ffffff'

  // ---- areas ----
  let area = DEFAULT_AREA
  const svgOnly = media?.svg !== undefined && !hasFile
  const svgRect: Rect = text === '' ? { x: 70, y: 50, w: 1780, h: 980 } : { x: 100, y: 280, w: 1720, h: 730 }
  if (svgOnly && text) area = BAND_AREA
  if (hasFile && !placed && isVideo && !span && text) area = BAND_AREA
  if (hasFile && !placed && !overlaid && text) area = BAND_AREA

  const mrect = media && hasFile ? mediaRect(media) : FULL
  const tm = textMode(text, slideProperty(source, 'alignment'), isVideo && !span)

  const html = useMemo(
    () => (text ? renderSlideHtml(text, { highlight: highlightCode }) : ''),
    // hlVersion: re-render once a language grammar has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, hlVersion],
  )
  const fitKey = `${tm.high} ${area.w} ${area.h} ${tm.centered} ${tm.code} ${font}\n${text}`
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && text) fitText(el, area, tm.high, fitKey)
    // Fonts finishing loading change metrics, hence epoch.
  }, [fitKey, epoch, text, area, tm.high])

  // ---- video playback (present mode) ----
  const lastToggle = useRef(playToggle ?? 0)
  useEffect(() => {
    const v = videoRef.current
    if (!v || mode !== 'present' || !media?.autoplay) return
    v.currentTime = 0
    void v.play().catch(() => undefined)
  }, [mode, media?.autoplay, fileUrl])
  useEffect(() => {
    const t = playToggle ?? 0
    if (t === lastToggle.current) return
    lastToggle.current = t
    const v = videoRef.current
    if (!v || mode !== 'present') return
    if (v.ended) {
      v.currentTime = 0
      void v.play().catch(() => undefined)
    } else if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }, [playToggle, mode])

  const cssVars = {
    '--background': pal.background,
    '--foreground': pal.foreground,
    '--accent': pal.accent,
    '--green': pal.green,
    '--red': pal.red,
    '--yellow': pal.yellow,
    '--magenta': pal.magenta,
    '--cyan': pal.cyan,
    '--dark-foreground': pal.dark_foreground,
    '--dark_foreground': pal.dark_foreground,
    '--font': fontStack(font),
    '--lh': lineHeightEm(font, 1.15),
    '--lh-code': lineHeightEm('JetBrains Mono', 1.2),
    background: fill,
    visibility: scale ? 'visible' : 'hidden',
    transform: `scale(${scale || 1})`,
  } as CSSProperties

  const svgHtml = useMemo(
    () => (svgOnly && media?.svg ? scalableSvg(sanitizeSvg(media.svg)) : ''),
    [svgOnly, media?.svg],
  )

  const softened = hasFile && !isVideo && !placed && !!text
  const showMissing = hasFile && fileUrl === null
  const live = mode === 'present'

  // A video whose picture this browser can't decode (e.g. HEVC in Chrome on
  // Linux) loads without an error and plays its audio over black, reporting
  // videoWidth 0. Flag it so the slide says why instead of staying black.
  const [undecodableUrl, setUndecodableUrl] = useState<string | null>(null)
  const undecodable = !!fileUrl && undecodableUrl === fileUrl
  const checkDecodable = (e: { currentTarget: HTMLVideoElement }) => {
    const v = e.currentTarget
    if (fileUrl && v.videoWidth === 0 && v.videoHeight === 0) setUndecodableUrl(fileUrl)
  }
  const onVideoError = (e: { currentTarget: HTMLVideoElement }) => {
    if (fileUrl && e.currentTarget.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) setUndecodableUrl(fileUrl)
  }

  return (
    <div ref={outerRef} className="hs-outer" style={{ background: fill }}>
      <div className="hs-slide" style={cssVars}>
        {blurBackdrop && (
          <img
            className="hs-abs"
            src={blurBackdrop}
            alt=""
            draggable={false}
            style={{ left: 0, top: 0, width: '100%', height: '100%', objectFit: 'fill', filter: 'blur(28px)', transform: 'scale(1.1)' }}
          />
        )}
        {svgOnly && svgHtml && (
          <div className="hs-svg" style={rectStyle(svgRect)} dangerouslySetInnerHTML={{ __html: svgHtml }} />
        )}
        {media && hasFile && fileUrl && !isVideo && (
          <img
            className="hs-media"
            src={fileUrl}
            alt=""
            draggable={false}
            style={{
              ...rectStyle(mrect),
              objectFit: span ? 'cover' : 'contain',
              objectPosition: objectPosition(media),
              ...(softened ? { filter: 'blur(1.2px)', ...(span ? { transform: 'scale(1.01)' } : {}) } : {}),
            }}
          />
        )}
        {media && hasFile && fileUrl && isVideo && (
          live || !posterUrl ? (
            <video
              ref={videoRef}
              className="hs-media"
              src={live ? fileUrl : fileUrl + '#t=0.001'}
              poster={posterUrl ?? undefined}
              preload={live ? 'auto' : 'metadata'}
              loop={live && media.loop}
              muted={media.muted || !live}
              playsInline
              onLoadedMetadata={checkDecodable}
              onError={onVideoError}
              style={{ ...rectStyle(mrect), objectFit: span ? 'cover' : 'contain', background: 'transparent' }}
            />
          ) : (
            <img
              className="hs-media"
              src={posterUrl}
              alt=""
              draggable={false}
              style={{ ...rectStyle(mrect), objectFit: span ? 'cover' : 'contain' }}
            />
          )
        )}
        {undecodable && media && (
          <div className="hs-undecodable" style={rectStyle(mrect)}>
            <div>This browser can’t play this video’s picture</div>
            <small>{media.file}</small>
            <small>Phone videos are often HEVC (H.265). Convert to H.264 MP4 to play everywhere.</small>
          </div>
        )}
        {isVideo && fileUrl && !live && !undecodable && (
          <div
            className="hs-play"
            style={{ left: mrect.x + mrect.w / 2 - 75, top: mrect.y + mrect.h / 2 - 75 }}
          />
        )}
        {showMissing && media && (
          <div className="hs-missing" style={rectStyle(mrect)}>
            {'Missing media\n' + media.file}
          </div>
        )}
        {overlaid && media && media.overlay! > 0 && (
          <div className="hs-abs" style={{ left: 0, top: 0, width: '100%', height: '100%', background: `rgba(0,0,0,${media.overlay})` }} />
        )}
        {text !== '' && (
          <div className="hs-text" style={rectStyle(area)}>
            <div
              ref={bodyRef}
              className={'hs-body' + (tm.centered ? ' center' : '') + (tm.code ? ' code' : '')}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
        {media?.error && mode !== 'present' && <div className="hs-problem">{media.error}</div>}
      </div>
    </div>
  )
}
