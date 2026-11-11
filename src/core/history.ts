// Version history and crash-recovery logic. Pure TypeScript (no DOM, no
// storage): naming, hashing, dedupe, pruning, and the draft record format.
// Ported from ~/code/hype/src/recovery.cpp and the backup code in
// Deck::savePath (src/deck.cpp).

// ---- hashing ---------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 of a string's UTF-8 bytes, as lowercase hex. Synchronous and DOM-free. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text)
  const len = data.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000))
  view.setUint32(padded.length - 4, (len * 8) >>> 0)
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** First 16 hex digits of the SHA-256: the hash used in backup filenames (like Hype). */
export function hash16(text: string): string {
  return sha256Hex(text).slice(0, 16)
}

// ---- timestamps and file names --------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** `yyyyMMdd-HHmmss-zzz` in UTC, Hype's backup timestamp format. */
export function formatStamp(ms: number): string {
  const d = new Date(ms)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`
  )
}

/** Inverse of formatStamp; null if `s` is not a stamp. */
export function parseStamp(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})$/.exec(s)
  if (!m) return null
  const [y, mo, d, h, mi, se, ms] = m.slice(1).map(Number)
  const t = Date.UTC(y, mo - 1, d, h, mi, se, ms)
  return Number.isNaN(t) ? null : t
}

export interface ParsedSnapshotName {
  timestamp: number
  hash: string
}

const NAME_TAIL = /^(\d{8}-\d{6}-\d{3})-([0-9a-f]{16})$/

function parseTail(tail: string): ParsedSnapshotName | null {
  const m = NAME_TAIL.exec(tail)
  const timestamp = m ? parseStamp(m[1]) : null
  return m && timestamp !== null ? { timestamp, hash: m[2] } : null
}

/** OPFS snapshot file: `<stamp>-<hash16>.md`. */
export function snapshotFileName(ms: number, hash: string): string {
  return `${formatStamp(ms)}-${hash}.md`
}
export function parseSnapshotFileName(file: string): ParsedSnapshotName | null {
  return file.endsWith('.md') ? parseTail(file.slice(0, -3)) : null
}

/**
 * In-folder backup of the file being replaced: `<name>.<stamp>-<hash16>.bak`
 * (Hype: `presentation.md.20260101-120000-123-0123456789abcdef.bak`).
 */
export function backupFileName(markdownName: string, ms: number, hash: string): string {
  return `${markdownName}.${formatStamp(ms)}-${hash}.bak`
}
export function parseBackupFileName(markdownName: string, file: string): ParsedSnapshotName | null {
  const prefix = `${markdownName}.`
  if (!file.startsWith(prefix) || !file.endsWith('.bak')) return null
  return parseTail(file.slice(prefix.length, -4))
}

/** Where a version came from: the in-browser copy or the folder's `.hype-backups/`. */
export type SnapshotSource = 'opfs' | 'folder'

export interface SnapshotInfo {
  /** Opaque, stable id: `opfs:<file>` or `folder:<file>`. Pass to readSnapshot. */
  id: string
  /** When this content was captured (ms since epoch). */
  timestamp: number
  /** Size in bytes. */
  size: number
  source: SnapshotSource
  /** First 16 hex digits of the content's SHA-256 (`hash16(text)`). */
  hash: string
}

export function snapshotId(source: SnapshotSource, file: string): string {
  return `${source}:${file}`
}
export function parseSnapshotId(id: string): { source: SnapshotSource; file: string } | null {
  const i = id.indexOf(':')
  const source = id.slice(0, i)
  const file = id.slice(i + 1)
  if (i < 0 || (source !== 'opfs' && source !== 'folder')) return null
  if (!file || file.includes('/') || file.includes('\\') || file.startsWith('.')) return null
  return { source, file }
}

/**
 * Merge versions from several sources, newest first. Identical content (same
 * hash) is listed once: the `opfs` entry wins (its time is when the content was
 * first checkpointed; a folder backup is stamped when it was replaced).
 */
export function mergeSnapshots(lists: SnapshotInfo[][]): SnapshotInfo[] {
  const byHash = new Map<string, SnapshotInfo>()
  for (const s of lists.flat()) {
    const have = byHash.get(s.hash)
    if (!have || (s.source === 'opfs' && have.source !== 'opfs') ||
        (s.source === have.source && s.timestamp > have.timestamp)) byHash.set(s.hash, s)
  }
  return [...byHash.values()].sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : -1))
}

// ---- pruning ----------------------------------------------------------------

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

export const PRUNE_POLICY = {
  /** Everything newer than this is kept. */
  keepAllWithin: DAY,
  /** Older than that, keep the newest snapshot of each hour for this long. */
  hourlyWithin: 7 * DAY,
  /** Older still: the newest snapshot of each day. Never more than this many. */
  maxCount: 500,
} as const

/**
 * Which in-browser snapshots to delete. Hype keeps every version; browsers
 * have storage quotas and autosave runs every second, so thin out the old
 * ones: keep all from the last day, one per hour for a week, one per day after,
 * never more than `maxCount`, and always the newest. Folder `.hype-backups/`
 * are never pruned (they are the user's files, as in Hype).
 */
export function selectPrunable(entries: { id: string; timestamp: number }[], now: number): string[] {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp)
  const keep = new Set<string>()
  const buckets = new Set<string>()
  for (const e of sorted) {
    const age = now - e.timestamp
    if (age <= PRUNE_POLICY.keepAllWithin) keep.add(e.id)
    else {
      const bucket = age <= PRUNE_POLICY.hourlyWithin
        ? `h${Math.floor(e.timestamp / HOUR)}` : `d${Math.floor(e.timestamp / DAY)}`
      if (!buckets.has(bucket)) { buckets.add(bucket); keep.add(e.id) }
    }
  }
  if (sorted[0]) keep.add(sorted[0].id)
  const kept = sorted.filter((e) => keep.has(e.id)).slice(0, PRUNE_POLICY.maxCount)
  const final = new Set(kept.map((e) => e.id))
  return sorted.filter((e) => !final.has(e.id)).map((e) => e.id)
}

// ---- drafts (crash recovery) -------------------------------------------------

/**
 * The latest unsaved state of a deck, persisted so a crash or reload loses
 * nothing. Hype's `latest.json` (src/recovery.cpp `checkpoint`), minus the
 * slide structure (we reparse).
 */
export interface Draft {
  version: 1
  /** Which deck: `untitled`, `opfs-current`, or `fs-<hash>` (see PresentationStore.key). */
  key: string
  /** The unsaved Markdown. */
  source: string
  /** The saved source this draft was based on (what was on disk/in the store). */
  saved: string
  sha256: string
  selected: number
  anchor: number
  /** ms since epoch. */
  timestamp: number
}

export function makeDraft(
  key: string, source: string, saved: string, selected: number, anchor: number, timestamp: number,
): Draft {
  return { version: 1, key, source, saved, sha256: sha256Hex(source), selected, anchor, timestamp }
}

/** Parse and verify a stored draft; null if damaged (Hype checks version and sha256). */
export function parseDraft(json: string): Draft | null {
  let raw: Partial<Draft>
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || raw.version !== 1 || typeof raw.key !== 'string' || typeof raw.source !== 'string' ||
      typeof raw.saved !== 'string' || typeof raw.timestamp !== 'number') return null
  if (raw.sha256 !== sha256Hex(raw.source)) return null
  return {
    version: 1, key: raw.key, source: raw.source, saved: raw.saved, sha256: raw.sha256,
    selected: Math.max(0, Math.floor(Number(raw.selected) || 0)),
    anchor: Math.max(0, Math.floor(Number(raw.anchor) || 0)),
    timestamp: raw.timestamp,
  }
}

/** An unsaved draft waiting for the user to restore or discard it. */
export interface PendingRecovery {
  draft: Draft
  /**
   * The saved copy changed since the draft was written (edited elsewhere, or
   * another tab): restoring replaces newer content. Hype warns "file also
   * changed outside Hype".
   */
  conflict: boolean
}

/**
 * Decide whether a draft is worth offering, given what the deck's saved copy
 * contains now. Hype ignores a draft identical to the saved file ("a clean
 * checkpoint is history, not an unsaved draft"); so do we.
 */
export function recoveryFor(draft: Draft | null, currentSaved: string): PendingRecovery | null {
  if (!draft || draft.source === currentSaved) return null
  return { draft, conflict: draft.saved !== currentSaved }
}
