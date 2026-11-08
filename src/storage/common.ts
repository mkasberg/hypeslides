// Shared helpers: media classification, md selection, unique naming.

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']
export const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'webm', 'mkv']

export type MediaKind = 'images' | 'videos'

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 'images' | 'videos' by extension; null for anything else. */
export function mediaKind(name: string): MediaKind | null {
  const e = extOf(name)
  if (IMAGE_EXTS.includes(e)) return 'images'
  if (VIDEO_EXTS.includes(e)) return 'videos'
  return null
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska',
}
export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream'
}

/** Prefer `presentation.md`, else first `*.md` alphabetically; undefined if none. */
export function pickMarkdown(names: string[]): string | undefined {
  const mds = names.filter((n) => extOf(n) === 'md' && !n.startsWith('.')).sort()
  if (mds.includes('presentation.md')) return 'presentation.md'
  return mds[0]
}

/** `city.jpg` -> `city-2.jpg`, `city-3.jpg`, ... until `exists` is false. */
export async function uniqueName(
  filename: string,
  exists: (name: string) => Promise<boolean> | boolean,
): Promise<string> {
  if (!(await exists(filename))) return filename
  const i = filename.lastIndexOf('.')
  const stem = i < 0 ? filename : filename.slice(0, i)
  const ext = i < 0 ? '' : filename.slice(i)
  for (let n = 2; ; n++) {
    const c = `${stem}-${n}${ext}`
    if (!(await exists(c))) return c
  }
}

/** Strip any path components and characters that are illegal in filenames. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim()
  return clean || 'file'
}
