// Installs an in-memory fake of the File System Access API into the page
// (`window.showDirectoryPicker` returns a memory-backed directory). It runs
// inside the browser, so it must be self-contained. Modeled on
// src/storage/testing/memoryFs.ts.

export interface FakeFsOptions {
  /** Files already in the picked folder: path -> text, or base64 for `{ base64 }`. */
  seed?: Record<string, string | { base64: string }>
  name?: string
}

export function installFakeFs(opts: FakeFsOptions) {
  const enc = new TextEncoder()
  const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

  class FileH {
    kind = 'file' as const
    name: string
    data: Uint8Array<ArrayBuffer> = new Uint8Array(0)
    constructor(name: string) { this.name = name }
    async getFile() {
      return new File([this.data as BlobPart], this.name, { lastModified: Date.now() })
    }
    async createWritable() {
      const chunks: Uint8Array[] = []
      return {
        write: async (d: Blob | string | BufferSource) => {
          if (typeof d === 'string') chunks.push(enc.encode(d))
          else if (d instanceof Blob) chunks.push(new Uint8Array(await d.arrayBuffer()))
          else chunks.push(new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d))
        },
        close: async () => {
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
          let o = 0
          for (const c of chunks) { out.set(c, o); o += c.length }
          this.data = out
        },
        abort: async () => { chunks.length = 0 },
      }
    }
    async queryPermission() { return 'granted' }
    async requestPermission() { return 'granted' }
  }

  class DirH {
    kind = 'directory' as const
    children = new Map<string, FileH | DirH>()
    name: string
    constructor(name: string) { this.name = name }
    async getFileHandle(name: string, o: { create?: boolean } = {}) {
      const e = this.children.get(name)
      if (e) {
        if (e.kind !== 'file') throw new DOMException('Type mismatch', 'TypeMismatchError')
        return e
      }
      if (!o.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      const f = new FileH(name)
      this.children.set(name, f)
      return f
    }
    async getDirectoryHandle(name: string, o: { create?: boolean } = {}) {
      const e = this.children.get(name)
      if (e) {
        if (e.kind !== 'directory') throw new DOMException('Type mismatch', 'TypeMismatchError')
        return e
      }
      if (!o.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      const d = new DirH(name)
      this.children.set(name, d)
      return d
    }
    async removeEntry(name: string) {
      if (!this.children.delete(name)) throw new DOMException(name, 'NotFoundError')
    }
    async *entries() { for (const e of this.children) yield e }
    async *values() { yield* this.children.values() }
    async queryPermission() { return 'granted' }
    async requestPermission() { return 'granted' }
    put(path: string, data: Uint8Array<ArrayBuffer>) {
      const parts = path.split('/')
      // oxlint-disable-next-line typescript/no-this-alias
      let dir: DirH = this
      for (const p of parts.slice(0, -1)) {
        let n = dir.children.get(p)
        if (!n) { n = new DirH(p); dir.children.set(p, n) }
        dir = n as DirH
      }
      const f = new FileH(parts[parts.length - 1])
      f.data = data
      dir.children.set(f.name, f)
    }
    get(path: string) {
      // oxlint-disable-next-line typescript/no-this-alias
      let cur: FileH | DirH | undefined = this
      for (const p of path.split('/')) {
        if (!cur || cur.kind !== 'directory') return undefined
        cur = cur.children.get(p)
      }
      return cur?.kind === 'file' ? cur : undefined
    }
    list(prefix = ''): string[] {
      const out: string[] = []
      for (const [n, c] of this.children) out.push(...(c.kind === 'file' ? [prefix + n] : c.list(prefix + n + '/')))
      return out
    }
  }

  const root = new DirH(opts.name ?? 'e2e-folder')
  for (const [path, v] of Object.entries(opts.seed ?? {})) {
    root.put(path, typeof v === 'string' ? enc.encode(v) : b64(v.base64))
  }
  const w = window as unknown as Record<string, unknown>
  w.showDirectoryPicker = async () => root
  w.__fakeFs = {
    text: (path: string) => { const f = root.get(path); return f ? new TextDecoder().decode(f.data) : null },
    size: (path: string) => root.get(path)?.data.length ?? null,
    list: () => root.list().sort(),
  }
}
