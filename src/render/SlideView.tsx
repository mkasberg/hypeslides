import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { parseMedia, slideProblems } from '../core'
import type { SlideMedia } from '../core'
import { highlightCode } from './highlight'
import { fitKeyFor, fitText, fontEpoch, highlightVersion, subscribeFonts, subscribeHighlight, watchFonts } from './fit'
import { ensureStyles, fontStack } from './styles'
import { FULL, halfLeadingEm, horizontal, inkFor, lineHeightEm, mediaRect, parseColor, sanitizeSvg, scalableSvg,
  slideProperty, slideTextLayout, vertical, type Rect } from './layout'
import { renderSlideHtml } from './markdown'
import { mediaInfo, type MediaInfo } from './mediaInfo'
import { SLIDE_WIDTH, type SlideViewProps } from './types'

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
  const { text, area, tm, overlaid } = useMemo(() => slideTextLayout(source, media), [source, media])
  const hasFile = !!media?.file
  const isVideo = !!media?.video
  const placed = !!media?.position
  const span = !!media?.span
  const background = media?.background ?? ''

  const wantsEdge = hasFile && !span && !placed && background !== 'theme' && background !== 'blur' &&
    (background === 'auto' || (!background && !isVideo)) && !bgProp
  // Export has no player: a video is painted as its poster, else its extracted first frame
  // (what Hype prints). Wait for a named poster to resolve before deciding it's missing.
  const exporting = mode === 'export'
  const wantsStill = exporting && isVideo && (!media?.poster || posterUrl === null)
  const needsInfo = !!fileUrl && (wantsEdge || (isVideo && background === 'blur') || wantsStill)
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
  if (overlaid && !fgExplicit && text) pal.foreground = '#ffffff'

  // ---- areas ----
  const svgOnly = media?.svg !== undefined && !hasFile
  const svgRect: Rect = text === '' ? { x: 70, y: 50, w: 1780, h: 980 } : { x: 100, y: 280, w: 1720, h: 730 }

  const mrect = media && hasFile ? mediaRect(media) : FULL

  const html = useMemo(
    () => (text ? renderSlideHtml(text, { highlight: highlightCode }) : ''),
    // hlVersion: re-render once a language grammar has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, hlVersion],
  )
  const fitKey = fitKeyFor(text, area, tm.high, tm.centered, tm.code, font)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && text) fitText(el, area, tm.high, fitKey, tm.code ? 1.2 : 1.15)
    // Fonts finishing loading change metrics, hence epoch.
  }, [fitKey, epoch, text, area, tm.high, tm.code])

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
    '--half': halfLeadingEm(font, 1.15),
    '--lh-code': lineHeightEm('JetBrains Mono', 1.2),
    '--half-code': halfLeadingEm('JetBrains Mono', 1.2),
    background: fill,
    visibility: scale ? 'visible' : 'hidden',
    transform: `scale(${scale || 1})`,
  } as CSSProperties

  const svgHtml = useMemo(
    () => (svgOnly && media?.svg ? scalableSvg(sanitizeSvg(media.svg)) : ''),
    [svgOnly, media?.svg],
  )

  // Hype paints a banner of the slide's errors across the bottom, joined by " · ".
  // A file counts as missing only once resolution has finished (null, not undefined).
  const banner = useMemo(
    () =>
      slideProblems(source, {
        mediaExists: (name) => (name === media?.file ? fileUrl !== null : name === media?.poster ? posterUrl !== null : true),
      }).map((p) => p.message).join(' · '),
    [source, media, fileUrl, posterUrl],
  )

  const softened = hasFile && !isVideo && !placed && !!text
  const showMissing = hasFile && fileUrl === null
  const live = mode === 'present'
  // Export: set until everything async that changes the painted slide has resolved, so
  // `whenPrintReady` knows when the page is final.
  const pending = exporting && (
    (hasFile && fileUrl === undefined) || (isVideo && !!media?.poster && posterUrl === undefined) ||
    (needsInfo && !info)
  )

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
    <div ref={outerRef} className="hs-outer" style={{ background: fill }} data-pending={pending ? '' : undefined}>
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
        {media && hasFile && fileUrl && isVideo && exporting && (posterUrl || info?.still) && (
          <img
            className="hs-media"
            src={posterUrl || info?.still || undefined}
            alt=""
            draggable={false}
            style={{ ...rectStyle(mrect), objectFit: span ? 'cover' : 'contain' }}
          />
        )}
        {media && hasFile && fileUrl && isVideo && !exporting && (
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
        {isVideo && fileUrl && !live && !exporting && !undecodable && (
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
        {banner && !live && !exporting && <div className="hs-problem">{banner}</div>}
      </div>
    </div>
  )
}
