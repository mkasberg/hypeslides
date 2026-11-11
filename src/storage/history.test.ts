import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryDirHandle, asDirHandle } from './testing/memoryFs.ts'
import { FsAccessStore } from './fsAccess.ts'
import { OpfsStore } from './opfs.ts'
import { DraftStore, SnapshotArea } from './history.ts'
import { DAY, backupFileName, hash16, makeDraft } from '../core/history.ts'

const names = (d: MemoryDirHandle | undefined) => (d ? [...d.children.keys()].sort() : [])

function fakeOpfs() {
  const root = new MemoryDirHandle('opfs')
  const provider = async (create: boolean) => {
    const existing = root.children.get('presentations')
    if (existing) return asDirHandle(existing as MemoryDirHandle)
    if (!create) throw new DOMException('nope', 'NotFoundError')
    return asDirHandle(await root.getDirectoryHandle('presentations', { create: true }))
  }
  return { root, provider }
}

function clock(start = Date.UTC(2026, 5, 1)) {
  let t = start
  return { now: () => t, tick: (ms = 1000) => { t += ms } }
}

describe('SnapshotArea', () => {
  it('records versions, dedupes the newest, and lists newest first', async () => {
    const { provider } = fakeOpfs()
    const c = clock()
    const area = new SnapshotArea(provider, 'k', c.now)
    expect(await area.list()).toEqual([])
    const a = await area.snapshot('one')
    c.tick()
    expect(await area.snapshot('one')).toBeNull()
    const b = await area.snapshot('two')
    c.tick()
    const again = await area.snapshot('one') // A -> B -> A is a new version
    const list = await area.list()
    expect(list.map((s) => s.hash)).toEqual([again!.hash, b!.hash, a!.hash])
    expect(list[0].source).toBe('opfs')
    expect(list[1].size).toBe(3)
    expect(await area.read(list[1].id.slice('opfs:'.length))).toBe('two')
  })

  it('keeps timestamps strictly increasing even if the clock stalls', async () => {
    const { provider } = fakeOpfs()
    const area = new SnapshotArea(provider, 'k', () => 5000)
    await area.snapshot('a')
    await area.snapshot('b')
    const [b, a] = await area.list()
    expect(b.timestamp).toBeGreaterThan(a.timestamp)
  })

  it('prunes old versions but keeps the newest', async () => {
    const { provider } = fakeOpfs()
    const c = clock()
    const area = new SnapshotArea(provider, 'k', c.now)
    await area.snapshot('old 1')
    c.tick(1000)
    await area.snapshot('old 2') // same hour as old 1
    c.tick(30 * DAY)
    await area.snapshot('new')
    const texts = await Promise.all((await area.list()).map((s) => area.read(s.id.slice(5))))
    expect(texts).toEqual(['new', 'old 2'])
  })

  it('clear removes the deck history', async () => {
    const { provider } = fakeOpfs()
    const area = new SnapshotArea(provider, 'k')
    await area.snapshot('x')
    await area.clear()
    expect(await area.list()).toEqual([])
  })
})

describe('DraftStore', () => {
  it('writes, reads, and clears drafts per key', async () => {
    const { provider, root } = fakeOpfs()
    const drafts = new DraftStore(provider)
    expect(await drafts.read('untitled')).toBeNull()
    const d = makeDraft('untitled', 'unsaved', 'base', 1, 1, 42)
    await drafts.write(d)
    expect(await drafts.read('untitled')).toEqual(d)
    expect(await drafts.read('other')).toBeNull()
    await drafts.clear('untitled')
    expect(await drafts.read('untitled')).toBeNull()
    expect(names(root.children.get('presentations') as MemoryDirHandle)).toContain('drafts')
  })

  it('treats a damaged draft as absent', async () => {
    const { provider, root } = fakeOpfs()
    const drafts = new DraftStore(provider)
    await drafts.write(makeDraft('k', 'text', '', 0, 0, 1))
    const dir = (root.children.get('presentations') as MemoryDirHandle).children.get('drafts') as MemoryDirHandle
    dir.put('k.json', '{"version":1,"truncated')
    expect(await drafts.read('k')).toBeNull()
  })
})

