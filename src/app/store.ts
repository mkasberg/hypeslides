// The app store: document state, undo/redo, modes, persistence (autosave,
// external-change reload, open/save/import/export). All document edits go
// through the pure commands in src/core.

import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import {
  addSlide, createState, deleteSlides, duplicateSlides, dropSelection, editSlide, editSource, extendSelection,
  headerOf, makeDraft, matchImageBackground, moveSelection, newDeckSource, parsedDeck, parseSnapshotId, recoveryFor,
  restoreVersion, WELCOME_SLIDE, replaceMedia, select, selectAt,
  setFont, setMediaBackground, setMediaMode, setMediaPosition, setMediaSize, setTheme, slideCount,
  title as docTitle, defaultPasteName, isVideoFile, parseMedia, resolvePasteName, selectedSlide, withReplacedMedia,
} from '../core'
import type { DocState, PendingRecovery } from '../core'
import { createMediaUrlCache, mediaKind } from '../storage'
import type { MediaUrlCache, PresentationStore, SnapshotInfo } from '../storage'
import type { Env } from './env'
import { processPastedMedia } from './imageProcessor'
import type { ProcessHandle, ProcessedMedia } from './imageProcessor'

export type Mode = 'visual' | 'markdown' | 'overview'

/** A pasted file being compressed, or waiting for the user to name it. */
export type PasteJob =
  | { stage: 'processing'; progress: number; video: boolean }
  | { stage: 'naming'; name: string; ext: string; video: boolean; error: string }

export interface DialogAction {
  label: string
  value: string
  primary?: boolean
  danger?: boolean
}
export interface DialogSpec {
  title: string
  message: string
  actions: DialogAction[]
}

const MAX_UNDO = 200
const TYPING_GAP_MS = 1000
const AUTOSAVE_PAUSE_MS = 1000
const AUTOSAVE_MAX_MS = 5000
const POLL_MS = 1000
/** Draft / history key of a deck that has no store yet. */
const UNTITLED_KEY = 'untitled'

export interface AppState {
  ready: boolean
  doc: DocState
  /** The source last loaded from / written to the store (or the initial source of a new deck). */
  savedSource: string
  mode: Mode
  /** The last non-overview mode (what Ctrl+M returns to). */
  prevMode: 'visual' | 'markdown'
  presenting: boolean
  /** Present mode: incremented to toggle video / animation playback. */
  playToggle: number
  store: PresentationStore | null
  /** Chromium: a remembered folder that needs a click to regain permission. */
  pendingReopen: { name: string; handle: FileSystemDirectoryHandle } | null
  media: MediaUrlCache | null
  /** Bumped when media URLs may have changed (new store, replaced file). */
  mediaRev: number
  status: string
  statusFailed: boolean
  undoStack: DocState[]
  redoStack: DocState[]
  dialog: DialogSpec | null
  pasteJob: PasteJob | null
  shortcutsOpen: boolean
  /** The Version history dialog is open. */
  historyOpen: boolean
  /** Presentation theme being hovered in the picker (not saved); null when none. */
  themePreview: string | null
  /** Items per row in Overview (1 elsewhere); used for arrow-key row steps. */
  rowStep: number
  /** Share of the visual column given to the preview. */
  splitRatio: number
  /** Set while a drag of files hovers the window. */
  dropActive: boolean
  /** A save is in flight or scheduled. */
  saving: boolean
  /**
   * An unsaved draft from a previous session (crash/reload) for the open deck, waiting for
   * `recoverDraft()` or `discardDraft()`. While set, new drafts are not written (the old one is kept).
   */
  pendingRecovery: PendingRecovery | null

  init(): Promise<void>
  reopen(): Promise<void>

  // editing
  typeSlide(text: string): void
  typeSource(text: string): void
  run(cmd: (d: DocState) => DocState): void
  select(index: number): void
  extendTo(index: number): void
  selectAtOffset(offset: number): void
  step(delta: number, extend?: boolean): void
  moveBy(delta: number): void
  drop(slot: number): void
  addSlide(): void
  duplicate(): void
  remove(): void
  setTheme(name: string): void
  setThemePreview(name: string | null): void
  setFont(family: string): void
  layout(op: 'mode' | 'background' | 'position' | 'size', value: string | number): void
  addMediaFiles(files: File[]): Promise<void>
  /** Paste one file: compress, prompt for a name, then add it (Hype's paste flow). */
  pasteMedia(file: File): Promise<void>
  submitPasteName(name: string): Promise<void>
  cancelPaste(): void
  undo(): void
  redo(): void

