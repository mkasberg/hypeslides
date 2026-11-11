import { useEffect, useRef, useState } from 'react'
import { hash16 } from '../core'
import type { SnapshotInfo } from '../core'
import { useApp } from '../app/useApp'
import type { PasteJob } from '../app/store'

export function ConfirmDialog() {
  const dialog = useApp((s) => s.dialog)
  const answer = useApp((s) => s.answerDialog)
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!dialog) return
    primary.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        answer('cancel')
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [dialog, answer])
  if (!dialog) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && answer('cancel')}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="dialog-actions">
          {dialog.actions.map((a) => (
            <button
              key={a.value}
              ref={a.primary ? primary : undefined}
              type="button"
              className={'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '')}
              onClick={() => answer(a.value)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'File',
    rows: [
      ['Ctrl+N', 'New presentation'],
      ['Ctrl+O', 'Open folder / import'],
      ['Ctrl+S / Ctrl+Shift+S', 'Save / save as'],
      ['Ctrl+E', 'Export (.md or .zip)'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Ctrl+M', 'Overview on / off'],
      ['Ctrl+.', 'Markdown source on / off'],
      ['Tab / Shift+Tab', 'Switch between sidebar and Markdown input'],
      ['? / F1', 'Show all shortcuts (F1 also works while typing)'],
    ],
  },
  {
    title: 'Format',
    rows: [
      ['Ctrl+B / Ctrl+I / Ctrl+U', 'Bold / italic / underline'],
      ['Ctrl+H / Ctrl+K / Ctrl+/', 'Headline / code block / hidden comment'],
      ['Ctrl+V', 'Paste text or add media'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ],
  },
  {
    title: 'Slides',
    rows: [
      ['Arrow keys', 'Previous / next slide (up / down move by a row in Overview)'],
      ['Enter', 'Open the selected slide from Overview'],
      ['Page Up / Page Down', 'Jump five slides, or five rows in Overview'],
      ['Home / End', 'First / last slide'],
      ['Shift+arrows / Shift+click', 'Extend the slide selection'],
      ['Ctrl+Up / Ctrl+Left', 'Move selected slides earlier'],
      ['Ctrl+Down / Ctrl+Right', 'Move selected slides later'],
      ['Ctrl+Page Up / Page Down', 'Move selected slides five places'],
      ['Ctrl+Home / Ctrl+End', 'Move selected slides to the beginning / end'],
      ['Ctrl+Up / Down while typing', 'Previous / next slide without moving it'],
      ['Ctrl+Page Up / Down while typing', 'Slide five earlier / later'],
      ['Ctrl+Enter', 'Add a slide'],
      ['Ctrl+D', 'Duplicate selected slides'],
      ['Delete', 'Delete selected slides'],
    ],
  },
  {
    title: 'Present',
    rows: [
      ['Ctrl+Space / F5', 'Toggle presentation'],
      ['Shift+F5', 'Start from the first slide'],
      ['Space', 'Play / pause video (otherwise next slide)'],
      ['Escape', 'Leave presentation'],
    ],
  },
]

export function ShortcutsOverlay() {
  const open = useApp((s) => s.shortcutsOpen)
  const close = () => useApp.getState().setShortcutsOpen(false)
  if (!open) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="btn" onClick={close}>Close</button>
        </div>
        <p className="muted">Browsers reserve some combinations (Ctrl+N, Ctrl+W, Ctrl+T); everything is also in the menus.</p>
        <div className="shortcut-grid">
          {SECTIONS.map((sec) => (
            <section key={sec.title}>
              <h3>{sec.title}</h3>
              {sec.rows.map(([k, d]) => (
                <div className="sc-row" key={k + d}>
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Pasted media: a progress bar with Cancel while compressing, then the name prompt (Hype's pasteDialog). */
export function PasteDialog() {
  const job = useApp((s) => s.pasteJob)
  const cancel = useApp((s) => s.cancelPaste)
  const stage = job?.stage
  useEffect(() => {
    if (!stage) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [stage, cancel])
  if (!job) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      {job.stage === 'processing' ? <ProgressBody progress={job.progress} /> : <NameBody job={job} />}
    </div>
  )
}

function ProgressBody({ progress }: { progress: number }) {
  const cancel = useApp((s) => s.cancelPaste)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus(), [])
  return (
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="paste-title">
      <h2 id="paste-title">Compressing image…</h2>
      <progress aria-label="Compressing image" max={1} value={progress} />
      <div className="dialog-actions">
        <button ref={button} type="button" className="btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  )
}

function NameBody({ job }: { job: Extract<PasteJob, { stage: 'naming' }> }) {
  const submit = useApp((s) => s.submitPasteName)
  const cancel = useApp((s) => s.cancelPaste)
  const [name, setName] = useState(job.name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const noun = job.video ? 'video' : 'image'
  return (
    <form
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paste-title"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) void submit(name)
      }}
    >
      <h2 id="paste-title">Paste {noun}</h2>
      <p className="sub">Save to {job.video ? 'videos' : 'images'}/</p>
      <div className="name-row">
        <input ref={input} aria-label="Filename" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="ext">.{job.ext}</span>
      </div>
      {job.error && <p className="field-error" role="alert">{job.error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={cancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!name.trim()}>Save {noun}</button>
      </div>
    </form>
  )
}

/** Local time as Hype shows it: yyyy-MM-dd HH:mm:ss. */
function formatLocal(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

/** Escape closes a modal dialog (capturing, so editor shortcuts do not see it). */
function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onEscape()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [active, onEscape])
}

/** File menu -> Version history…: pick an earlier version and restore it (undoable). */
export function VersionHistoryDialog() {
  const open = useApp((s) => s.historyOpen)
  if (!open) return null
  return <VersionHistoryBody />
}

function VersionHistoryBody() {
  const close = () => useApp.getState().setHistoryOpen(false)
  const [versions, setVersions] = useState<SnapshotInfo[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = useRef<string | null>(null)
  const currentHash = hash16(useApp.getState().doc.source)
  const showSource = useApp((s) => s.store?.kind === 'fs-access')

  useEffect(() => {
    let live = true
    void useApp.getState().listVersions().then((v) => live && setVersions(v))
    return () => { live = false }
  }, [])
  useEscape(true, close)

  const pick = (id: string) => {
    live.current = id
    setSelected(id)
    setPreview(null)
    void useApp.getState().previewVersion(id).then((t) => { if (live.current === id) setPreview(t ?? '(could not read this version)') })
  }
  const restore = async () => {
    if (!selected || busy) return
    setBusy(true)
    const ok = await useApp.getState().restoreVersion(selected)
    setBusy(false)
    if (ok) close()
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog history" role="dialog" aria-modal="true" aria-labelledby="hist-title">
        <h2 id="hist-title">Version history</h2>
        <p className="muted">Choose a version to restore. Your current version stays in history.</p>
        <div className="history-body">
          <div className="history-list" role="listbox" aria-label="Versions">
            {versions === null && <div className="muted history-empty">Loading…</div>}
            {versions?.length === 0 && <div className="muted history-empty">No earlier versions yet</div>}
            {versions?.map((v) => (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={v.id === selected}
                className={'history-row' + (v.id === selected ? ' on' : '')}
                onClick={() => pick(v.id)}
              >
                <span className="history-time">{formatLocal(v.timestamp)}</span>
                <span className="muted history-meta">
                  {v.hash === currentHash ? 'Current · ' : ''}
                  {showSource ? (v.source === 'folder' ? 'Folder backup · ' : 'Browser copy · ') : ''}
                  {formatSize(v.size)}
                </span>
              </button>
            ))}
          </div>
          <pre className="history-preview" aria-label="Preview of the selected version">
            {selected ? (preview ?? 'Loading…') : 'Select a version to preview it.'}
          </pre>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={!selected || busy} onClick={() => void restore()}>Restore</button>
        </div>
      </div>
    </div>
  )
}

/** Startup prompt for an unsaved draft left by a crash or reload. */
export function RecoveryDialog() {
  const pending = useApp((s) => s.pendingRecovery)
  const name = useApp((s) => s.store?.name ?? 'Untitled')
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (pending) primary.current?.focus() }, [pending])
  if (!pending) return null
  const { draft, conflict } = pending
  const app = useApp.getState()
  return (
    <div className="scrim">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="rec-title">
        <h2 id="rec-title">Recover unsaved changes?</h2>
        <p>
          HypeSlides found unsaved changes to “{name}” from {formatLocal(draft.timestamp)}, probably from a crash or an
          accidental reload.
          {conflict ? ' The saved copy has also changed since then; it is kept in Version history if you recover.' : ''}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => void app.discardDraft()}>Discard</button>
          <button ref={primary} type="button" className="btn primary" onClick={() => void app.recoverDraft()}>Recover</button>
        </div>
      </div>
    </div>
  )
}