describe('FsAccessStore versions', () => {
  it('writes Hype-style .hype-backups of the replaced file, skipping empty/unchanged', async () => {
    const dir = new MemoryDirHandle('talk').put('presentation.md', 'v1')
    const { provider } = fakeOpfs()
    const s = await FsAccessStore.fromHandle(asDirHandle(dir), { history: provider })
    await s.writeMarkdown('v1') // unchanged: no backup
    expect(dir.children.has('.hype-backups')).toBe(false)
    await s.writeMarkdown('v2')
    const backups = dir.children.get('.hype-backups') as MemoryDirHandle
    const [file] = names(backups)
    expect(file).toMatch(/^presentation\.md\.\d{8}-\d{6}-\d{3}-[0-9a-f]{16}\.bak$/)
    expect(file).toContain(hash16('v1'))
    expect(new TextDecoder().decode(backups.get(file))).toBe('v1')
    expect(new TextDecoder().decode(dir.get('presentation.md'))).toBe('v2')

    const empty = await FsAccessStore.fromHandle(asDirHandle(new MemoryDirHandle('e')), { createIfMissing: true })
    await empty.writeMarkdown('first') // previous is empty: no backup
  })

  it('lists and reads folder backups merged with OPFS history, deduped by content', async () => {
    const dir = new MemoryDirHandle('talk').put('presentation.md', 'v1')
    const { provider } = fakeOpfs()
    const s = await FsAccessStore.fromHandle(asDirHandle(dir), { history: provider })
    await s.snapshot('v1')
    await s.writeMarkdown('v2')
    await s.snapshot('v2')
    // A backup of another markdown file in the folder is not ours.
    dir.put(`.hype-backups/${backupFileName('other.md', 1000, 'a'.repeat(16))}`, 'x')
    dir.put('.hype-backups/notes.txt', 'junk')

    const list = await s.listSnapshots()
    expect(list.map((v) => v.hash)).toEqual([hash16('v2'), hash16('v1')])
    expect(list.every((v) => v.source === 'opfs')).toBe(true) // v1's folder backup merged into the OPFS entry
    expect(await s.readSnapshot(list[1].id)).toBe('v1')

    // Without OPFS history, the folder backup alone is listed and readable.
    const bare = await FsAccessStore.fromHandle(asDirHandle(dir), { history: null })
    const folderOnly = await bare.listSnapshots()
    expect(folderOnly.map((v) => [v.source, v.hash])).toEqual([['folder', hash16('v1')]])
    expect(await bare.readSnapshot(folderOnly[0].id)).toBe('v1')
    expect(await bare.snapshot('x')).toBeNull()
  })

  it('rejects unsafe or unknown ids', async () => {
    const dir = new MemoryDirHandle('talk').put('presentation.md', 'v1')
    const s = await FsAccessStore.fromHandle(asDirHandle(dir), { history: null })
    await expect(s.readSnapshot('folder:../presentation.md')).rejects.toThrow()
    await expect(s.readSnapshot('folder:missing.bak')).rejects.toThrow()
    await expect(s.readSnapshot('opfs:x.md')).rejects.toThrow()
  })

  it('keys folders by name and markdown file', async () => {
    const a = await FsAccessStore.fromHandle(asDirHandle(new MemoryDirHandle('a').put('p.md', '')), { history: null })
    const b = await FsAccessStore.fromHandle(asDirHandle(new MemoryDirHandle('b').put('p.md', '')), { history: null })
    expect(a.key).toMatch(/^fs-[0-9a-f]{16}$/)
    expect(a.key).not.toBe(b.key)
  })
})

describe('OpfsStore versions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('snapshots into OPFS history and never writes .hype-backups', async () => {
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} }) // choose the createWritable path
    const dir = new MemoryDirHandle('current').put('presentation.md', 'v1')
    const { provider } = fakeOpfs()
    const s = await OpfsStore.fromHandle(asDirHandle(dir), 'Mine', provider)
    expect(s.key).toBe('opfs-current')
    await s.snapshot('v1')
    await s.writeMarkdown('v2')
    await s.snapshot('v2')
    expect(dir.children.has('.hype-backups')).toBe(false)
    const list = await s.listSnapshots()
    expect(list).toHaveLength(2)
    expect(await s.readSnapshot(list[0].id)).toBe('v2')
  })

  it('archiveCurrent keeps the old copy and its draft in history, then clears the draft', async () => {
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} })
    const dir = new MemoryDirHandle('current').put('presentation.md', 'saved text')
    const { provider } = fakeOpfs()
    const c = clock()
    const area = new SnapshotArea(provider, 'opfs-current', c.now)
    const drafts = new DraftStore(provider, c.now)
    await area.snapshot('older')
    c.tick()
    await drafts.write(makeDraft('opfs-current', 'unsaved text', 'saved text', 0, 0, c.now()))
    await OpfsStore.archiveCurrent(asDirHandle(dir), area, drafts)
    const texts = await Promise.all((await area.list()).map((v) => area.read(v.id.slice('opfs:'.length))))
    expect(texts.sort()).toEqual(['older', 'saved text', 'unsaved text'])
    expect(await drafts.read('opfs-current')).toBeNull()
  })
})
