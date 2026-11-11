// In-browser version history and crash-recovery drafts, kept in OPFS under
// `presentations/` (siblings of `current/`; never inside a presentation folder):
//
//   presentations/history/<key>/<stamp>-<hash16>.md   one file per distinct version
//   presentations/drafts/<key>.json                   latest unsaved state (see core Draft)
//
// `<key>` identifies a deck: `untitled` (new deck with no store), `opfs-current`
// (the non-Chromium working copy) or `fs-<hash>` (a Chromium folder, hashed from
// folder name + markdown name). Naming, dedupe and pruning rules are pure and
// live in src/core/history.ts.

import {
  hash16, parseDraft, parseSnapshotFileName, parseSnapshotId, selectPrunable, snapshotFileName,
  snapshotId,
} from '../core/history.ts'
import type { Draft, SnapshotInfo } from '../core/history.ts'
import { writeOpfsFile } from './writeFile.ts'

/**
 * Yields the directory that holds `history/` and `drafts/` (OPFS
 * `presentations/`). With create=false it may throw NotFoundError.
 */
export type DirProvider = (create: boolean) => Promise<FileSystemDirectoryHandle>

/** Real provider: `presentations/` in this origin's OPFS. */
export const opfsPresentationsDir: DirProvider = async (create) => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('presentations', { create })
}

async function tryDir(
  from: DirProvider, path: string[], create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    let dir = await from(create)
    for (const seg of path) dir = await dir.getDirectoryHandle(seg, { create })
    return dir
  } catch (e) {
    if (create) throw e
    return null
  }
}

async function removeQuietly(dir: FileSystemDirectoryHandle, name: string, recursive = false) {
  try {
    await dir.removeEntry(name, recursive ? { recursive: true } : undefined)
  } catch {
    /* already gone */
  }
}

/** The version history of one deck in OPFS. */
export class SnapshotArea {
  private readonly provider: DirProvider
  readonly key: string
  private readonly now: () => number

  constructor(provider: DirProvider, key: string, now: () => number = Date.now) {
    this.provider = provider
    this.key = key
    this.now = now
  }

  private dir(create: boolean) {
    return tryDir(this.provider, ['history', this.key], create)
  }

  /**
   * Record `text` as a version. Returns null when it equals the newest version
   * (dedupe, like Hype skipping an unchanged checkpoint). Old versions are
   * pruned afterwards (see selectPrunable).
   */
  async snapshot(text: string): Promise<SnapshotInfo | null> {
    const dir = (await this.dir(true))!
    const hash = hash16(text)
    const existing = await this.list()
    const newest = existing[0]
    if (newest && newest.hash === hash) return null
    // Timestamps are the ordering key: keep them strictly increasing.
    const timestamp = Math.max(this.now(), (newest?.timestamp ?? 0) + 1)
    const file = snapshotFileName(timestamp, hash)
    await writeOpfsFile(dir, file, text)
    const info: SnapshotInfo = {
      id: snapshotId('opfs', file), timestamp, size: new TextEncoder().encode(text).length,
      source: 'opfs', hash,
    }
    for (const id of selectPrunable([info, ...existing], this.now())) {
      const f = parseSnapshotId(id)
      if (f) await removeQuietly(dir, f.file)
    }
    return info
  }

  /** Versions, newest first. */
  async list(): Promise<SnapshotInfo[]> {
    const dir = await this.dir(false)
    if (!dir) return []
    const out: SnapshotInfo[] = []
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file') continue
      const parsed = parseSnapshotFileName(name)
      if (!parsed) continue
      const size = (await (h as FileSystemFileHandle).getFile()).size
      out.push({ id: snapshotId('opfs', name), size, source: 'opfs', ...parsed })
    }
    return out.sort((a, b) => b.timestamp - a.timestamp)
  }

  async read(file: string): Promise<string> {
    const dir = await this.dir(false)
    if (!dir) throw new Error('Version not found')
    return (await (await dir.getFileHandle(file)).getFile()).text()
  }

  async clear(): Promise<void> {
    const dir = await tryDir(this.provider, ['history'], false)
    if (dir) await removeQuietly(dir, this.key, true)
  }
}

/** Crash-recovery drafts, one per deck key. */
export class DraftStore {
  private readonly provider: DirProvider
  private readonly now: () => number

  constructor(provider: DirProvider, now: () => number = Date.now) {
    this.provider = provider
    this.now = now
  }

  /** The version history for a deck key. */
  history(key: string): SnapshotArea {
    return new SnapshotArea(this.provider, key, this.now)
  }

  async write(draft: Draft): Promise<void> {
    const dir = (await tryDir(this.provider, ['drafts'], true))!
    await writeOpfsFile(dir, `${draft.key}.json`, JSON.stringify(draft))
  }

  /** The stored draft; null if none or damaged (checksum mismatch). */
  async read(key: string): Promise<Draft | null> {
    const dir = await tryDir(this.provider, ['drafts'], false)
    if (!dir) return null
    try {
      const text = await (await (await dir.getFileHandle(`${key}.json`)).getFile()).text()
      const draft = parseDraft(text)
      return draft && draft.key === key ? draft : null
    } catch {
      return null
    }
  }

  async clear(key: string): Promise<void> {
    const dir = await tryDir(this.provider, ['drafts'], false)
    if (dir) await removeQuietly(dir, `${key}.json`)
  }
}
