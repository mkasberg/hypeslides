// Low-level file writes shared by the OPFS and File System Access backends and
// by history/draft storage.
//
//  1. If createWritable exists (Chromium, Firefox, recent Safari), use it: atomic
//     swap-file commit.
//  2. Otherwise (older Safari: only worker-side createSyncAccessHandle), post
//     the bytes to a tiny dedicated module worker (opfsWorker.ts). Not atomic,
//     but writes are small and serialized by awaiting each reply.

/** Atomic-ish write: createWritable() buffers into a swap file and commits on close(). */
export async function writeViaWritable(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  try {
    await w.write(data)
    await w.close()
  } catch (e) {
    try {
      await w.abort()
    } catch {
      /* ignore */
    }
    throw e
  }
}

export function hasCreateWritable(): boolean {
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

/** Write through the OPFS worker; `path` is relative to the OPFS root. */
export async function writeViaWorker(path: string[], data: Blob | string): Promise<void> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data).buffer : await data.arrayBuffer()
  const id = nextId++
  await new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, path, data: buf }, [buf as ArrayBuffer])
  })
}

/**
 * Write a file inside an OPFS directory, choosing createWritable when the
 * file handle has it and the worker otherwise.
 */
export async function writeOpfsFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  if (typeof (fh as { createWritable?: unknown }).createWritable === 'function') {
    return writeViaWritable(dir, name, data)
  }
  const root = await navigator.storage.getDirectory()
  const rel = await root.resolve(dir)
  if (!rel) throw new Error('Directory is not inside OPFS')
  return writeViaWorker([...rel, name], data)
}
