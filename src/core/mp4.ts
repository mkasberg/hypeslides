// Minimal ISO-BMFF (MP4) inspection: the codec of the first video and audio
// track, and the video's coded size. Hype asks ffprobe the same question
// before embedding a movie in PowerPoint (H.264 video, AAC audio). Pure.

export interface Mp4Info {
  video: { codec: string; width: number; height: number } | null
  audio: { codec: string } | null
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

/** Codec details of an MP4, or null if the bytes are not a readable MP4. */
export function probeMp4(bytes: Uint8Array): Mp4Info | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const info: Mp4Info = { video: null, audio: null }
  let sawMoov = false

  const walk = (start: number, end: number, handler: string | null): boolean => {
    for (let at = start; at + 8 <= end; ) {
      let size = view.getUint32(at)
      const type = fourcc(bytes, at + 4)
      let header = 8
      if (size === 1) {
        if (at + 16 > end) return false
        const big = view.getBigUint64(at + 8)
        if (big > BigInt(end - at)) return false
        size = Number(big)
        header = 16
      } else if (size === 0) size = end - at
      if (size < header || at + size > end) return false
      const body = at + header
      const boxEnd = at + size
      if (type === 'moov') sawMoov = true
      if (CONTAINERS.has(type)) {
        // A track's handler (in mdia/hdlr) says whether its sample entries are video or sound.
        let h = handler
        if (type === 'trak') h = null
        if (type === 'mdia') h = handlerIn(body, boxEnd)
        if (!walk(body, boxEnd, h)) return false
      } else if (type === 'stsd' && body + 16 <= boxEnd && view.getUint32(body + 4) > 0) {
        const entry = body + 8
        const codec = fourcc(bytes, entry + 4)
        if (handler === 'vide' && !info.video) {
          // VisualSampleEntry: 8 header + 6 reserved + 2 index + 16 predefined, then width, height.
          const ok = entry + 36 <= boxEnd
          info.video = { codec, width: ok ? view.getUint16(entry + 32) : 0, height: ok ? view.getUint16(entry + 34) : 0 }
        } else if (handler === 'soun' && !info.audio) info.audio = { codec }
      }
      at = boxEnd
    }
    return true
  }

  const handlerIn = (start: number, end: number): string | null => {
    for (let at = start; at + 8 <= end; ) {
      const size = view.getUint32(at)
      if (size < 8 || at + size > end) return null
      if (fourcc(bytes, at + 4) === 'hdlr' && at + 20 <= end) return fourcc(bytes, at + 16)
      at += size
    }
    return null
  }

  if (bytes.length < 8 || !walk(0, bytes.length, null) || !sawMoov) return null
  return info
}

/** What PowerPoint plays everywhere: H.264 video, and AAC audio if any. */
export function isPowerPointMp4(info: Mp4Info | null): boolean {
  return !!info?.video && /^avc[13]$/.test(info.video.codec) && (!info.audio || info.audio.codec === 'mp4a')
}
