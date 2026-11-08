import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { MemoryDirHandle, asDirHandle } from './testing/memoryFs.ts'
import { FsAccessStore, NoMarkdownError, createInDirectory } from './fsAccess.ts'
import { OpfsStore } from './opfs.ts'
import { pickMarkdown, uniqueName, mediaKind } from './common.ts'
import {
  buildExport, filesFromZip, planImport, referencedMedia, stripCommonFolder, filesFromFileList,
} from './importExport.ts'
import { createMediaUrlCache } from './mediaUrlCache.ts'
import { forgetDirectory, requestAccess, restoreLast, rememberDirectory } from './recent.ts'

const bytes = (...n: number[]) => new Uint8Array(n)
const text = (u: Uint8Array | undefined) => new TextDecoder().decode(u)

describe('common helpers', () => {
  it('picks markdown', () => {
    expect(pickMarkdown(['b.md', 'a.md', 'x.png'])).toBe('a.md')
    expect(pickMarkdown(['b.md', 'presentation.md', 'a.md'])).toBe('presentation.md')
    expect(pickMarkdown(['x.png'])).toBeUndefined()
  })
  it('classifies media', () => {
    expect(mediaKind('A.JPG')).toBe('images')
    expect(mediaKind('v.webm')).toBe('videos')
    expect(mediaKind('n.txt')).toBeNull()
  })
  it('makes unique names', async () => {
    const taken = new Set(['city.jpg', 'city-2.jpg'])
    expect(await uniqueName('city.jpg', (n) => taken.has(n))).toBe('city-3.jpg')
    expect(await uniqueName('new.png', (n) => taken.has(n))).toBe('new.png')
  })
})

describe('FsAccessStore', () => {
  it('reads/writes markdown and selects the md file', async () => {
    const d = new MemoryDirHandle('talk').put('b.md', 'B').put('a.md', 'A')
    const s = await FsAccessStore.fromHandle(asDirHandle(d))
    expect(s.markdownName).toBe('a.md')
    expect(s.name).toBe('talk')
    expect(await s.readMarkdown()).toBe('A')
    const before = await s.markdownModified()
    await s.writeMarkdown('new')
    expect(text(d.get('a.md'))).toBe('new')
    expect(await s.markdownModified()).toBeGreaterThanOrEqual(before)
  })

  it('throws without md unless createIfMissing', async () => {
    const d = new MemoryDirHandle('empty')
    await expect(FsAccessStore.fromHandle(asDirHandle(d))).rejects.toBeInstanceOf(NoMarkdownError)
    const s = await FsAccessStore.fromHandle(asDirHandle(d), { createIfMissing: true })
    expect(s.markdownName).toBe('presentation.md')
  })

  it('resolves media by extension with root fallback, and lists', async () => {
    const d = new MemoryDirHandle('t')
      .put('presentation.md', '')
      .put('images/a.png', bytes(1))
      .put('videos/v.mp4', bytes(2))
      .put('loose.gif', bytes(3))
    const s = await FsAccessStore.fromHandle(asDirHandle(d))
    expect((await s.readMedia('a.png'))?.size).toBe(1)
    expect((await s.readMedia('v.mp4'))?.size).toBe(1)
    expect((await s.readMedia('loose.gif'))?.size).toBe(1)
    expect(await s.readMedia('nope.png')).toBeNull()
    expect(await s.readMedia('../x.png')).toBeNull()
    expect(await s.listMedia()).toEqual(['a.png', 'loose.gif', 'v.mp4'])
  })

  it('writeMedia creates dirs and uniquifies', async () => {
    const d = new MemoryDirHandle('t').put('presentation.md', '')
    const s = await FsAccessStore.fromHandle(asDirHandle(d))
    expect(await s.writeMedia('city.jpg', new Blob([bytes(1)]))).toBe('city.jpg')
    expect(await s.writeMedia('city.jpg', new Blob([bytes(2, 2)]))).toBe('city-2.jpg')
    expect(await s.writeMedia('clip.mp4', new Blob([bytes(9)]))).toBe('clip.mp4')
    expect(d.get('images/city-2.jpg')).toEqual(bytes(2, 2))
    expect(d.get('videos/clip.mp4')).toEqual(bytes(9))
  })

  it('createInDirectory writes, or reports existing without overwriting', async () => {
    const fresh = new MemoryDirHandle('new')
    const r = await createInDirectory(asDirHandle(fresh), '# hi')
    expect(r.status).toBe('created')
    expect(text(fresh.get('presentation.md'))).toBe('# hi')

    const busy = new MemoryDirHandle('busy').put('old.md', 'OLD')
    const r2 = await createInDirectory(asDirHandle(busy), 'NEW')
    expect(r2.status).toBe('exists')
    expect(text(busy.get('old.md'))).toBe('OLD')
    if (r2.status !== 'exists') throw new Error()
    const opened = await r2.resolve('open')
    expect(await opened.readMarkdown()).toBe('OLD')
    await r2.resolve('overwrite')
    expect(text(busy.get('old.md'))).toBe('NEW')
  })
})

