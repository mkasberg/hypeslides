import { useSyncExternalStore } from 'react'
import { fontFor, headerOf, selectionRange, slideCount, themeName, title as docTitle } from '../core'
import { runCommand } from '../app/shortcuts'
import { isDirty } from '../app/store'
import { useApp } from '../app/useApp'
import { Dropdown } from './Menu'
import type { MenuItem } from './Menu'
import { getAppThemePref, previewAppTheme, prettyThemeName, setAppThemePref, subscribeAppTheme } from '../app/appTheme'
import { Popover, ThemeList, allThemeOptions, systemOption } from './ThemeList'
import { ChevronIcon, FileIcon, FontIcon, GitHubIcon, GridIcon, MarkdownIcon, PaletteIcon, PlayIcon, VisualIcon } from './icons'

const FONTS = [
  'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Menlo', 'Consolas', 'Courier New',
  'Inter', 'system-ui', 'Helvetica', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino',
]

const prettyTheme = prettyThemeName
const PRESENTATION_OPTIONS = allThemeOptions()
const APP_OPTIONS = [systemOption(), ...PRESENTATION_OPTIONS]
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
  const store = useApp((s) => s.store)
  const dirty = useApp((s) => isDirty(s))
  const savedSource = useApp((s) => s.savedSource)
  const saving = useApp((s) => s.saving)
  const status = useApp((s) => s.status)
  const statusFailed = useApp((s) => s.statusFailed)
  const setTheme = useApp((s) => s.setTheme)
  const setThemePreview = useApp((s) => s.setThemePreview)
  const appThemePref = useSyncExternalStore(subscribeAppTheme, getAppThemePref)
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
  ]
  const fontItems: MenuItem[] = fonts.map((f) => ({
    label: f, checked: f === font, labelStyle: { fontFamily: `'${f}', sans-serif` }, onSelect: () => setFont(f),
  }))

  return (
    <header className="topbar">
      <div className="top-left">
        <Popover className="logo" title="Appearance" button="HypeSlides" onClose={() => previewAppTheme(null)}>
          {(close) => (
            <>
              <div className="menu-heading">App theme</div>
              <ThemeList
                options={APP_OPTIONS}
                value={appThemePref}
                onPreview={previewAppTheme}
                onCommit={(v) => { setAppThemePref(v); close() }}
              />
              <div className="menu-sep" role="separator" />
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); runCommand('help.shortcuts') }}>
                <span className="menu-check" />
                <span className="menu-label">Keyboard shortcuts…</span>
                <span className="menu-shortcut">?</span>
              </button>
            </>
          )}
        </Popover>
        <Dropdown className={'icon-btn' + (dirty ? ' attention' : '')} title={dirty ? 'File menu (unsaved changes)' : 'File menu'} items={fileItems}>
          <FileIcon />
        </Dropdown>
      </div>
      <div className="top-center">
        <div className="deck-title" title={name}>{name}{dirty ? ' •' : ''}</div>
        <div className={'deck-status' + (statusFailed ? ' failed' : '')} aria-live="polite">{status || position}</div>
      </div>
      <div className="top-right">
        <a className="icon-btn" href="https://github.com/mkasberg/hypeslides" target="_blank" rel="noopener noreferrer" title="HypeSlides on GitHub" aria-label="HypeSlides on GitHub">
          <GitHubIcon />
        </a>
        <div className="segmented" role="group" aria-label="View mode">
          <button type="button" className={mode === 'visual' ? 'on' : ''} aria-label="Visual" title="Visual (Ctrl+.)" aria-pressed={mode === 'visual'} onClick={() => runCommand('view.visual')}><VisualIcon /></button>
          <button type="button" className={mode === 'markdown' ? 'on' : ''} aria-label="Markdown" title="Markdown (Ctrl+.)" aria-pressed={mode === 'markdown'} onClick={() => runCommand('view.markdown')}><MarkdownIcon /></button>
          <button type="button" className={mode === 'overview' ? 'on' : ''} aria-label="Overview" title="Overview (Ctrl+M)" aria-pressed={mode === 'overview'} onClick={() => runCommand('view.showOverview')}><GridIcon /></button>
        </div>
        <Popover
          className="pill"
          title="Presentation theme"
          alignRight
          button={<><PaletteIcon /> <span>{prettyTheme(theme)}</span> <ChevronIcon /></>}
          onClose={() => setThemePreview(null)}
        >
          {(close) => (
            <>
              <div className="menu-heading">Presentation theme</div>
              <ThemeList
                options={PRESENTATION_OPTIONS}
                value={theme}
                onPreview={setThemePreview}
                onCommit={(v) => { setTheme(v); close() }}
              />
            </>
          )}
        </Popover>
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
