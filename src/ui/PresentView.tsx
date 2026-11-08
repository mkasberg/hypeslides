import { useEffect, useRef, useState } from 'react'
import { selectedSlide } from '../core'
import { SlideView } from '../render'
import { useApp } from '../app/useApp'
import { useDeckLook, useElementSize } from './slideHooks'

const IDLE_MS = 2000

export function PresentView() {
  const source = useApp((s) => selectedSlide(s.doc))
  const playToggle = useApp((s) => s.playToggle)
  const { palette, font, resolveMedia } = useDeckLook()
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [idle, setIdle] = useState(false)
  const entered = useRef(false)

  // Fullscreen while presenting; leaving fullscreen (Esc in the browser) ends the show.
  useEffect(() => {
    const el = document.documentElement
    el.requestFullscreen?.().then(() => { entered.current = true }).catch(() => {})
    const onChange = () => {
      if (!document.fullscreenElement && entered.current) useApp.getState().stopPresenting()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      entered.current = false
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  // Hide the cursor after a pause.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wake = () => {
      setIdle(false)
      clearTimeout(t)
      t = setTimeout(() => setIdle(true), IDLE_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousemove', wake)
    }
  }, [])

  const w = Math.min(size.w, size.h * (16 / 9))
  const step = (d: number) => useApp.getState().step(d)
  return (
    <div
      ref={ref}
      className={'present' + (idle ? ' idle' : '')}
      onClick={() => step(1)}
      onContextMenu={(e) => { e.preventDefault(); step(1) }}
    >
      {w > 0 && (
        <div style={{ width: w }}>
          <SlideView source={source} palette={palette} font={font} resolveMedia={resolveMedia} mode="present" playToggle={playToggle} />
        </div>
      )}
    </div>
  )
}
