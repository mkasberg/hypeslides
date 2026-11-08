import type { StoreKind } from './types.ts'
import { HandleStore } from './handleStore.ts'

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

export class FsAccessStore extends HandleStore {
  readonly kind: StoreKind = 'fs-access'

  private constructor(root: FileSystemDirectoryHandle, markdownName: string) {
    super(root, markdownName)
  }

  protected writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
    return writeViaWritable(dir, name, data)
  }

  /**
   * Open a store on a directory. If the folder has no .md and `createIfMissing`
   * is set, `presentation.md` is created empty; otherwise throws NoMarkdownError.
   */
  static async fromHandle(
    handle: FileSystemDirectoryHandle,
    opts: { createIfMissing?: boolean } = {},
  ): Promise<FsAccessStore> {
    let md = await HandleStore.findMarkdown(handle)
    if (!md) {
      if (!opts.createIfMissing) throw new NoMarkdownError(handle.name)
      md = 'presentation.md'
      await writeViaWritable(handle, md, '')
    }
    return new FsAccessStore(handle, md)
  }

  /** Create a store in a folder with an explicit markdown name (writes initial text). */
  static async create(
    handle: FileSystemDirectoryHandle,
    initialMarkdown: string,
    markdownName = 'presentation.md',
  ): Promise<FsAccessStore> {
    await writeViaWritable(handle, markdownName, initialMarkdown)
    return new FsAccessStore(handle, markdownName)
  }
}

export class NoMarkdownError extends Error {
  folderName: string
  constructor(folderName: string) {
    super(`No .md file found in "${folderName}"`)
    this.folderName = folderName
    this.name = 'NoMarkdownError'
  }
}

export function hasDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Is this error the user dismissing a picker? */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

/**
 * Show the folder picker (readwrite) and open it. Returns null if the user
 * cancels. Must be called from a user gesture. If the folder has no .md, one
 * (`presentation.md`, empty) is created.
 */
export async function openFolder(): Promise<FsAccessStore | null> {
  const handle = await pickDirectory()
  return handle ? FsAccessStore.fromHandle(handle, { createIfMissing: true }) : null
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new Error('showDirectoryPicker is not supported')
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: 'hype-presentation' })
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

export type CreateStatus =
  | { status: 'created'; store: FsAccessStore }
  | { status: 'cancelled' }
  /**
   * The chosen folder already has a markdown file. Nothing was written. The UI
   * should ask the user, then call `resolve('open')` to open the existing
   * presentation, `resolve('overwrite')` to replace it, or just discard.
   */
  | {
      status: 'exists'
      folderName: string
      existing: string
      resolve(choice: 'open' | 'overwrite'): Promise<FsAccessStore>
    }

/** Core of createPresentationFolder, taking an already-picked directory (testable). */
export async function createInDirectory(
  handle: FileSystemDirectoryHandle,
  initialMarkdown: string,
): Promise<CreateStatus> {
  const existing = await HandleStore.findMarkdown(handle)
  if (existing) {
    return {
      status: 'exists',
      folderName: handle.name,
      existing,
      resolve: (choice) =>
        choice === 'open'
          ? FsAccessStore.fromHandle(handle)
          : FsAccessStore.create(handle, initialMarkdown, existing),
    }
  }
  return { status: 'created', store: await FsAccessStore.create(handle, initialMarkdown) }
}

/**
 * "Save a new presentation": the user picks a (preferably empty) folder and
 * `presentation.md` is written into it. Never overwrites silently, see CreateStatus.
 */
export async function createPresentationFolder(initialMarkdown: string): Promise<CreateStatus> {
  const handle = await pickDirectory()
  if (!handle) return { status: 'cancelled' }
  return createInDirectory(handle, initialMarkdown)
}

/**
 * Optional: open a single .md via showOpenFilePicker. Returns the file only;
 * a lone FileSystemFileHandle cannot resolve sibling media (no parent access),
 * so folder opening is the primary flow.
 */
export async function openMarkdownFile(): Promise<{ handle: FileSystemFileHandle; text: string } | null> {
  if (!window.showOpenFilePicker) throw new Error('showOpenFilePicker is not supported')
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    })
    return { handle, text: await (await handle.getFile()).text() }
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}
