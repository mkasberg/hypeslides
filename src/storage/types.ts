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

  /** Version history hook. MVP backends may implement as a no-op. */
  snapshot(text: string): Promise<void>
}

/** Feature detection result used by the UI to choose Open/Save vs Import/Export. */
export interface StorageCapabilities {
  /** showDirectoryPicker available: real folders on disk. */
  fsAccess: boolean
}
