import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryDirHandle, asDirHandle } from '../storage/testing/memoryFs'
import { DraftStore, FsAccessStore, OpfsStore } from '../storage'
import type { CreateStatus, PresentationStore } from '../storage'
import { createAppStore, isDirty, remapSelection } from './store'
import type { Env } from './env'
import { createState, hash16, makeDraft, parsedDeck } from '../core'

const deckOf = (...slides: string[]) => slides.map((s) => s + '\n').join('\n---\n\n')

function fakeEnv(over: Partial<Env> = {}): Env {
  return {
    fsAccess: true,
    drafts: null,
    restoreLast: async () => null,
    requestAccess: async () => true,
    openHandle: (h) => FsAccessStore.fromHandle(h, { createIfMissing: true }),
    remember: async () => {},
    openFolder: async () => null,
    createFolder: async () => ({ status: 'cancelled' }) as CreateStatus,
    openCurrentOpfs: async () => null,
    createOpfs: async () => null,
    createPending: async () => null,
    openPending: async () => null,
    clearPending: async () => {},
    importFiles: async () => { throw new Error('no') },
    importDrop: async () => null,
    exportStore: async () => {},
    exportText: () => {},
    ...over,
  }
}

async function storeWith(text: string) {
  const dir = new MemoryDirHandle('talk').put('presentation.md', text)
  return { dir, store: await FsAccessStore.fromHandle(asDirHandle(dir)) }
}

const read = (dir: MemoryDirHandle) => new TextDecoder().decode(dir.get('presentation.md'))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('startup', () => {
  it('chromium without a remembered folder starts a new unsaved deck', async () => {
    const app = createAppStore(fakeEnv())
    await app.getState().init()
    const s = app.getState()
    expect(s.ready).toBe(true)
    expect(s.store).toBeNull()
    expect(s.doc.source).toContain('# HypeSlides\n\n* Simple Markdown presentations')
    expect(isDirty(s)).toBe(false)
  })

  it('reopens a granted folder', async () => {
    const dir = asDirHandle(new MemoryDirHandle('talk').put('presentation.md', deckOf('# A', '# B')))
    const app = createAppStore(fakeEnv({ restoreLast: async () => ({ handle: dir, granted: true }) }))
    await app.getState().init()
    expect(app.getState().store?.name).toBe('talk')
    expect(app.getState().doc.source).toContain('# B')
  })

  it('offers a Reopen button when permission is not granted, then loads on click', async () => {
    const dir = asDirHandle(new MemoryDirHandle('talk').put('presentation.md', deckOf('# A')))
    const requestAccess = vi.fn(async () => true)
    const app = createAppStore(fakeEnv({ restoreLast: async () => ({ handle: dir, granted: false }), requestAccess }))
    await app.getState().init()
    expect(app.getState().pendingReopen?.name).toBe('talk')
    expect(app.getState().store).toBeNull()
    await app.getState().reopen()
    expect(requestAccess).toHaveBeenCalled()
    expect(app.getState().pendingReopen).toBeNull()
    expect(app.getState().store?.name).toBe('talk')
  })

  it('non-chromium resumes the OPFS working copy', async () => {
    const dir = new MemoryDirHandle('current').put('presentation.md', deckOf('# Hi'))
    const store = await OpfsStore.fromHandle(asDirHandle(dir), 'Mine')
    const app = createAppStore(fakeEnv({ fsAccess: false, openCurrentOpfs: async () => store }))
    await app.getState().init()
    expect(app.getState().store?.kind).toBe('opfs')
    expect(app.getState().doc.source).toContain('# Hi')
  })

  it('non-chromium creates a working copy when none exists', async () => {
    const dir = new MemoryDirHandle('current')
    const createOpfs = vi.fn(async (md: string) => {
      dir.put('presentation.md', md)
      return OpfsStore.fromHandle(asDirHandle(dir), 'Untitled')
    })
    const app = createAppStore(fakeEnv({ fsAccess: false, createOpfs }))
    await app.getState().init()
    expect(createOpfs).toHaveBeenCalled()
    expect(app.getState().store?.kind).toBe('opfs')
    expect(isDirty(app.getState())).toBe(false)
  })
})

