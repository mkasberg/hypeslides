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
import { writeViaWritable } from './fsAccess.ts'

const BASE = 'presentations'
const CURRENT = 'current'
const PENDING = 'pending-media'

export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

function hasCreateWritable(): boolean {
  return (
    typeof FileSystemFileHandle !== 'undefined' &&
    typeof (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable === 'function'
  )
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve(): void; reject(e: Error): void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./opfsWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
      const p = pending.get(ev.data.id)
      if (!p) return
      pending.delete(ev.data.id)
      if (ev.data.ok) p.resolve()
      else p.reject(new Error(ev.data.error))
    }
  }
  return worker
}

async function writeViaWorker(path: string[], data: Blob | string): Promise<void> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data).buffer : await data.arrayBuffer()
  const id = nextId++
  await new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, path, data: buf }, [buf as ArrayBuffer])
  })
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

  private constructor(root: FileSystemDirectoryHandle, markdownName: string, label: string) {
    super(root, markdownName)
    this.label = label
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
      return md ? new OpfsStore(dir, md, label) : null
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
    try {
      await base.removeEntry(CURRENT, { recursive: true })
    } catch {
      /* none yet */
    }
    const dir = await base.getDirectoryHandle(CURRENT, { create: true })
    const store = new OpfsStore(dir, opts.markdownName ?? 'presentation.md', opts.label ?? 'Untitled')
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
    return new OpfsStore(dir, 'presentation.md', 'Untitled')
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

  /** Test seam: wrap any directory handle (e.g. an in-memory fake). */
  static async fromHandle(dir: FileSystemDirectoryHandle, label?: string): Promise<OpfsStore> {
    const md = (await HandleStore.findMarkdown(dir)) ?? 'presentation.md'
    return new OpfsStore(dir, md, label ?? dir.name)
  }
}
