import { THEMES, fontFor, headerOf, selectionRange, slideCount, themeName, title as docTitle } from '../core'
import { runCommand } from '../app/shortcuts'
import { isDirty } from '../app/store'
import { useApp } from '../app/useApp'
import { Dropdown } from './Menu'
import type { MenuItem } from './Menu'
import { ChevronIcon, FileIcon, FontIcon, GridIcon, PaletteIcon, PlayIcon } from './icons'

const FONTS = [
  'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Menlo', 'Consolas', 'Courier New',
  'Inter', 'system-ui', 'Helvetica', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino',
]

const prettyTheme = (n: string) => n.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const isChromium = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export function storageLabel(s: { store: { kind: string; name: string } | null; doc: { source: string }; savedSource: string; saving: boolean }): string {
  const dirty = s.doc.source !== s.savedSource
  if (!s.store) return isChromium() ? (dirty ? 'Not saved yet. Ctrl+S chooses a folder' : 'New presentation. Ctrl+S chooses a folder') : 'Not saved. Export to keep a copy'
  if (s.store.kind === 'fs-access') return dirty || s.saving ? 'Saving…' : `Saved to disk · ${s.store.name}`
  return dirty || s.saving ? 'Saving…' : 'Stored in this browser. Export to save a copy'
}

export function TopBar() {
  const doc = useApp((s) => s.doc)
  const mode = useApp((s) => s.mode)
  const prevMode = useApp((s) => s.prevMode)
  const store = useApp((s) => s.store)
  const dirty = useApp((s) => isDirty(s))
  const savedSource = useApp((s) => s.savedSource)
  const saving = useApp((s) => s.saving)
  const status = useApp((s) => s.status)
  const statusFailed = useApp((s) => s.statusFailed)
  const setTheme = useApp((s) => s.setTheme)
  const setFont = useApp((s) => s.setFont)
  const header = headerOf(doc)
  const name = docTitle(header, store?.name ?? 'Untitled')
  const { count } = selectionRange(doc)
  const n = slideCount(doc)
  const position = count > 1 ? `${count} slides selected` : `Slide ${doc.selected + 1} of ${n}`
  const theme = themeName(header)
  const font = fontFor(header)
  const fonts = FONTS.includes(font) ? FONTS : [font, ...FONTS]
  const chromium = isChromium()
  const storage = storageLabel({ store, doc, savedSource, saving })

  const fileItems: MenuItem[] = [
    { heading: true, label: storage },
    { label: 'New presentation', shortcut: 'Ctrl+N', onSelect: () => runCommand('file.new') },
    ...(chromium ? [{ label: 'Open folder…', shortcut: 'Ctrl+O', onSelect: () => runCommand('file.open') }] : []),
    { label: 'Import folder…', shortcut: chromium ? undefined : 'Ctrl+O', onSelect: () => runCommand('file.importFolder') },
    { label: 'Import .md or .zip…', onSelect: () => runCommand('file.importFile') },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', onSelect: () => runCommand('file.save') },
    ...(chromium ? [{ label: 'Save as…', shortcut: 'Ctrl+Shift+S', onSelect: () => runCommand('file.saveAs') }] : []),
    { label: store || !chromium ? 'Export (.md / .zip)' : 'Export (.md)', shortcut: 'Ctrl+E', onSelect: () => runCommand('file.export') },
    { separator: true },
    { label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => runCommand('help.shortcuts') },
  ]
  const themeItems: MenuItem[] = THEMES.map((t) => ({
    label: prettyTheme(t.name),
    checked: t.name === theme,
    swatch: [t.colors.background, t.colors.accent, t.colors.foreground],
    onSelect: () => setTheme(t.name),
  }))
  const fontItems: MenuItem[] = fonts.map((f) => ({
    label: f, checked: f === font, labelStyle: { fontFamily: `'${f}', sans-serif` }, onSelect: () => setFont(f),
  }))

  return (
    <header className="topbar">
      <div className="top-left">
        <button type="button" className="logo" title="Keyboard shortcuts (?)" onClick={() => runCommand('help.shortcuts')}>Hype</button>
        <Dropdown className={'icon-btn' + (dirty ? ' attention' : '')} title={dirty ? 'File menu (unsaved changes)' : 'File menu'} items={fileItems}>
          <FileIcon />
        </Dropdown>
      </div>
      <div className="top-center">
        <div className="deck-title" title={name}>{name}{dirty ? ' •' : ''}</div>
        <div className={'deck-status' + (statusFailed ? ' failed' : '')} aria-live="polite">{status || position}</div>
      </div>
      <div className="top-right">
        <button type="button" className={'icon-btn' + (mode === 'overview' ? ' active' : '')} title="Overview (Ctrl+M)" aria-pressed={mode === 'overview'} onClick={() => runCommand('view.overview')}>
          <GridIcon />
        </button>
        <div className="segmented" role="group" aria-label="Editor mode" title="Visual / Markdown (Ctrl+.)">
          <button type="button" className={mode === 'visual' || (mode === 'overview' && prevMode === 'visual') ? 'on' : ''} onClick={() => runCommand('view.visual')}>Visual</button>
          <button type="button" className={mode === 'markdown' || (mode === 'overview' && prevMode === 'markdown') ? 'on' : ''} onClick={() => runCommand('view.markdown')}>Markdown</button>
        </div>
        <Dropdown className="pill" title="Theme" items={themeItems} alignRight>
          <PaletteIcon /> <span>{prettyTheme(theme)}</span> <ChevronIcon />
        </Dropdown>
        <Dropdown className="pill" title="Font" items={fontItems} alignRight>
          <FontIcon /> <span className="font-name">{font}</span> <ChevronIcon />
        </Dropdown>
        <button type="button" className="pill primary" title="Present (Ctrl+Space or F5)" onClick={() => runCommand('present.toggle')}>
          <PlayIcon /> <span>Present</span>
        </button>
      </div>
    </header>
  )
}
