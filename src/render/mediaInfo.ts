// Pixel sampling for media: the edge color used by `background=auto`, and a
// small still of a video's first frame. Cached per URL. Browser only.

export interface MediaInfo {
  /** '#rrggbb' dominant edge color, or null when it can't be determined. */
  edge: string | null
  /** Data URL of a small still (videos only), for the blurred backdrop. */
  still: string | null
}

const cache = new Map<string, Promise<MediaInfo>>()
const EMPTY: MediaInfo = { edge: null, still: null }
const MAX_SIDE = 480

function sample(source: CanvasImageSource, width: number, height: number, wantStill: boolean): MediaInfo {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const w = Math.max(2, Math.round(width * scale))
  const h = Math.max(2, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return EMPTY
  ctx.drawImage(source, 0, 0, w, h)
  let edge: string | null = null
  try {
    const data = ctx.getImageData(0, 0, w, h).data
    // Quantized edge votes ignore transparent pixels and tolerate compression noise.
    const votes = new Map<number, number[]>()
    const vote = (x: number, y: number) => {
      const i = (y * w + x) * 4
      if (data[i + 3] < 240) return
      const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4)
      const list = votes.get(key)
      if (list) list.push(data[i], data[i + 1], data[i + 2])
      else votes.set(key, [data[i], data[i + 1], data[i + 2]])
    }
    for (let i = 0; i < 64; i++) {
      const x = Math.floor((i * (w - 1)) / 63)
      const y = Math.floor((i * (h - 1)) / 63)
      vote(x, 0)
      vote(x, h - 1)
      vote(0, y)
      vote(w - 1, y)
    }
    let best: number[] = []
    for (const list of votes.values()) if (list.length > best.length) best = list
    const n = best.length / 3
    if (n >= 128) {
      let r = 0, g = 0, b = 0
      for (let i = 0; i < best.length; i += 3) {
        r += best[i]
        g += best[i + 1]
        b += best[i + 2]
      }
      const hex = (v: number) => Math.floor(v / n).toString(16).padStart(2, '0')
      edge = '#' + hex(r) + hex(g) + hex(b)
    }
  } catch {
    // Tainted canvas: no edge color.
  }
  let still: string | null = null
  if (wantStill) {
    try {
      still = canvas.toDataURL('image/jpeg', 0.7)
    } catch {
      still = null
    }
  }
  return { edge, still }
}

function loadImage(url: string): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        resolve(sample(img, img.naturalWidth || 480, img.naturalHeight || 270, false))
      } catch {
        resolve(EMPTY)
      }
    }
    img.onerror = () => resolve(EMPTY)
    img.src = url
  })
}

function loadVideo(url: string): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    let done = false
    const finish = (info: MediaInfo) => {
      if (done) return
      done = true
      video.removeAttribute('src')
      video.load()
      resolve(info)
    }
    video.onloadeddata = () => {
      try {
        finish(sample(video, video.videoWidth || 480, video.videoHeight || 270, true))
      } catch {
        finish(EMPTY)
      }
    }
    video.onerror = () => finish(EMPTY)
    setTimeout(() => finish(EMPTY), 8000)
    video.src = url + '#t=0.001'
  })
}

/** Edge color (and for videos a first-frame still) of the media at `url`. */
export function mediaInfo(url: string, video: boolean): Promise<MediaInfo> {
  let hit = cache.get(url)
  if (!hit) {
    hit = video ? loadVideo(url) : loadImage(url)
    cache.set(url, hit)
  }
  return hit
}
