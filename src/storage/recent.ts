// Remember the last-opened directory handle (handles are structured-cloneable
// into IndexedDB) so the app can offer to reopen it.

const DB = 'hype-web'
const STORE = 'handles'
const KEY = 'last-directory'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

export async function rememberDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  await tx('readwrite', (s) => s.put(handle, KEY))
}

export async function forgetDirectory(): Promise<void> {
  await tx('readwrite', (s) => s.delete(KEY))
}

export interface RestoredDirectory {
  handle: FileSystemDirectoryHandle
  /** true if readwrite permission is still granted (can open without a prompt). */
  granted: boolean
}

/** Last remembered directory, or null. Does not prompt. */
export async function restoreLast(): Promise<RestoredDirectory | null> {
  let handle: FileSystemDirectoryHandle | undefined
  try {
    handle = await tx<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY))
  } catch {
    return null
  }
  if (!handle) return null
  let granted = false
  try {
    granted = (await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    /* treat as not granted */
  }
  return { handle, granted }
}

/** Re-grant access. MUST be called from a user gesture (click handler). */
export async function requestAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}
