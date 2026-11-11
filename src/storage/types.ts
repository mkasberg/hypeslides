// Storage contract. The app never touches browser file APIs directly; it talks
// to a PresentationStore. Two backends implement it:
//
//  - FsAccessStore: Chromium File System Access API. Operates on a real folder
//    on disk (showDirectoryPicker). Autosave writes to disk.
//  - OpfsStore: Origin Private File System working copy for browsers without
//    the pickers (Firefox, Safari). Import copies files in; export downloads
//    the .md or a .zip of the folder.
//
// A presentation folder looks like:
//   presentation.md (any single *.md at the root)
//   images/  videos/

import type { SnapshotInfo } from '../core/history.ts'

export type { SnapshotInfo, SnapshotSource } from '../core/history.ts'

export type StoreKind = 'fs-access' | 'opfs'

export interface PresentationStore {
  readonly kind: StoreKind
  /** Folder name shown in the UI. */
  readonly name: string
  /** Markdown filename within the folder, e.g. `presentation.md`. */
  readonly markdownName: string

  readMarkdown(): Promise<string>
  writeMarkdown(text: string): Promise<void>
  /** Last-modified time of the markdown file (ms), for detecting external edits. */
  markdownModified(): Promise<number>

  /**
   * Resolve a media filename (`city.jpg`) to a File, looking in `images/` or
   * `videos/` by extension, then the folder root. null if missing.
   */
  readMedia(filename: string): Promise<File | null>
  /**
   * Store a media file into `images/` or `videos/` (by extension). Returns the
   * filename actually used (made unique if it already exists).
   */
  writeMedia(filename: string, data: Blob): Promise<string>
  /** All media filenames present (for missing-media checks and export). */
  listMedia(): Promise<string[]>

  /**
   * Stable identifier of this deck for history and crash-recovery drafts:
   * `opfs-current` for the OPFS working copy, `fs-<hash>` for a folder.
   */
  readonly key: string

  // ---- version history (see src/core/history.ts, src/storage/history.ts) ----
  /**
   * Record `text` as a version in OPFS history. Returns null if it equals the
   * newest recorded version. Call before overwriting the markdown. (The
   * File System Access backend also writes `.hype-backups/` itself inside
   * writeMarkdown, as Hype does on save.)
   */
  snapshot(text: string): Promise<SnapshotInfo | null>
  /** All versions (OPFS history merged with the folder's `.hype-backups/`), newest first, deduped by content. */
  listSnapshots(): Promise<SnapshotInfo[]>
  /** The Markdown of a version listed by listSnapshots. Throws if missing. */
  readSnapshot(id: string): Promise<string>
}

/** Feature detection result used by the UI to choose Open/Save vs Import/Export. */
export interface StorageCapabilities {
  /** showDirectoryPicker available: real folders on disk. */
  fsAccess: boolean
  /** navigator.storage.getDirectory available (OPFS working copy). */
  opfs: boolean
}
