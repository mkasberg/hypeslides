// The browser-facing seams of the app store. Tests inject fakes (memoryFs);
// the real wiring lives in `realEnv()`.

import {
  FsAccessStore, OpfsStore, capabilities, createPresentationFolder, importDataTransfer, importPickedFiles,
  openFolder, rememberDirectory, DraftStore, opfsPresentationsDir, requestAccess, restoreLast, exportPresentation, downloadBlob,
} from '../storage'
import type { CreateStatus, PresentationStore, RestoredDirectory } from '../storage'
import type { DeckLook } from '../render/rasterize'
import type { PptxExportDeps } from './pptxExport'

export interface Env {
  /** Real folders on disk (File System Access) are available. */
  fsAccess: boolean
  /** Crash-recovery drafts and the history of store-less (untitled) decks; null without OPFS. */
  drafts: DraftStore | null
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
  /** The existing pending-media area (e.g. after a reload), without clearing it; null if none. */
  openPending(): Promise<PresentationStore | null>
  /** Discard the pending-media area. */
  clearPending(): Promise<void>
  importFiles(files: File[]): Promise<PresentationStore>
  /** A drop of a folder / .md / .zip; null if nothing usable. */
  importDrop(dt: DataTransfer): Promise<PresentationStore | null>
  exportStore(store: PresentationStore, name: string): Promise<void>
  exportText(markdown: string, name: string): void
  /** Hand a generated file (an export) to the user: a browser download. */
  downloadFile(blob: Blob, name: string): void
  /** Offscreen slide rendering and media access for PowerPoint export; dispose when done. */
  pptxDeps(look: DeckLook): Promise<PptxExportDeps & { dispose(): void }>
}

export function realEnv(): Env {
  const caps = () => capabilities()
  return {
    get fsAccess() {
      return caps().fsAccess
    },
    get drafts() {
      return caps().opfs ? new DraftStore(opfsPresentationsDir) : null
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
    openPending: async () => (caps().opfs ? OpfsStore.openPending() : null),
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
    downloadFile: downloadBlob,
    async pptxDeps(look) {
      // Loaded on first export: snapdom stays out of the main bundle.
      const { createSlideRasterizer, canvasBlob, toPng, videoFrame } = await import('../render/rasterize')
      const rasterizer = createSlideRasterizer(look)
      return {
        renderSlide: async (source, layer) => {
          const canvas = await rasterizer.render(source, { width: 3840, layer })
          // Slides are opaque: high-quality JPEG, as Hype stores them. The overlay keeps its alpha.
          return layer ? canvasBlob(canvas, 'image/png') : canvasBlob(canvas, 'image/jpeg', 0.92)
        },
        readMedia: async (name) => {
          const url = await look.resolveMedia(name)
          return url ? (await fetch(url)).blob() : null
        },
        videoFrame: async (video) => {
          const url = URL.createObjectURL(video)
          try {
            return await videoFrame(url)
          } finally {
            URL.revokeObjectURL(url)
          }
        },
        toPng,
        dispose: () => rasterizer.dispose(),
      }
    },
  }
}
