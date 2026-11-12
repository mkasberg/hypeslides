// OpfsStore: a working copy of a presentation inside the Origin Private File
// System, at `presentations/current/`. Used where there are no pickers
// (Firefox, Safari): import copies files in, export downloads them out.
//
// Write strategy (robustness across browsers):
//  1. If FileSystemFileHandle.prototype.createWritable exists (Chromium,
//     Firefox, recent Safari), use it: atomic swap-file commit.
//  2. Otherwise (older Safari: only worker-side createSyncAccessHandle), post
//     the bytes to a tiny dedicated module worker (opfsWorker.ts) that writes
//     through a sync access handle. Not atomic, but writes are small and
//     serialized by awaiting each reply.
// If neither works, writes throw and the UI should surface the error; there is
// intentionally no IndexedDB fallback, to keep one code path over directory
// handles.

import type { StoreKind } from './types.ts'
import { HandleStore } from './handleStore.ts'
import { DraftStore, SnapshotArea, opfsPresentationsDir } from './history.ts'
import type { DirProvider } from './history.ts'
import { hasCreateWritable, writeViaWorker, writeViaWritable } from './writeFile.ts'

const BASE = 'presentations'
const CURRENT = 'current'
const PENDING = 'pending-media'
/** Deck key (history, drafts) of the single OPFS working copy. */
export const OPFS_KEY = 'opfs-current'

function defaultHistory(provider?: DirProvider | null): SnapshotArea | null {
  const p = provider === undefined ? (hasOpfs() ? opfsPresentationsDir : null) : provider
  return p ? new SnapshotArea(p, OPFS_KEY) : null
}

export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function currentDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const base = await root.getDirectoryHandle(BASE, { create })
  return base.getDirectoryHandle(CURRENT, { create })
}

export class OpfsStore extends HandleStore {
  readonly kind: StoreKind = 'opfs'
  private opfsRoot: FileSystemDirectoryHandle | null = null
  private label: string

  private constructor(
    root: FileSystemDirectoryHandle, markdownName: string, label: string, history: SnapshotArea | null,
  ) {
    super(root, markdownName, history)
    this.label = label
  }

  override get key(): string {
    return OPFS_KEY
  }

  override get name(): string {
    return this.label
  }

  protected async writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
    if (hasCreateWritable()) return writeViaWritable(dir, name, data)
    this.opfsRoot ??= await navigator.storage.getDirectory()
    const rel = await this.opfsRoot.resolve(dir)
    if (!rel) throw new Error('Directory is not inside OPFS')
    return writeViaWorker([...rel, name], data)
  }

  /** Is there a working copy to resume? */
  static async exists(): Promise<boolean> {
    try {
      return (await HandleStore.findMarkdown(await currentDir(false))) !== undefined
    } catch {
      return false
    }
  }

  /** Open the existing working copy, or null if there is none. */
  static async openCurrent(label = 'Untitled'): Promise<OpfsStore | null> {
    try {
      const dir = await currentDir(false)
      const md = await HandleStore.findMarkdown(dir)
      return md ? new OpfsStore(dir, md, label, defaultHistory()) : null
    } catch {
      return null
    }
  }

  /**
   * Replace the working copy with a fresh empty one containing `markdown`
   * (named `markdownName`). Callers then `writeMedia` as needed.
   */
  static async replaceCurrent(
    markdown: string,
    opts: { markdownName?: string; label?: string } = {},
  ): Promise<OpfsStore> {
    const root = await navigator.storage.getDirectory()
    const base = await root.getDirectoryHandle(BASE, { create: true })
    // The old working copy is the only copy on these browsers: keep it restorable from
    // Version history (and any unsaved draft with it) instead of deleting history.
    await OpfsStore.archiveCurrent()
    try {
      await base.removeEntry(CURRENT, { recursive: true })
    } catch {
      /* none yet */
    }
    const dir = await base.getDirectoryHandle(CURRENT, { create: true })
    const store = new OpfsStore(dir, opts.markdownName ?? 'presentation.md', opts.label ?? 'Untitled', defaultHistory())
    await store.writeMarkdown(markdown)
    return store
  }

  /**
   * A fresh, empty OPFS area (`presentations/pending-media/`) holding media for
   * a deck that has no folder yet. Any leftovers are discarded. Only the media
   * half of the store is used (the markdown file is never written).
   */
  static async replacePending(): Promise<OpfsStore> {
    await OpfsStore.clearPending()
    const root = await navigator.storage.getDirectory()
    const base = await root.getDirectoryHandle(BASE, { create: true })
    const dir = await base.getDirectoryHandle(PENDING, { create: true })
    return new OpfsStore(dir, 'presentation.md', 'Untitled', null)
  }

  /** The existing pending-media area, untouched (e.g. to go with a recovered draft); null if none. */
  static async openPending(): Promise<OpfsStore | null> {
    try {
      const root = await navigator.storage.getDirectory()
      const base = await root.getDirectoryHandle(BASE)
      const dir = await base.getDirectoryHandle(PENDING)
      return new OpfsStore(dir, 'presentation.md', 'Untitled', null)
    } catch {
      return null
    }
  }

  static async clearPending(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory()
      const base = await root.getDirectoryHandle(BASE)
      await base.removeEntry(PENDING, { recursive: true })
    } catch {
      /* nothing pending */
    }
  }

  /**
   * Record the current working copy's text (and unsaved draft) in history, then clear the
   * draft. Best effort; the draft is only cleared once it has been snapshotted.
   */
  static async archiveCurrent(
    dir?: FileSystemDirectoryHandle | null, history?: SnapshotArea | null, drafts?: DraftStore,
  ): Promise<void> {
    try {
      const hist = history === undefined ? defaultHistory() : history
      const draftStore = drafts ?? new DraftStore(opfsPresentationsDir)
      if (!hist) return
      const cur = dir === undefined ? await currentDir(false).catch(() => null) : dir
      const md = cur ? await HandleStore.findMarkdown(cur) : undefined
      if (cur && md) {
        const text = await (await (await cur.getFileHandle(md)).getFile()).text()
        if (text.trim()) await hist.snapshot(text)
      }
      const draft = await draftStore.read(OPFS_KEY)
      if (draft) {
        if (draft.source.trim()) await hist.snapshot(draft.source)
        await draftStore.clear(OPFS_KEY)
      }
    } catch {
      /* history is best effort */
    }
  }

  /** Test seam: wrap any directory handle (e.g. an in-memory fake). */
  static async fromHandle(
    dir: FileSystemDirectoryHandle, label?: string, history?: DirProvider | null,
  ): Promise<OpfsStore> {
    const md = (await HandleStore.findMarkdown(dir)) ?? 'presentation.md'
    return new OpfsStore(dir, md, label ?? dir.name, defaultHistory(history))
  }
}
