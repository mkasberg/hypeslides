// Import into / export from a presentation, for browsers without folder access.

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { PresentationStore } from './types.ts'
import { OpfsStore } from './opfs.ts'
import { extOf, mediaKind, mimeOf, pickMarkdown, sanitizeFilename } from './common.ts'

/** Flat description of a presentation's files, path relative to the folder root. */
export interface ImportedFile {
  path: string
  data: Blob
}

export class ImportError extends Error {}

// ---------- collecting files from the various sources ----------

/** Walk a dropped DataTransfer (folders via webkitGetAsEntry). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<ImportedFile[]> {
  const entries: FileSystemEntry[] = []
  const loose: File[] = []
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue
    const e = item.webkitGetAsEntry?.()
    if (e) entries.push(e)
    else {
      const f = item.getAsFile()
      if (f) loose.push(f)
    }
  }
  const out: ImportedFile[] = loose.map((f) => ({ path: f.name, data: f }))
  for (const e of entries) await walkEntry(e, '', out)
  return out
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all)
        else {
          all.push(...batch)
          next() // readEntries returns chunks; loop until empty
        }
      }, reject)
    next()
  })
}

async function walkEntry(e: FileSystemEntry, prefix: string, out: ImportedFile[]): Promise<void> {
  if (e.name.startsWith('.')) return
  if (e.isFile) {
    const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej))
    out.push({ path: prefix + e.name, data: file })
  } else if (e.isDirectory) {
    const children = await readAllEntries((e as FileSystemDirectoryEntry).createReader())
    for (const c of children) await walkEntry(c, prefix + e.name + '/', out)
  }
}

/** From `<input type=file webkitdirectory>` or a multi-file input. */
export function filesFromFileList(list: FileList | File[]): ImportedFile[] {
  return Array.from(list).map((f) => ({
    path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    data: f,
  }))
}

/** Unzip an archive into flat files (skips directories and macOS junk). */
export function filesFromZip(bytes: Uint8Array): ImportedFile[] {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (e) {
    throw new ImportError(`Not a valid zip file: ${e instanceof Error ? e.message : e}`)
  }
  const out: ImportedFile[] = []
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue
    out.push({ path, data: new Blob([data as BlobPart], { type: mimeOf(path) }) })
  }
  return out
}

/** Remove a single common top-level folder shared by every path. */
export function stripCommonFolder(files: ImportedFile[]): ImportedFile[] {
  if (files.length === 0) return files
  const firsts = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : null)))
  if (firsts.size !== 1 || firsts.has(null)) return files
  const [top] = [...firsts] as string[]
  return files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }))
}

export interface ImportResult {
  files: ImportedFile[]
  /** Folder name when the source had one (used as the display label). */
  folderName?: string
}

/** Turn any File[] from a file input / drop into ImportedFiles (handles .md or .zip). */
export async function filesFromPickedFiles(files: File[]): Promise<ImportResult> {
  if (files.length === 1 && extOf(files[0].name) === 'zip') {
    const f = files[0]
    return { files: stripCommonFolder(filesFromZip(new Uint8Array(await f.arrayBuffer()))), folderName: f.name.replace(/\.zip$/i, '') }
  }
  const flat = filesFromFileList(files)
  const top = flat[0]?.path.includes('/') ? flat[0].path.split('/')[0] : undefined
  return { files: stripCommonFolder(flat), folderName: top }
}

// ---------- import into OPFS ----------

/** Pure planning step: validate + split into markdown and media. */
export function planImport(files: ImportedFile[]): {
  markdownName: string
  markdown: Blob
  media: ImportedFile[]
} {
  const rootNames = files.filter((f) => !f.path.includes('/')).map((f) => f.path)
  const md = pickMarkdown(rootNames)
  if (!md) throw new ImportError('No .md file found at the top level of the presentation.')
  const markdown = files.find((f) => f.path === md)!.data
  const media: ImportedFile[] = []
  for (const f of files) {
    if (f.path === md) continue
    const parts = f.path.split('/')
    const name = parts[parts.length - 1]
    if (!mediaKind(name)) continue
    // Accept root, images/, videos/ (and, leniently, any nested folder).
    media.push({ path: name, data: f.data })
  }
  return { markdownName: md, markdown, media }
}

/** Replace the OPFS working copy with the given files. */
export async function importFiles(files: ImportedFile[], label?: string): Promise<OpfsStore> {
  const plan = planImport(files)
  const text = await plan.markdown.text()
  const store = await OpfsStore.replaceCurrent(text, { markdownName: plan.markdownName, label })
  await importMedia(store, plan.media)
  return store
}

async function importMedia(store: PresentationStore, media: ImportedFile[]) {
  for (const m of media) await store.writeMedia(m.path, m.data)
}

/** Replace working copy with a lone .md file's text (no media). */
export async function importMarkdownText(name: string, text: string): Promise<OpfsStore> {
  return OpfsStore.replaceCurrent(text, { markdownName: sanitizeFilename(name), label: name.replace(/\.md$/i, '') })
}

/** Convenience: import from a file-picker/drop File[] (.md, .zip, or folder files). */
export async function importPickedFiles(files: File[]): Promise<OpfsStore> {
  const r = await filesFromPickedFiles(files)
  return importFiles(r.files, r.folderName)
}

export async function importDataTransfer(dt: DataTransfer): Promise<OpfsStore> {
  const files = await filesFromDataTransfer(dt)
  if (files.length === 1 && extOf(files[0].path) === 'zip') return importPickedFiles([files[0].data as File])
  const stripped = stripCommonFolder(files)
  const top = files[0]?.path.includes('/') ? files[0].path.split('/')[0] : undefined
  return importFiles(stripped, top)
}

// ---------- export ----------

/** Media filenames from `listMedia()` that the markdown text actually mentions. */
export function referencedMedia(markdown: string, present: string[]): string[] {
  return present.filter(
    (n) => markdown.includes(n) || markdown.includes(encodeURI(n)) || markdown.includes(encodeURIComponent(n)),
  )
}

export interface ExportBundle {
  blob: Blob
  /** Download filename: `<name>.md` or `<name>.zip`. */
  filename: string
}

/** Build the export Blob without touching the DOM. */
export async function buildExport(store: PresentationStore, baseName?: string): Promise<ExportBundle> {
  const base = sanitizeFilename(baseName ?? store.name).replace(/\.(md|zip)$/i, '') || 'presentation'
  const markdown = await store.readMarkdown()
  const media = referencedMedia(markdown, await store.listMedia())
  if (media.length === 0) {
    return { blob: new Blob([markdown], { type: 'text/markdown' }), filename: `${base}.md` }
  }
  const tree: Record<string, Uint8Array> = {
    [`${base}/${store.markdownName}`]: strToU8(markdown),
  }
  for (const name of media) {
    const f = await store.readMedia(name)
    if (!f) continue
    tree[`${base}/${mediaKind(name)}/${name}`] = new Uint8Array(await f.arrayBuffer())
  }
  // Media is already compressed; store without deflate (level 0).
  const zipped = zipSync(tree, { level: 0 })
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), filename: `${base}.zip` }
}

/** Trigger a browser download via a temporary <a download>. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportPresentation(store: PresentationStore, baseName?: string): Promise<void> {
  const { blob, filename } = await buildExport(store, baseName)
  downloadBlob(blob, filename)
}

export { strFromU8 }
