import demoMp4 from '../../tests/parity/decks/media/videos/demo.mp4?inline'
import { describe, expect, it } from 'vitest'
import { isPowerPointMp4, probeMp4 } from './mp4'

const box = (type: string, ...children: Uint8Array[]) => {
  const body = children.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(8 + body)
  new DataView(out.buffer).setUint32(0, 8 + body)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  let at = 8
  for (const c of children) {
    out.set(c, at)
    at += c.length
  }
  return out
}
const bytes = (n: number, fill = 0) => new Uint8Array(n).fill(fill)
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
const hdlr = (kind: string) => box('hdlr', bytes(8), ascii(kind), bytes(12))
const stsd = (codec: string, width = 0, height = 0) => {
  const entry = box(codec, bytes(24), new Uint8Array([width >> 8, width & 255, height >> 8, height & 255]), bytes(50))
  return box('stsd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), entry)
}
const track = (kind: string, sample: Uint8Array) =>
  box('trak', box('tkhd', bytes(84)), box('mdia', hdlr(kind), box('minf', box('stbl', sample))))
const mp4 = (...tracks: Uint8Array[]) =>
  new Uint8Array([...box('ftyp', ascii('isom'), bytes(4)), ...box('mdat', bytes(32)), ...box('moov', ...tracks)])

describe('probeMp4', () => {
  it('reads a real H.264 fixture', () => {
    const info = probeMp4(Uint8Array.from(atob(demoMp4.split(',')[1]), (c) => c.charCodeAt(0)))
    expect(info).toEqual({ video: { codec: 'avc1', width: 320, height: 180 }, audio: null })
    expect(isPowerPointMp4(info)).toBe(true)
  })

  it('finds video and audio tracks by handler, after mdat', () => {
    const info = probeMp4(mp4(track('vide', stsd('avc1', 1920, 1080)), track('soun', stsd('mp4a'))))
    expect(info).toEqual({ video: { codec: 'avc1', width: 1920, height: 1080 }, audio: { codec: 'mp4a' } })
    expect(isPowerPointMp4(info)).toBe(true)
  })

  it('rejects codecs PowerPoint cannot play', () => {
    expect(isPowerPointMp4(probeMp4(mp4(track('vide', stsd('hvc1', 3840, 2160)))))).toBe(false)
    expect(isPowerPointMp4(probeMp4(mp4(track('vide', stsd('avc1', 64, 64)), track('soun', stsd('Opus')))))).toBe(false)
    expect(isPowerPointMp4(probeMp4(mp4(track('soun', stsd('mp4a')))))).toBe(false)
  })

  it('returns null for non-MP4 or truncated bytes', () => {
    expect(probeMp4(ascii('\x1aE\xdf\xa3 webm header'))).toBeNull()
    expect(probeMp4(new Uint8Array())).toBeNull()
    const whole = mp4(track('vide', stsd('avc1', 64, 64)))
    expect(probeMp4(whole.slice(0, whole.length - 10))).toBeNull()
  })
})
