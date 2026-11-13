// Renderer contract. `<SlideView>` (src/render/SlideView.tsx) draws one slide
// at a fixed 1920×1080 logical size and scales itself to fill its container's
// width (16:9). The same component is used by the sidebar thumbnails, the
// overview grid, the visual-mode preview, present mode, and (later) PDF/PPTX
// export and agent `render_slide`.

import type { Palette } from '../core/types'

/** Resolves a media filename (`city.jpg`) to a URL, or null if missing. */
export type MediaResolver = (filename: string) => Promise<string | null>

export interface SlideViewProps {
  /** The slide's Markdown (as returned by core `slideAt(...).source`). */
  source: string
  palette: Palette
  /** Presentation font family (from the front matter). */
  font: string
  resolveMedia: MediaResolver
  /**
   * 'thumbnail': static, cheap (no video playback, no animation).
   * 'preview':   editor preview; videos show first frame / poster, no autoplay.
   * 'present':   live presentation; videos autoplay per options.
   * 'export':    print/PDF; fully static, videos are an <img> (poster, else first
   *              frame), no play badge, no problem banner.
   */
  mode: 'thumbnail' | 'preview' | 'present' | 'export'
  /**
   * Export only. 'overlay' paints just what sits over the media (the darkening
   * overlay and the text) on a transparent background, like Hype's
   * `paintSlide(..., overlayOnly)`: PowerPoint export lays it over a spanning video.
   */
  layer?: 'overlay'
  /** Present mode: toggled by Space to play/pause video. Increment to toggle. */
  playToggle?: number
}

/** Logical slide size; everything inside is laid out in these pixels. */
export const SLIDE_WIDTH = 1920
export const SLIDE_HEIGHT = 1080
