import { useEffect } from 'react'
import { headerOf, title as docTitle } from './core'
import { mediaKind } from './storage'
import { installShortcuts } from './app/shortcuts'
import { isDirty } from './app/store'
import { useApp } from './app/useApp'
import { ConfirmDialog, ShortcutsOverlay } from './ui/Dialogs'
import { PresentView } from './ui/PresentView'
import { TopBar, storageLabel } from './ui/TopBar'
import { MarkdownView, OverviewView, VisualView } from './ui/Views'

function useWindowBehavior() {
  useEffect(() => {
    void useApp.getState().init()
    const unshortcuts = installShortcuts()

    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(useApp.getState())) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    // Pasted image / video files become slide media.
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => mediaKind(f.name || 'image.png') || f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      void useApp.getState().addMediaFiles(files.map((f) => (f.name ? f : new File([f], 'image.png', { type: f.type }))))
    }
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    let depth = 0
    const dragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      useApp.getState().setDropActive(true)
    }
    const dragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      if (--depth <= 0) {
        depth = 0
        useApp.getState().setDropActive(false)
      }
    }
    const dragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      depth = 0
      const s = useApp.getState()
      s.setDropActive(false)
      const dt = e.dataTransfer
      const folder = Array.from(dt.items).some((i) => i.webkitGetAsEntry?.()?.isDirectory)
      const files = Array.from(dt.files)
      if (!folder && files.length && files.every((f) => mediaKind(f.name))) void s.addMediaFiles(files)
      else void s.importDrop(dt)
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('paste', paste)
    window.addEventListener('dragenter', dragEnter)
    window.addEventListener('dragleave', dragLeave)
    window.addEventListener('dragover', dragOver)
    window.addEventListener('drop', drop)
    return () => {
      unshortcuts()
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('paste', paste)
      window.removeEventListener('dragenter', dragEnter)
      window.removeEventListener('dragleave', dragLeave)
      window.removeEventListener('dragover', dragOver)
      window.removeEventListener('drop', drop)
    }
  }, [])
}

export default function App() {
  useWindowBehavior()
  const ready = useApp((s) => s.ready)
  const mode = useApp((s) => s.mode)
  const presenting = useApp((s) => s.presenting)
  const pending = useApp((s) => s.pendingReopen)
  const dropActive = useApp((s) => s.dropActive)
  const store = useApp((s) => s.store)
  const doc = useApp((s) => s.doc)
  const savedSource = useApp((s) => s.savedSource)
  const saving = useApp((s) => s.saving)
  const dirty = isDirty({ doc, savedSource })

  useEffect(() => {
    document.title = `${docTitle(headerOf(doc), store?.name ?? 'Untitled')}${dirty ? ' •' : ''} — HypeSlides`
  }, [doc, store, dirty])

  if (!ready) return <div className="boot">Loading…</div>
  return (
    <div className="app">
      <TopBar />
      {pending && (
        <div className="banner">
          <span>Last time you were editing “{pending.name}”.</span>
          <button type="button" className="btn primary" onClick={() => void useApp.getState().reopen()}>Reopen {pending.name}</button>
        </div>
      )}
      <main className="stage">
        {mode === 'visual' && <VisualView />}
        {mode === 'markdown' && <MarkdownView />}
        {mode === 'overview' && <OverviewView />}
      </main>
      <footer className="footbar">
        <span className="storage-label">{storageLabel({ store, doc, savedSource, saving })}</span>
      </footer>
      {presenting && <PresentView />}
      {dropActive && <div className="drop-overlay">Drop a folder to open it, or an image / video to add it to the slide</div>}
      <ConfirmDialog />
      <ShortcutsOverlay />
    </div>
  )
}
