// In-memory fake of the File System Access API (directory/file handles), for
// tests and UI development. Implements the subset the storage layer uses.

class NotFound extends Error {
  override name = 'NotFoundError'
}

export class MemoryFileHandle {
  readonly kind = 'file' as const
  data: Uint8Array = new Uint8Array()
  lastModified = Date.now()
  readonly name: string
  constructor(name: string) { this.name = name }

  async getFile(): Promise<File> {
    return new File([this.data as BlobPart], this.name, { lastModified: this.lastModified })
  }

  async createWritable() {
    const chunks: Uint8Array[] = []
    // Buffer until close() so a failed write leaves the old content intact.
    return {
      write: async (d: Blob | string | BufferSource) => {
        if (typeof d === 'string') chunks.push(new TextEncoder().encode(d))
        else if (d instanceof Blob) chunks.push(new Uint8Array(await d.arrayBuffer()))
        else chunks.push(new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d))
      },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const out = new Uint8Array(total)
        let o = 0
        for (const c of chunks) { out.set(c, o); o += c.length }
        this.data = out
        this.lastModified = Date.now()
      },
      abort: async () => { chunks.length = 0 },
    }
  }

  async queryPermission() { return 'granted' as const }
  async requestPermission() { return 'granted' as const }
}

export class MemoryDirHandle {
  readonly kind = 'directory' as const
  readonly children = new Map<string, MemoryFileHandle | MemoryDirHandle>()
  readonly name: string
  constructor(name: string) { this.name = name }

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MemoryFileHandle> {
    const e = this.children.get(name)
    if (e) {
      if (e.kind !== 'file') throw new DOMException('Type mismatch', 'TypeMismatchError')
      return e
    }
    if (!opts.create) throw new DOMException(`${name} not found`, 'NotFoundError')
    const f = new MemoryFileHandle(name)
    this.children.set(name, f)
    return f
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MemoryDirHandle> {
    const e = this.children.get(name)
    if (e) {
      if (e.kind !== 'directory') throw new DOMException('Type mismatch', 'TypeMismatchError')
      return e
    }
    if (!opts.create) throw new DOMException(`${name} not found`, 'NotFoundError')
    const d = new MemoryDirHandle(name)
    this.children.set(name, d)
    return d
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new NotFound(name)
  }

  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirHandle]> {
    for (const e of this.children) yield e
  }
  async *values() {
    for (const v of this.children.values()) yield v
  }

  async queryPermission() { return 'granted' as const }
  async requestPermission() { return 'granted' as const }

  /** Test helper: create a file at a `/`-separated path with text or bytes. */
  put(path: string, content: string | Uint8Array): this {
    const parts = path.split('/')
    // Walks down from this directory; the cursor starts at `this`.
    // oxlint-disable-next-line no-this-alias
    let dir: MemoryDirHandle = this
    for (const p of parts.slice(0, -1)) {
      let next = dir.children.get(p)
      if (!next) { next = new MemoryDirHandle(p); dir.children.set(p, next) }
      dir = next as MemoryDirHandle
    }
    const f = new MemoryFileHandle(parts[parts.length - 1])
    f.data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    dir.children.set(f.name, f)
    return this
  }

  /** Test helper: read file bytes at a path, or undefined. */
  get(path: string): Uint8Array | undefined {
    // oxlint-disable-next-line no-this-alias
    let cur: MemoryFileHandle | MemoryDirHandle | undefined = this
    for (const p of path.split('/')) {
      if (!cur || cur.kind !== 'directory') return undefined
      cur = cur.children.get(p)
    }
    return cur?.kind === 'file' ? cur.data : undefined
  }
}

/** Cast helper: the fake is structurally enough for the stores. */
export function asDirHandle(d: MemoryDirHandle): FileSystemDirectoryHandle {
  return d as unknown as FileSystemDirectoryHandle
}