  // version history and crash recovery
  /** Flushes, then lists saved versions of the open deck, newest first. */
  listVersions(): Promise<SnapshotInfo[]>
  /** The Markdown text of a version, or null if it cannot be read. */
  previewVersion(id: string): Promise<string | null>
  /** Restore a version as an undoable edit (the current text is recorded first). */
  restoreVersion(id: string): Promise<boolean>
  /** Apply the pending draft as an undoable edit. */
  recoverDraft(): Promise<void>
  /** Drop the pending draft (its versions stay in history). */
  discardDraft(): Promise<void>

  // modes
  setMode(mode: Mode): void
  toggleOverview(): void
  toggleSource(): void
  present(fromStart?: boolean): void
  stopPresenting(): void
  togglePlay(): void
  setShortcutsOpen(open: boolean): void
  setHistoryOpen(open: boolean): void
  setRowStep(n: number): void
  setSplitRatio(r: number): void
  setDropActive(b: boolean): void

  // files
  newDeck(): Promise<void>
  openFolder(): Promise<void>
  importFiles(files: File[]): Promise<void>
  importDrop(dt: DataTransfer): Promise<void>
  save(): Promise<void>
  saveAs(): Promise<void>
  exportDeck(): Promise<void>
  flush(): Promise<void>
  checkExternal(): Promise<void>

  flash(text: string, failed?: boolean): void
  askConfirm(spec: DialogSpec): Promise<string>
  answerDialog(value: string): void
}

export type AppStore = UseBoundStore<StoreApi<AppState>>

export function isDirty(s: Pick<AppState, 'doc' | 'savedSource'>): boolean {
  return s.doc.source !== s.savedSource
}

/** Pick the slide in `source` that best corresponds to the previously selected slide. */
export function remapSelection(old: DocState, source: string): DocState {
  const next = createState(source)
  const oldSlides = parsedDeck(old).slides
  const newSlides = parsedDeck(next).slides
  const target = oldSlides[old.selected]?.source
  let index = -1
  if (target !== undefined) {
    let best = Infinity
    newSlides.forEach((s, i) => {
      if (s.source === target && Math.abs(i - old.selected) < best) {
        best = Math.abs(i - old.selected)
        index = i
      }
    })
  }
  if (index < 0) {
    // The slide itself changed: align the slides around it with an LCS diff.
    const a = oldSlides.map((x) => x.source)
    const b = newSlides.map((x) => x.source)
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    const pairs = new Map<number, number>()
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (a[i] === b[j]) pairs.set(i++, j++)
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
      else j++
    }
    let before = -1
    for (let i = old.selected - 1; i >= 0 && before < 0; i--) if (pairs.has(i)) before = i
    let after = -1
    for (let i = old.selected + 1; i < a.length && after < 0; i++) if (pairs.has(i)) after = i
    if (before >= 0) index = pairs.get(before)! + (old.selected - before)
    else if (after >= 0) index = pairs.get(after)! - (after - old.selected)
    else index = old.selected
    if (after >= 0) index = Math.min(index, pairs.get(after)! - 1)
  }
  return select(next, index)
}