describe('undo / redo', () => {
  it('coalesces consecutive typing into one undo entry', async () => {
    const app = createAppStore(fakeEnv())
    await app.getState().init()
    const base = app.getState().doc
    const slide = '# Hello'
    for (const t of ['# Hello a', '# Hello ab', '# Hello abc']) {
      app.getState().typeSlide(t)
      vi.advanceTimersByTime(200)
    }
    expect(app.getState().undoStack).toHaveLength(1)
    // After a pause, typing starts a new entry.
    vi.advanceTimersByTime(1500)
    app.getState().typeSlide('# Hello abcd')
    expect(app.getState().undoStack).toHaveLength(2)
    app.getState().undo()
    expect(app.getState().doc.source).toContain('# Hello abc')
    app.getState().undo()
    expect(app.getState().doc.source).toBe(base.source)
    expect(slide).toBe('# Hello')
    app.getState().redo()
    expect(app.getState().doc.source).toContain('# Hello abc')
    expect(app.getState().redoStack).toHaveLength(1)
  })

  it('structure commands are separate entries and clear redo', async () => {
    const app = createAppStore(fakeEnv())
    await app.getState().init()
    app.getState().addSlide()
    app.getState().addSlide()
    expect(app.getState().undoStack).toHaveLength(2)
    app.getState().undo()
    expect(app.getState().redoStack).toHaveLength(1)
    app.getState().duplicate()
    expect(app.getState().redoStack).toHaveLength(0)
  })

  it('selection changes are not history entries', async () => {
    const app = createAppStore(fakeEnv())
    await app.getState().init()
    app.getState().addSlide()
    app.getState().select(0)
    expect(app.getState().undoStack).toHaveLength(1)
  })
})

describe('autosave', () => {
  it('saves one second after typing pauses', async () => {
    const { dir, store } = await storeWith(deckOf('# A'))
    const app = createAppStore(fakeEnv({ restoreLast: async () => ({ handle: asDirHandle(dir), granted: true }) }))
    await app.getState().init()
    expect(app.getState().store?.name).toBe(store.name)
    app.getState().typeSlide('# A!')
    await vi.advanceTimersByTimeAsync(900)
    expect(read(dir)).not.toContain('A!')
    await vi.advanceTimersByTimeAsync(200)
    expect(read(dir)).toContain('# A!')
    expect(isDirty(app.getState())).toBe(false)
  })

  it('saves at least every five seconds while typing continues', async () => {
    const { dir } = await storeWith(deckOf('# A'))
    const app = createAppStore(fakeEnv({ restoreLast: async () => ({ handle: asDirHandle(dir), granted: true }) }))
    await app.getState().init()
    let t = ''
    for (let i = 0; i < 9; i++) {
      t += 'x'
      app.getState().typeSlide('# A' + t)
      await vi.advanceTimersByTimeAsync(500)
    }
    // 4.5 s elapsed: nothing yet.
    expect(read(dir)).not.toContain('# Ax')
    await vi.advanceTimersByTimeAsync(600)
    expect(read(dir)).toContain('# Axxx')
  })

  it('does not save without a store', async () => {
    const app = createAppStore(fakeEnv())
    await app.getState().init()
    app.getState().typeSlide('# changed')
    await vi.advanceTimersByTimeAsync(10000)
    expect(isDirty(app.getState())).toBe(true)
  })
})

describe('external changes', () => {
  const setup = async (text: string) => {
    const { dir } = await storeWith(text)
    const app = createAppStore(fakeEnv({ restoreLast: async () => ({ handle: asDirHandle(dir), granted: true }) }))
    await app.getState().init()
    return { dir, app }
  }
  const touch = (dir: MemoryDirHandle, text: string) => {
    dir.put('presentation.md', text)
    const f = dir.children.get('presentation.md') as { lastModified: number }
    f.lastModified += 5000
  }

  it('reloads a clean document and keeps the same slide when slides are inserted before it', async () => {
    const { dir, app } = await setup(deckOf('# A', '# B', '# C'))
    app.getState().select(1)
    touch(dir, deckOf('# New', '# A', '# B', '# C'))
    await app.getState().checkExternal()
    const s = app.getState()
    expect(parsedDeck(s.doc).slides).toHaveLength(4)
    expect(s.doc.selected).toBe(2)
    expect(isDirty(s)).toBe(false)
    s.undo()
    expect(app.getState().doc.source).toContain('# B')
    expect(parsedDeck(app.getState().doc).slides).toHaveLength(3)
  })

  it('keeps position when the selected slide itself was edited', async () => {
    const { dir, app } = await setup(deckOf('# A', '# B', '# C'))
    app.getState().select(2)
    touch(dir, deckOf('# X', '# A', '# B', '# C changed'))
    await app.getState().checkExternal()
    expect(app.getState().doc.selected).toBe(3)
  })

  it('never replaces unsaved edits', async () => {
    const { dir, app } = await setup(deckOf('# A'))
    app.getState().typeSlide('# mine')
    touch(dir, deckOf('# theirs'))
    await app.getState().checkExternal()
    expect(app.getState().doc.source).toContain('# mine')
  })

  it('polls about once a second', async () => {
    const { dir, app } = await setup(deckOf('# A'))
    touch(dir, deckOf('# A', '# B'))
    await vi.advanceTimersByTimeAsync(1100)
    expect(parsedDeck(app.getState().doc).slides).toHaveLength(2)
  })
})

