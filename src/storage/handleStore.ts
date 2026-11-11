import type { PresentationStore, SnapshotInfo, StoreKind } from './types.ts'
import { mergeSnapshots, parseSnapshotId } from '../core/history.ts'
import type { SnapshotArea } from './history.ts'
import { mediaKind, pickMarkdown, sanitizeFilename, uniqueName } from './common.ts'

/**
 * Shared PresentationStore logic over any FileSystemDirectoryHandle (real
 * folder or OPFS). Subclasses supply how bytes get written.
 */
export abstract class HandleStore implements PresentationStore {
  abstract readonly kind: StoreKind
  readonly root: FileSystemDirectoryHandle
  markdownName: string

  /** In-browser (OPFS) version history; null when OPFS is unavailable. */
  protected readonly history: SnapshotArea | null

  protected constructor(root: FileSystemDirectoryHandle, markdownName: string, history: SnapshotArea | null = null) {
    this.root = root
    this.markdownName = markdownName
    this.history = history
  }

  abstract get key(): string

  get name(): string {
    return this.root.name
  }

  /** Write bytes to `dir/name`. Must be atomic where possible. */
  protected abstract writeFile(
    dir: FileSystemDirectoryHandle,
    name: string,
    data: Blob | string,
  ): Promise<void>

  /** Names of files (not dirs) directly in a directory. */
  static async listFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
    const out: string[] = []
    for await (const [name, h] of dir.entries()) if (h.kind === 'file') out.push(name)
    return out
  }

  /** Choose the markdown file in a folder; undefined if none. */
  static async findMarkdown(dir: FileSystemDirectoryHandle): Promise<string | undefined> {
    return pickMarkdown(await HandleStore.listFiles(dir))
  }

  async readMarkdown(): Promise<string> {
    const fh = await this.root.getFileHandle(this.markdownName)
    return (await fh.getFile()).text()
  }

  async writeMarkdown(text: string): Promise<void> {
    await this.writeFile(this.root, this.markdownName, text)
  }

  async markdownModified(): Promise<number> {
    const fh = await this.root.getFileHandle(this.markdownName)
    return (await fh.getFile()).lastModified
  }

  private async tryFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
    try {
      return await (await dir.getFileHandle(name)).getFile()
    } catch {
      return null
    }
  }

  private async tryDir(name: string): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this.root.getDirectoryHandle(name)
    } catch {
      return null
    }
  }

  async readMedia(filename: string): Promise<File | null> {
    if (filename.includes('/') || filename.includes('\\')) return null
    const kind = mediaKind(filename)
    if (kind) {
      const dir = await this.tryDir(kind)
      if (dir) {
        const f = await this.tryFile(dir, filename)
        if (f) return f
      }
    }
    return this.tryFile(this.root, filename)
  }

  async writeMedia(filename: string, data: Blob): Promise<string> {
    const safe = sanitizeFilename(filename)
    const kind = mediaKind(safe)
    const dir = kind
      ? await this.root.getDirectoryHandle(kind, { create: true })
      : this.root
    const name = await uniqueName(safe, async (n) => (await this.tryFile(dir, n)) !== null)
    await this.writeFile(dir, name, data)
    return name
  }

  async listMedia(): Promise<string[]> {
    const out = new Set<string>()
    for (const k of ['images', 'videos'] as const) {
      const dir = await this.tryDir(k)
      if (!dir) continue
      for (const n of await HandleStore.listFiles(dir)) if (mediaKind(n) === k) out.add(n)
    }
    for (const n of await HandleStore.listFiles(this.root)) if (mediaKind(n)) out.add(n)
    return [...out].sort()
  }

  // ---- version history ---------------------------------------------------

  async snapshot(text: string): Promise<SnapshotInfo | null> {
    return (await this.history?.snapshot(text)) ?? null
  }

  /** Versions kept in the presentation folder itself. Folder-backed stores override. */
  protected async listFolderBackups(): Promise<SnapshotInfo[]> {
    return []
  }
  protected async readFolderBackup(_file: string): Promise<string> {
    throw new Error('Version not found')
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const opfs = await (this.history?.list() ?? Promise.resolve([]))
    return mergeSnapshots([opfs, await this.listFolderBackups()])
  }

  async readSnapshot(id: string): Promise<string> {
    const parsed = parseSnapshotId(id)
    if (!parsed) throw new Error('Version not found')
    if (parsed.source === 'opfs') {
      if (!this.history) throw new Error('Version not found')
      return this.history.read(parsed.file)
    }
    return this.readFolderBackup(parsed.file)
  }
}
