import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryDirHandle, asDirHandle } from '../storage/testing/memoryFs'
import { FsAccessStore, OpfsStore } from '../storage'
import type { CreateStatus, PresentationStore } from '../storage'
import { createAppStore, isDirty, remapSelection } from './store'
import type { Env } from './env'
import { createState, parsedDeck } from '../core'

const deckOf = (...slides: string[]) => slides.map((s) => s + '\n').join('\n---\n\n')

function fakeEnv(over: Partial<Env> = {}): Env {
  return {
    fsAccess: true,
    restoreLast: async () => null,
    requestAccess: async () => true,
    openHandle: (h) => FsAccessStore.fromHandle(h, { createIfMissing: true }),
    remember: async () => {},
    openFolder: async () => null,
    createFolder: async () => ({ status: 'cancelled' }) as CreateStatus,
    openCurrentOpfs: async () => null,
    createOpfs: async () => null,
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
})

it('type check helper', () => {
  const s: PresentationStore | null = null
  expect(s).toBeNull()
})