describe('remapSelection', () => {
  it('prefers the nearest identical slide', () => {
    const old = { ...createState(deckOf('# A', '# A', '# B')), selected: 1, anchor: 1 }
    expect(remapSelection(old, deckOf('# A', '# A', '# A', '# B')).selected).toBe(1)
  })
})

describe('save flows', () => {
  it('Ctrl+S on a new deck creates a folder and keeps the document', async () => {
    const dir = new MemoryDirHandle('fresh')
    const createFolder = async (md: string): Promise<CreateStatus> => {
      const store = await FsAccessStore.create(asDirHandle(dir), md)
      return { status: 'created', store }
    }
    const app = createAppStore(fakeEnv({ createFolder }))
    await app.getState().init()
    app.getState().typeSlide('# My talk')
    await app.getState().save()
    expect(app.getState().store?.name).toBe('fresh')
    expect(read(dir)).toContain('# My talk')
    expect(isDirty(app.getState())).toBe(false)
  })

  it('handles an existing presentation through the in-app dialog', async () => {
    const dir = new MemoryDirHandle('busy').put('old.md', deckOf('# Old'))
    const createFolder = async (): Promise<CreateStatus> => ({
      status: 'exists',
      folderName: 'busy',
      existing: 'old.md',
      resolve: async (c) =>
        c === 'open' ? FsAccessStore.fromHandle(asDirHandle(dir)) : FsAccessStore.create(asDirHandle(dir), 'new', 'old.md'),
    })
    const app = createAppStore(fakeEnv({ createFolder }))
    await app.getState().init()
    const p = app.getState().save()
    await vi.advanceTimersByTimeAsync(0)
    expect(app.getState().dialog?.title).toContain('busy')
    app.getState().answerDialog('open')
    await p
    expect(app.getState().doc.source).toContain('# Old')
    expect(app.getState().store?.markdownName).toBe('old.md')
  })

  it('addMediaFiles stores the file and replaces slide media', async () => {
    const { dir } = await storeWith(deckOf('# A'))
    const app = createAppStore(fakeEnv({ restoreLast: async () => ({ handle: asDirHandle(dir), granted: true }) }))
    await app.getState().init()
    await app.getState().addMediaFiles([new File([new Uint8Array([1, 2])], 'pic.png', { type: 'image/png' })])
    expect(dir.get('images/pic.png')).toBeDefined()
    expect(app.getState().doc.source).toContain('pic.png')
  })

  describe('media on an unsaved deck', () => {
    const png = (n: number, name = 'pic.png') => new File([new Uint8Array([n])], name, { type: 'image/png' })

    it('is held in pending storage, renders, and is written into the folder on first save', async () => {
      const pending = new MemoryDirHandle('pending')
      const dir = new MemoryDirHandle('fresh')
      const clearPending = vi.fn(async () => {})
      const createFolder = async (md: string): Promise<CreateStatus> => ({
        status: 'created', store: await FsAccessStore.create(asDirHandle(dir), md),
      })
      const app = createAppStore(fakeEnv({
        createFolder, clearPending,
        createPending: async () => FsAccessStore.fromHandle(asDirHandle(pending), { createIfMissing: true }),
      }))
      await app.getState().init()
      await app.getState().addMediaFiles([png(1), png(2)])
      expect(app.getState().store).toBeNull()
      expect(app.getState().media).not.toBeNull()
      expect(pending.get('images/pic.png')).toEqual(new Uint8Array([1]))
      expect(pending.get('images/pic-2.png')).toEqual(new Uint8Array([2]))
      expect(app.getState().doc.source).toContain('pic-2.png')
      expect(dir.get('images/pic.png')).toBeUndefined()

      await app.getState().save()
      expect(dir.get('images/pic.png')).toEqual(new Uint8Array([1]))
      expect(dir.get('images/pic-2.png')).toEqual(new Uint8Array([2]))
      expect(clearPending).toHaveBeenCalled()
      expect(app.getState().store?.name).toBe('fresh')
    })

    it('still complains when there is no pending storage', async () => {
      const app = createAppStore(fakeEnv())
      await app.getState().init()
      const before = app.getState().doc.source
      await app.getState().addMediaFiles([png(1)])
      expect(app.getState().doc.source).toBe(before)
      expect(app.getState().statusFailed).toBe(true)
    })

    it('Save As on a saved deck still copies its media', async () => {
      const { dir } = await storeWith(deckOf('# A'))
      const dest = new MemoryDirHandle('copy')
      const createFolder = async (md: string): Promise<CreateStatus> => ({
        status: 'created', store: await FsAccessStore.create(asDirHandle(dest), md),
      })
      const app = createAppStore(fakeEnv({ createFolder, restoreLast: async () => ({ handle: asDirHandle(dir), granted: true }) }))
      await app.getState().init()
      await app.getState().addMediaFiles([png(7)])
      await app.getState().saveAs()
      expect(dest.get('images/pic.png')).toEqual(new Uint8Array([7]))
    })
  })
})

