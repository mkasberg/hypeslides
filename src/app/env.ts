// The browser-facing seams of the app store. Tests inject fakes (memoryFs);
// the real wiring lives in `realEnv()`.

import {
  FsAccessStore, OpfsStore, capabilities, createPresentationFolder, importDataTransfer, importPickedFiles,
  openFolder, rememberDirectory, requestAccess, restoreLast, exportPresentation, downloadBlob,
} from '../storage'
import type { CreateStatus, PresentationStore, RestoredDirectory } from '../storage'

export interface Env {
  /** Real folders on disk (File System Access) are available. */
  fsAccess: boolean
  restoreLast(): Promise<RestoredDirectory | null>
  requestAccess(handle: FileSystemDirectoryHandle): Promise<boolean>
  openHandle(handle: FileSystemDirectoryHandle): Promise<PresentationStore>
  remember(handle: FileSystemDirectoryHandle): Promise<void>
  /** Folder picker; null if cancelled. */
  openFolder(): Promise<PresentationStore | null>
  createFolder(markdown: string): Promise<CreateStatus>
  /** OPFS working copy (non-Chromium). */
  openCurrentOpfs(): Promise<PresentationStore | null>
  createOpfs(markdown: string, label?: string): Promise<PresentationStore | null>
  /** Fresh OPFS area for media added to a deck with no folder yet; null without OPFS. */
  createPending(): Promise<PresentationStore | null>
  /** Discard the pending-media area. */
  clearPending(): Promise<void>
  importFiles(files: File[]): Promise<PresentationStore>
  /** A drop of a folder / .md / .zip; null if nothing usable. */
  importDrop(dt: DataTransfer): Promise<PresentationStore | null>
  exportStore(store: PresentationStore, name: string): Promise<void>
  exportText(markdown: string, name: string): void
}

export function realEnv(): Env {
  const caps = () => capabilities()
  return {
    get fsAccess() {
      return caps().fsAccess
    },
    restoreLast,
    requestAccess,
    openHandle: (h) => FsAccessStore.fromHandle(h, { createIfMissing: true }),
    remember: (h) => rememberDirectory(h).catch(() => {}),
    openFolder,
    createFolder: createPresentationFolder,
    openCurrentOpfs: () => (caps().opfs ? OpfsStore.openCurrent() : Promise.resolve(null)),
    createOpfs: async (md, label) => (caps().opfs ? OpfsStore.replaceCurrent(md, { label }) : null),
    createPending: async () => (caps().opfs ? OpfsStore.replacePending() : null),
    clearPending: () => OpfsStore.clearPending(),
    importFiles: importPickedFiles,
    async importDrop(dt) {
      if (caps().fsAccess) {
        // Chromium: a dropped folder can become a real, writable folder handle.
        const item = Array.from(dt.items).find((i) => i.kind === 'file')
        const getHandle = (item as unknown as { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> } | undefined)
          ?.getAsFileSystemHandle
        if (item && getHandle) {
          const h = await getHandle.call(item)
          if (h && h.kind === 'directory') {
            const dir = h as FileSystemDirectoryHandle
            if ((await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted') {
              return FsAccessStore.fromHandle(dir, { createIfMissing: true })
            }
          }
        }
      }
      return importDataTransfer(dt)
    },
    exportStore: (s, name) => exportPresentation(s, name),
    exportText: (md, name) => downloadBlob(new Blob([md], { type: 'text/markdown' }), name.replace(/\.md$/i, '') + '.md'),
  }
}
