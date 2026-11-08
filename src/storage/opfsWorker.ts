/// <reference lib="webworker" />
// Dedicated worker used by OpfsStore on browsers whose main-thread OPFS file
// handles lack createWritable() (older Safari). createSyncAccessHandle() is
// available in workers everywhere OPFS is.

interface SyncHandle {
  truncate(size: number): void
  write(buf: ArrayBufferView, opts?: { at?: number }): number
  flush(): void
  close(): void
}

self.onmessage = async (ev: MessageEvent<{ id: number; path: string[]; data: ArrayBuffer }>) => {
  const { id, path, data } = ev.data
  try {
    let dir = await navigator.storage.getDirectory()
    for (const seg of path.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true })
    const fh = await dir.getFileHandle(path[path.length - 1], { create: true })
    const sync = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()
    try {
      sync.truncate(0)
      sync.write(new Uint8Array(data), { at: 0 })
      sync.flush()
    } finally {
      sync.close()
    }
    self.postMessage({ id, ok: true })
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e) })
  }
}