it('type check helper', () => {
  const s: PresentationStore | null = null
  expect(s).toBeNull()
})

describe('version history and crash recovery', () => {
  const opfs = () => {
    const root = new MemoryDirHandle('opfs')
    const provider = async (create: boolean) => asDirHandle(await root.getDirectoryHandle('presentations', { create }))
    return { provider, drafts: new DraftStore(provider) }
  }
  const flushAll = async (app: ReturnType<typeof createAppStore>) => { await app.getState().flush() }
  /** An app whose remembered folder is `dir`, opened through `store`. */
  const appOn = (drafts: DraftStore, dir: MemoryDirHandle, store: () => Promise<PresentationStore>) =>
    createAppStore(fakeEnv({
      drafts, restoreLast: async () => ({ handle: asDirHandle(dir), granted: true }), openHandle: store,
    }))

  it('persists an unsaved untitled deck as a draft and offers it after a "crash"', async () => {
    const { drafts } = opfs()
    const first = createAppStore(fakeEnv({ drafts }))
    await first.getState().init()
    first.getState().typeSource('# My unsaved idea\n')
    await vi.advanceTimersByTimeAsync(1100) // autosave debounce writes the draft
    expect((await drafts.read('untitled'))?.source).toBe('# My unsaved idea\n')

    const second = createAppStore(fakeEnv({ drafts }))
    await second.getState().init()
    const pending = second.getState().pendingRecovery
    expect(pending?.draft.source).toBe('# My unsaved idea\n')
    expect(pending?.conflict).toBe(false)
    expect(second.getState().doc.source).not.toContain('My unsaved idea')

    await second.getState().recoverDraft()
    expect(second.getState().pendingRecovery).toBeNull()
    expect(second.getState().doc.source).toBe('# My unsaved idea\n')
    second.getState().undo() // recovery is a normal undoable edit
    expect(second.getState().doc.source).toContain('HypeSlides')
  })

  it('recovering an untitled draft reattaches its pending media; discarding clears it', async () => {
    const { drafts } = opfs()
    const pending = new MemoryDirHandle('pending')
    const pendingStore = () => FsAccessStore.fromHandle(asDirHandle(pending), { createIfMissing: true })
    const clearPending = vi.fn(async () => {})
    const env = () => fakeEnv({ drafts, clearPending, createPending: pendingStore, openPending: pendingStore })
    const first = createAppStore(env())
    await first.getState().init()
    await first.getState().addMediaFiles([new File([new Uint8Array([7])], 'pic.png', { type: 'image/png' })])
    await flushAll(first)
    expect(pending.get('images/pic.png')).toEqual(new Uint8Array([7]))

    const second = createAppStore(env())
    await second.getState().init()
    expect(second.getState().media).toBeNull()
    await second.getState().recoverDraft()
    expect(second.getState().doc.source).toContain('pic.png')
    expect(second.getState().media).not.toBeNull()

    const third = createAppStore(env())
    await third.getState().init()
    await third.getState().discardDraft()
    expect(clearPending).toHaveBeenCalled()
  })

  it('discardDraft clears the draft for good', async () => {
    const { drafts } = opfs()
    const first = createAppStore(fakeEnv({ drafts }))
    await first.getState().init()
    first.getState().typeSource('# Draft\n')
    await flushAll(first)
    const second = createAppStore(fakeEnv({ drafts }))
    await second.getState().init()
    await second.getState().discardDraft()
    expect(second.getState().pendingRecovery).toBeNull()
    expect(await drafts.read('untitled')).toBeNull()
    const third = createAppStore(fakeEnv({ drafts }))
    await third.getState().init()
    expect(third.getState().pendingRecovery).toBeNull()
  })

  it('a clean save leaves no draft, and a draft equal to the saved file is dropped', async () => {
    const { drafts, provider } = opfs()
    const dir = new MemoryDirHandle('talk').put('presentation.md', deckOf('# A'))
    const store = await FsAccessStore.fromHandle(asDirHandle(dir), { history: provider })
    const app = appOn(drafts, dir, async () => store)
    await app.getState().init()
    app.getState().typeSource(deckOf('# A', '# B'))
    await vi.advanceTimersByTimeAsync(1100)
    expect(read(dir)).toContain('# B')
    expect(await drafts.read(store.key)).toBeNull()

    await drafts.write(makeDraft(store.key, read(dir), '', 0, 0, 1))
    const again = appOn(drafts, dir, async () => store)
    await again.getState().init()
    expect(again.getState().pendingRecovery).toBeNull()
    expect(await drafts.read(store.key)).toBeNull()
  })

  it('keeps a draft when the folder write fails, and flags a changed file as a conflict', async () => {
    const { drafts, provider } = opfs()
    const dir = new MemoryDirHandle('talk').put('presentation.md', deckOf('# A'))
    const open = () => FsAccessStore.fromHandle(asDirHandle(dir), { history: provider })
    const real = await open()
    const failing: PresentationStore = Object.create(real, {
      writeMarkdown: { value: async () => { throw new Error('disk full') } },
    })
    const app = appOn(drafts, dir, async () => failing)
    await app.getState().init()
    app.getState().typeSource(deckOf('# A', '# Lost?'))
    await vi.advanceTimersByTimeAsync(1100)
    expect((await drafts.read(real.key))?.source).toContain('# Lost?')
    expect(read(dir)).not.toContain('Lost?')

    // The file is edited elsewhere before the next session.
    dir.put('presentation.md', deckOf('# A', '# Changed elsewhere'))
    const app2 = appOn(drafts, dir, open)
    await app2.getState().init()
    expect(app2.getState().pendingRecovery?.conflict).toBe(true)
    await app2.getState().recoverDraft()
    expect(app2.getState().doc.source).toContain('# Lost?')
    // The copy the draft replaces is kept in history.
    const hashes = (await app2.getState().listVersions()).map((v) => v.hash)
    expect(hashes).toContain(hash16(deckOf('# A', '# Changed elsewhere')))
  })

  it('lists versions and restores one as an undoable edit, recording the current text first', async () => {
    const { drafts, provider } = opfs()
    const dir = new MemoryDirHandle('talk').put('presentation.md', deckOf('# One'))
    const store = await FsAccessStore.fromHandle(asDirHandle(dir), { history: provider })
    const app = appOn(drafts, dir, async () => store)
    await app.getState().init()
    app.getState().typeSource(deckOf('# Two'))
    await flushAll(app)
    app.getState().typeSource(deckOf('# Three'))
    await flushAll(app)
    const versions = await app.getState().listVersions()
    expect(versions.map((v) => v.hash)).toEqual([deckOf('# Three'), deckOf('# Two'), deckOf('# One')].map(hash16))

    app.getState().typeSource(deckOf('# Unsaved tail')) // restore must not lose this
    expect(await app.getState().restoreVersion(versions[2].id)).toBe(true)
    expect(app.getState().doc.source).toBe(deckOf('# One'))
    app.getState().undo()
    expect(app.getState().doc.source).toBe(deckOf('# Unsaved tail'))
    expect((await app.getState().listVersions()).map((v) => v.hash)).toContain(hash16(deckOf('# Unsaved tail')))
    expect(await app.getState().restoreVersion('opfs:nope.md')).toBe(false)
  })

  it('untitled decks have a history too', async () => {
    const { drafts } = opfs()
    const app = createAppStore(fakeEnv({ drafts }))
    await app.getState().init()
    app.getState().typeSource('# First\n')
    await flushAll(app)
    app.getState().typeSource('# Second\n')
    await flushAll(app)
    const versions = await app.getState().listVersions()
    expect(versions).toHaveLength(2)
    await app.getState().restoreVersion(versions[1].id)
    expect(app.getState().doc.source).toBe('# First\n')
  })
})