describe('OpfsStore over a fake handle', () => {
  it('behaves like a store', async () => {
    const d = new MemoryDirHandle('current')
    const s = await OpfsStore.fromHandle(asDirHandle(d), 'Label')
    expect(s.kind).toBe('opfs')
    expect(s.name).toBe('Label')
  })
})

describe('import / export', () => {
  const makeStore = async (md: string) => {
    const d = new MemoryDirHandle('My Talk').put('presentation.md', md)
    return { d, s: await FsAccessStore.fromHandle(asDirHandle(d)) }
  }

  it('strips one common folder', () => {
    const f = (path: string) => ({ path, data: new Blob([]) })
    expect(stripCommonFolder([f('t/a.md'), f('t/images/x.png')]).map((x) => x.path)).toEqual(['a.md', 'images/x.png'])
    expect(stripCommonFolder([f('a.md'), f('t/x.png')]).map((x) => x.path)).toEqual(['a.md', 't/x.png'])
  })

  it('uses webkitRelativePath', () => {
    const file = new File(['x'], 'a.md')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'talk/a.md' })
    expect(filesFromFileList([file])[0].path).toBe('talk/a.md')
  })

  it('exports only .md without media', async () => {
    const { s } = await makeStore('# hello')
    const b = await buildExport(s)
    expect(b.filename).toBe('My Talk.md')
    expect(await b.blob.text()).toBe('# hello')
  })

  it('finds referenced media', () => {
    expect(referencedMedia('![](city.jpg) and <a.png>', ['city.jpg', 'a.png', 'unused.png'])).toEqual(['city.jpg', 'a.png'])
  })

  it('zip round trip', async () => {
    const { s } = await makeStore('![](city.jpg)\n\n![](clip.mp4)')
    await s.writeMedia('city.jpg', new Blob([bytes(1, 2)]))
    await s.writeMedia('clip.mp4', new Blob([bytes(3)]))
    await s.writeMedia('orphan.png', new Blob([bytes(4)]))
    const b = await buildExport(s)
    expect(b.filename).toBe('My Talk.zip')
    const entries = unzipSync(new Uint8Array(await b.blob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual([
      'My Talk/images/city.jpg', 'My Talk/presentation.md', 'My Talk/videos/clip.mp4',
    ])

    // Import it again.
    const files = stripCommonFolder(filesFromZip(new Uint8Array(await b.blob.arrayBuffer())))
    const plan = planImport(files)
    expect(plan.markdownName).toBe('presentation.md')
    expect(plan.media.map((m) => m.path).sort()).toEqual(['city.jpg', 'clip.mp4'])
    const dest = new MemoryDirHandle('x')
    const store = await FsAccessStore.create(asDirHandle(dest), await plan.markdown.text())
    for (const m of plan.media) await store.writeMedia(m.path, m.data)
    expect(dest.get('images/city.jpg')).toEqual(bytes(1, 2))
    expect(dest.get('videos/clip.mp4')).toEqual(bytes(3))
  })

  it('rejects zip without md, and ignores macOS junk', () => {
    const z = zipSync({ 'x/a.png': bytes(1), '__MACOSX/x/._a.png': bytes(1) })
    const files = filesFromZip(z)
    expect(files.map((f) => f.path)).toEqual(['x/a.png'])
    expect(() => planImport(stripCommonFolder(files))).toThrow(/No \.md/)
    expect(() => filesFromZip(strToU8('garbage'))).toThrow(/valid zip/)
  })
})

describe('mediaUrlCache', () => {
  it('caches and revokes', async () => {
    const d = new MemoryDirHandle('t').put('presentation.md', '').put('images/a.png', bytes(1))
    const s = await FsAccessStore.fromHandle(asDirHandle(d))
    const created: string[] = []
    const revoked: string[] = []
    const origC = URL.createObjectURL, origR = URL.revokeObjectURL
    let n = 0
    URL.createObjectURL = () => { const u = `blob:${++n}`; created.push(u); return u }
    URL.revokeObjectURL = (u) => { revoked.push(u) }
    try {
      const c = createMediaUrlCache(s)
      const [u1, u2] = await Promise.all([c.resolve('a.png'), c.resolve('a.png')])
      expect(u1).toBe(u2)
      expect(created).toHaveLength(1)
      expect(await c.resolve('missing.png')).toBeNull()
      c.revokeAll()
      await Promise.resolve(); await Promise.resolve()
      expect(revoked).toEqual(['blob:1'])
    } finally {
      URL.createObjectURL = origC
      URL.revokeObjectURL = origR
    }
  })
})

describe('recent', () => {
  it('persists and restores a handle', async () => {
    expect(await restoreLast()).toBeNull()
    // fake-indexeddb structured-clones; use a plain object with permission methods.
    const h = { kind: 'directory', name: 'x', queryPermission: undefined } as unknown as FileSystemDirectoryHandle
    await rememberDirectory(h)
    const r = await restoreLast()
    expect(r?.handle.name).toBe('x')
    expect(r?.granted).toBe(false)
    expect(await requestAccess({ requestPermission: async () => 'granted' } as unknown as FileSystemDirectoryHandle)).toBe(true)
    await forgetDirectory()
    expect(await restoreLast()).toBeNull()
  })
})