export function createAppStore(env: Env): AppStore {
  let debounce: ReturnType<typeof setTimeout> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let saveChain: Promise<void> = Promise.resolve()
  let lastModified = 0
  let lastTyping: { at: number; selected: number } | null = null
  /** OPFS holding media added before the deck has a folder; moved into the folder on first save. */
  let pendingMedia: PresentationStore | null = null
  let dialogResolve: ((v: string) => void) | null = null
  let pasteHandle: ProcessHandle | null = null
  let pasteGeneration = 0
  let pasteResult: ProcessedMedia | null = null

  const useApp: AppStore = create<AppState>()((set, get) => {
    const clearTimers = () => {
      if (debounce) clearTimeout(debounce)
      if (deadline) clearTimeout(deadline)
      debounce = deadline = null
    }

    /** Install a new doc, recording undo history when the source changed. */
    const commit = (next: DocState, typing = false) => {
      const s = get()
      if (next === s.doc) return
      if (next.source === s.doc.source) {
        // Selection-only change.
        if (next.selected !== s.doc.selected) lastTyping = null
        set({ doc: next })
        return
      }
      const now = Date.now()
      const coalesce = typing && lastTyping && now - lastTyping.at < TYPING_GAP_MS && lastTyping.selected === s.doc.selected
      const undoStack = coalesce ? s.undoStack : [...s.undoStack, s.doc].slice(-MAX_UNDO)
      lastTyping = typing ? { at: now, selected: s.doc.selected } : null
      set({ doc: next, undoStack, redoStack: [] })
      scheduleAutosave()
    }

    const scheduleAutosave = () => {
      if (!get().store && !env.drafts) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void get().flush(), AUTOSAVE_PAUSE_MS)
      if (!deadline) deadline = setTimeout(() => void get().flush(), AUTOSAVE_MAX_MS)
    }

    const flash = (text: string, failed = false) => {
      if (flashTimer) clearTimeout(flashTimer)
      set({ status: text, statusFailed: failed })
      if (text) flashTimer = setTimeout(() => set({ status: '', statusFailed: false }), failed ? 10000 : 4000)
    }

    // ---- version history and drafts -----------------------------------------
    const untitledHistory = () => env.drafts?.history(UNTITLED_KEY) ?? null

    /** Record `source` as a version (history failures never block editing). */
    const recordVersion = async (source: string, store = get().store) => {
      try {
        if (store) await store.snapshot(source)
        else await untitledHistory()?.snapshot(source)
      } catch {
        /* history is best effort */
      }
    }

    const readVersion = async (store: PresentationStore | null, id: string): Promise<string | null> => {
      const parsed = parseSnapshotId(id)
      if (!parsed) return null
      if (store) return store.readSnapshot(id)
      const history = untitledHistory()
      return parsed.source === 'opfs' && history ? history.read(parsed.file) : null
    }

    /** Persist the unsaved state as a draft, or clear the draft when the deck is clean. */
    const syncDraft = async () => {
      const drafts = env.drafts
      const s = get()
      if (!drafts || s.pendingRecovery) return
      const key = s.store?.key ?? UNTITLED_KEY
      try {
        if (s.doc.source === s.savedSource) await drafts.clear(key)
        else await drafts.write(makeDraft(key, s.doc.source, s.savedSource, s.doc.selected, s.doc.anchor, Date.now()))
      } catch {
        /* best effort */
      }
    }

    /** After loading a deck: offer a leftover unsaved draft from a crash or reload. */
    const checkRecovery = async () => {
      const drafts = env.drafts
      if (!drafts) return
      const store = get().store
      try {
        const draft = await drafts.read(store?.key ?? UNTITLED_KEY)
        if (!draft || get().store !== store) return
        const pending = recoveryFor(draft, get().savedSource)
        if (pending) set({ pendingRecovery: pending })
        else await drafts.clear(draft.key)
      } catch {
        /* best effort */
      }
    }

    const startPolling = () => {
      if (pollTimer || typeof setInterval === 'undefined') return
      pollTimer = setInterval(() => void get().checkExternal(), POLL_MS)
    }

    const dropPending = () => {
      if (!pendingMedia) return
      pendingMedia = null
      void env.clearPending().catch(() => {})
    }

    /** Replace everything with a store's presentation. */
    const loadStore = async (store: PresentationStore, label?: string) => {
      clearTimers()
      dropPending()
      let text = await store.readMarkdown()
      let initialSaved = text
      if (text.trim() === '') {
        // An empty folder / file starts as a fresh deck that autosave then writes.
        text = newDeckSource({ title: store.name || 'Untitled' })
        initialSaved = ''
      }
      get().media?.revokeAll()
      lastModified = await store.markdownModified().catch(() => 0)
      lastTyping = null
      const handle = (store as { root?: FileSystemDirectoryHandle }).root
      if (store.kind === 'fs-access' && handle) void env.remember(handle)
      set({
        store, media: createMediaUrlCache(store), mediaRev: get().mediaRev + 1, doc: createState(text),
        savedSource: initialSaved, undoStack: [], redoStack: [], pendingReopen: null, saving: false,
        pendingRecovery: null,
      })
      // Like Hype's open-time checkpoint: the text as opened is always a version.
      if (initialSaved) await recordVersion(initialSaved, store)
      await checkRecovery()
      if (initialSaved !== text) scheduleAutosave()
      if (label !== undefined) flash(label)
    }

    const newMemoryDeck = (storeNull = true) => {
      clearTimers()
      dropPending()
      get().media?.revokeAll()
      const source = newDeckSource({ title: 'Untitled', body: WELCOME_SLIDE })
      lastTyping = null
      set({
        doc: createState(source), savedSource: source, undoStack: [], redoStack: [],
        pendingRecovery: null,
        ...(storeNull ? { store: null, media: null, mediaRev: get().mediaRev + 1 } : {}),
      })
    }

    /** Before replacing the document: flush to the store, or ask about unsaved memory-only work. */
    const confirmLeave = async (): Promise<boolean> => {
      const s = get()
      if (s.store) {
        await s.flush()
        return true
      }
      if (!isDirty(s)) return true
      const choice = await s.askConfirm({
        title: 'Discard unsaved presentation?',
        message: 'This presentation has not been saved to a folder yet. Opening another one will discard it.',
        actions: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Discard', value: 'discard', danger: true, primary: true },
        ],
      })
      if (choice !== 'discard') return false
      await env.drafts?.clear(UNTITLED_KEY).catch(() => {})
      return true
    }

    const guarded = (fn: (cmd: DocState) => DocState, typing = false) => commit(fn(get().doc), typing)

    return {
      ready: false,
      doc: createState(''),
      savedSource: '',
      mode: 'visual',
      prevMode: 'visual',
      presenting: false,
      playToggle: 0,
      store: null,
      pendingReopen: null,
      media: null,
      mediaRev: 0,
      status: '',
      statusFailed: false,
      undoStack: [],
      redoStack: [],
      dialog: null,
      shortcutsOpen: false,
      historyOpen: false,
      themePreview: null,
      rowStep: 1,
      splitRatio: 0.58,
      dropActive: false,
      pasteJob: null,
      saving: false,
      pendingRecovery: null,

      async init() {
        try {
          if (env.fsAccess) {
            const last = await env.restoreLast()
            if (last) {
              if (last.granted) {
                try {
                  await loadStore(await env.openHandle(last.handle))
                } catch {
                  newMemoryDeck()
                }
              } else {
                newMemoryDeck()
                set({ pendingReopen: { name: last.handle.name, handle: last.handle } })
              }
            } else newMemoryDeck()
          } else {
            const current = await env.openCurrentOpfs()
            if (current) await loadStore(current)
            else {
              const source = newDeckSource({ title: 'Untitled', body: WELCOME_SLIDE })
              const store = await env.createOpfs(source, 'Untitled')
              if (store) {
                await loadStore(store)
                set({ savedSource: source })
              } else newMemoryDeck()
            }
          }
        } catch (e) {
          newMemoryDeck()
          flash(`Could not open the last presentation: ${e instanceof Error ? e.message : e}`, true)
        }
        await checkRecovery()
        set({ ready: true })
        startPolling()
      },

      async reopen() {
        const p = get().pendingReopen
        if (!p) return
        // requestPermission needs the click's user activation: call it first.
        const ok = await env.requestAccess(p.handle)
        if (!ok) return flash('Permission to open the folder was not granted', true)
        try {
          await loadStore(await env.openHandle(p.handle), `Opened ${p.name}`)
        } catch (e) {
          flash(`Could not open ${p.name}: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      // ---- editing ------------------------------------------------------
      typeSlide(text) {
        guarded((d) => editSlide(d, text), true)
      },
      typeSource(text) {
        guarded((d) => editSource(d, text), true)
      },
      run(cmd) {
        guarded(cmd)
      },
      select(index) {
        guarded((d) => select(d, index))
      },
      extendTo(index) {
        guarded((d) => extendSelection(d, index))
      },
      selectAtOffset(offset) {
        guarded((d) => selectAt(d, offset))
      },
      step(delta, extend = false) {
        guarded((d) => {
          const n = slideCount(d)
          const to = Math.max(0, Math.min(n - 1, d.selected + delta))
          return extend ? extendSelection(d, to) : select(d, to)
        })
      },
      moveBy(delta) {
        guarded((d) => {
          const n = slideCount(d)
          const first = Math.min(d.anchor, d.selected)
          const last = Math.max(d.anchor, d.selected)
          if (Math.abs(delta) === 1) return moveSelection(d, delta)
          if (delta < 0 && first > 0) return dropSelection(d, Math.max(0, first + delta))
          if (delta > 0 && last < n - 1) return dropSelection(d, Math.min(n, last + 1 + delta))
          return d
        })
      },
      drop(slot) {
        guarded((d) => dropSelection(d, slot))
      },
      addSlide() {
        guarded(addSlide)
      },
      duplicate() {
        guarded(duplicateSlides)
      },
      remove() {
        guarded(deleteSlides)
      },
      setThemePreview(name) {
        set({ themePreview: name })
      },
      setTheme(name) {
        guarded((d) => setTheme(d, name))
      },
      setFont(family) {
        guarded((d) => setFont(d, family))
      },
      layout(op, value) {
        guarded((d) => {
          if (op === 'mode') return setMediaMode(d, String(value))
          if (op === 'position') return setMediaPosition(d, String(value))
          if (op === 'size') return setMediaSize(d, Number(value))
          return value === 'theme' ? matchImageBackground(d, false) : setMediaBackground(d, String(value))
        })
      },

      async addMediaFiles(files) {
        const { store, media } = get()
        const usable = files.filter((f) => mediaKind(f.name || 'image.png'))
        if (!usable.length) return
        try {
          let target = store ?? pendingMedia
          let cache = media
          if (!target) {
            // No folder yet: hold media in OPFS until the first save.
            target = await env.createPending()
            if (!target) {
              flash('Save the presentation to a folder first (Ctrl+S), then add media.', true)
              return
            }
            pendingMedia = target
            cache = createMediaUrlCache(target)
            set({ media: cache })
          }
          for (let i = 0; i < usable.length; i++) {
            const f = usable[i]
            const name = await target.writeMedia(f.name || 'image.png', f)
            cache?.invalidate(name)
            set({ mediaRev: get().mediaRev + 1 })
            if (i > 0) guarded(addSlide)
            guarded((d) => replaceMedia(d, name))
          }
        } catch (e) {
          flash(`Could not add media: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      async pasteMedia(file) {
        if (get().pasteJob) return
        const generation = ++pasteGeneration
        const video = isVideoFile(file.name)
        set({ pasteJob: { stage: 'processing', progress: 0, video } })
        const slide = selectedSlide(get().doc)
        const span = parseMedia(withReplacedMedia(slide, 'paste.png'))?.span ?? false
        const handle = processPastedMedia(file, span, (progress) => {
          const job = get().pasteJob
          if (generation === pasteGeneration && job?.stage === 'processing') set({ pasteJob: { ...job, progress } })
        })
        pasteHandle = handle
        const result = await handle.promise
        if (generation !== pasteGeneration) return // cancelled: leave the deck untouched
        pasteHandle = null
        pasteResult = result
        set({ pasteJob: { stage: 'naming', name: defaultPasteName(file.name, result.video), ext: result.ext, video: result.video, error: '' } })
      },
      async submitPasteName(input) {
        const job = get().pasteJob
        const result = pasteResult
        if (job?.stage !== 'naming' || !result) return
        let existing: string[] = []
        try {
          existing = (await get().store?.listMedia()) ?? []
        } catch {
          /* collisions are re-checked by the store's unique naming */
        }
        const resolved = resolvePasteName(input, job.ext, existing)
        const current = get().pasteJob
        if (current?.stage !== 'naming') return
        if (!resolved.ok) {
          set({ pasteJob: { ...current, name: input, error: resolved.error } })
          return
        }
        pasteResult = null
        set({ pasteJob: null })
        await get().addMediaFiles([new File([result.blob], resolved.name, { type: result.blob.type })])
      },
      cancelPaste() {
        pasteGeneration++
        pasteHandle?.cancel()
        pasteHandle = null
        pasteResult = null
        set({ pasteJob: null })
      },

      undo() {
        const s = get()
        const prev = s.undoStack[s.undoStack.length - 1]
        if (!prev) return
        lastTyping = null
        set({ doc: prev, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, s.doc] })
        scheduleAutosave()
      },
      redo() {
        const s = get()
        const next = s.redoStack[s.redoStack.length - 1]
        if (!next) return
        lastTyping = null
        set({ doc: next, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, s.doc] })
        scheduleAutosave()
      },

      // ---- version history and crash recovery -----------------------------
      async listVersions() {
        await get().flush()
        const { store } = get()
        try {
          return store ? await store.listSnapshots() : ((await untitledHistory()?.list()) ?? [])
        } catch {
          return []
        }
      },

      async previewVersion(id) {
        try {
          return await readVersion(get().store, id)
        } catch {
          return null
        }
      },

      async restoreVersion(id) {
        const { store } = get()
        try {
          await get().flush()
          // The current text stays in history, so a restore is never destructive.
          await recordVersion(get().doc.source)
          const text = await readVersion(store, id)
          if (text === null) throw new Error('Version not found')
          if (get().store !== store) return false
          lastTyping = null
          commit(restoreVersion(get().doc, text))
          flash('Restored earlier version')
          return true
        } catch (e) {
          flash(`Could not restore that version: ${e instanceof Error ? e.message : e}`, true)
          return false
        }
      },

      async recoverDraft() {
        const pending = get().pendingRecovery
        if (!pending) return
        const { draft, conflict } = pending
        set({ pendingRecovery: null })
        // The draft and (on conflict) the saved copy it replaces both stay in history.
        if (conflict) await recordVersion(get().savedSource)
        await recordVersion(draft.source)
        lastTyping = null
        commit(select(editSource(get().doc, draft.source), draft.selected))
        flash(conflict
          ? 'Recovered your last draft. The saved copy had also changed; it is in Version history.'
          : 'Recovered your last draft')
      },

      async discardDraft() {
        const pending = get().pendingRecovery
        if (!pending) return
        set({ pendingRecovery: null })
        await env.drafts?.clear(pending.draft.key).catch(() => {})
      },

      // ---- modes --------------------------------------------------------
      setMode(mode) {
        set((s) => ({ mode, prevMode: mode === 'overview' ? s.prevMode : mode }))
      },
      toggleOverview() {
        const s = get()
        get().setMode(s.mode === 'overview' ? s.prevMode : 'overview')
      },
      toggleSource() {
        const s = get()
        get().setMode(s.mode === 'markdown' ? 'visual' : 'markdown')
      },
      present(fromStart = false) {
        const s = get()
        if (s.presenting) {
          if (fromStart) get().select(0)
          else set({ presenting: false })
          return
        }
        if (fromStart) get().select(0)
        set({ presenting: true })
      },
      togglePlay: () => set((s) => ({ playToggle: s.playToggle + 1 })),
      stopPresenting() {
        if (get().presenting) set({ presenting: false })
      },
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setHistoryOpen: (open) => set({ historyOpen: open }),
      setRowStep: (n) => set({ rowStep: Math.max(1, n) }),
      setSplitRatio: (r) => set({ splitRatio: Math.max(0.2, Math.min(0.85, r)) }),
      setDropActive: (b) => set({ dropActive: b }),

      // ---- files --------------------------------------------------------
      async newDeck() {
        if (!(await confirmLeave())) return
        if (!env.fsAccess) {
          const source = newDeckSource({ title: 'Untitled', body: WELCOME_SLIDE })
          const store = await env.createOpfs(source, 'Untitled')
          if (store) {
            await loadStore(store)
            set({ savedSource: source })
            return
          }
        }
        newMemoryDeck()
        flash('New presentation. Press Ctrl+S to choose a folder for it.')
      },

      async openFolder() {
        if (!env.fsAccess) return // the UI shows the Import picker instead
        if (!(await confirmLeave())) return
        try {
          const store = await env.openFolder()
          if (store) await loadStore(store, `Opened ${store.name}`)
        } catch (e) {
          flash(`Could not open folder: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      async importFiles(files) {
        if (!files.length || !(await confirmLeave())) return
        try {
          const store = await env.importFiles(files)
          await loadStore(store, `Imported ${store.name}`)
        } catch (e) {
          flash(`Could not import: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      async importDrop(dt) {
        if (!(await confirmLeave())) return
        try {
          const store = await env.importDrop(dt)
          if (store) await loadStore(store, `Opened ${store.name}`)
        } catch (e) {
          flash(`Could not open the dropped files: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      flush() {
        clearTimers()
        saveChain = saveChain.then(async () => {
          const { store, doc } = get()
          // Version and draft first: they survive even if the write below fails or the tab dies.
          if (doc.source !== get().savedSource) await recordVersion(doc.source, store)
          await syncDraft()
          if (!store || doc.source === get().savedSource) return
          const source = doc.source
          set({ saving: true })
          try {
            await store.writeMarkdown(source)
            lastModified = await store.markdownModified().catch(() => lastModified)
            set({ savedSource: source })
          } catch (e) {
            flash(`Save failed: ${e instanceof Error ? e.message : e}`, true)
          } finally {
            set({ saving: false })
          }
          await syncDraft()
          if (get().doc.source !== get().savedSource && get().store === store) scheduleAutosave()
        })
        return saveChain
      },

      async save() {
        const s = get()
        if (s.store) {
          await s.flush()
          if (!isDirty(get())) flash(s.store.kind === 'opfs' ? 'Saved in this browser' : 'Saved')
          return
        }
        if (env.fsAccess) return get().saveAs()
        // No store and no OPFS: fall back to a download.
        await get().exportDeck()
      },

      async saveAs() {
        if (!env.fsAccess) return get().exportDeck()
        const source = get().doc.source
        const old = get().store
        try {
          const res = await env.createFolder(source)
          if (res.status === 'cancelled') return
          let store: PresentationStore
          if (res.status === 'created') store = res.store
          else {
            const choice = await get().askConfirm({
              title: `"${res.folderName}" already has a presentation`,
              message: `The folder already contains ${res.existing}. Open it, or replace it with this presentation?`,
              actions: [
                { label: 'Cancel', value: 'cancel' },
                { label: 'Open existing', value: 'open' },
                { label: 'Replace', value: 'overwrite', danger: true, primary: true },
              ],
            })
            if (choice !== 'open' && choice !== 'overwrite') return
            store = await res.resolve(choice)
            if (choice === 'open') {
              await loadStore(store, `Opened ${store.name}`)
              return
            }
          }
          const from = old ?? pendingMedia
          if (from) {
            for (const name of await from.listMedia().catch(() => [] as string[])) {
              const f = await from.readMedia(name)
              if (f) await store.writeMedia(name, f)
            }
          }
          dropPending()
          const doc = get().doc
          clearTimers()
          get().media?.revokeAll()
          const handle = (store as { root?: FileSystemDirectoryHandle }).root
          if (handle) void env.remember(handle)
          lastModified = await store.markdownModified().catch(() => 0)
          set({ store, media: createMediaUrlCache(store), mediaRev: get().mediaRev + 1, savedSource: source, doc })
          if (!old) await env.drafts?.clear(UNTITLED_KEY).catch(() => {})
          await recordVersion(source, store)
          flash(`Saved to ${store.name}`)
        } catch (e) {
          flash(`Could not save: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      async exportDeck() {
        const { store, doc } = get()
        const name = docTitle(headerOf(doc), store?.name ?? 'Untitled')
        try {
          if (store) {
            await get().flush()
            await env.exportStore(store, name)
          } else env.exportText(doc.source, name)
        } catch (e) {
          flash(`Export failed: ${e instanceof Error ? e.message : e}`, true)
        }
      },

      async checkExternal() {
        const s = get()
        if (!s.store || isDirty(s) || s.saving || debounce) return
        const store = s.store
        let m: number
        try {
          m = await store.markdownModified()
        } catch {
          return
        }
        if (m === lastModified) return
        lastModified = m
        let text: string
        try {
          text = await store.readMarkdown()
        } catch {
          return
        }
        const now = get()
        // Never replace unsaved edits, and ignore a store switch mid-read.
        if (now.store !== store || isDirty(now) || text === now.savedSource) return
        const next = remapSelection(now.doc, text)
        lastTyping = null
        set({
          doc: next, savedSource: text, undoStack: [...now.undoStack, now.doc].slice(-MAX_UNDO), redoStack: [],
        })
        flash('Reloaded changes from disk')
      },

      flash,

      askConfirm(spec) {
        return new Promise<string>((resolve) => {
          dialogResolve?.('cancel')
          dialogResolve = resolve
          set({ dialog: spec })
        })
      },
      answerDialog(value) {
        const r = dialogResolve
        dialogResolve = null
        set({ dialog: null })
        r?.(value)
      },
    }
  })
  return useApp
}
