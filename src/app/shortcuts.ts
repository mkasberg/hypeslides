// One keydown handler: key -> named command, honoring focus context. Menus,
// buttons and the shortcuts overlay call the same commands via runCommand.

import { parseMedia, selectedSlide } from '../core'
import { editorBridge, focusList } from './editorBridge'
import type { FormatKind } from './markdownFormat'
import { pickImportFile, pickImportFolder, pickMedia } from './pickers'
import type { AppState } from './store'
import { useApp } from './useApp'

export type Context = 'list' | 'editor' | 'field'

type Command = (s: AppState) => void

const next5 = 5

function formatCommand(kind: FormatKind): Command {
  return (s) => {
    if (s.mode === 'overview') return
    editorBridge.current?.format(kind)
  }
}

function switchFocus() {
  const editor = editorBridge.current
  if (editor?.hasFocus()) focusList()
  else if (editor) editor.focus()
}

/** Mode switches keep focus in the editor if it had it. */
function withFocusKept(fn: () => void) {
  const inEditor = editorBridge.current?.hasFocus() ?? false
  fn()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (useApp.getState().mode === 'overview') focusList()
    else if (inEditor) editorBridge.current?.focus()
    else focusList()
  }))
}

export async function openOrImport(): Promise<void> {
  const s = useApp.getState()
  const files = await pickImportFolder()
  if (files.length) await s.importFiles(files)
}

export async function importFileOrZip(): Promise<void> {
  const files = await pickImportFile()
  if (files.length) await useApp.getState().importFiles(files)
}

export async function addMediaFromPicker(): Promise<void> {
  const files = await pickMedia()
  if (files.length) await useApp.getState().addMediaFiles(files)
}

const hasPlayable = (s: AppState) => {
  const m = parseMedia(selectedSlide(s.doc))
  return !!m && (m.video || /\.(gif|webp)$/i.test(m.file))
}

export const COMMANDS = {
  'file.new': (s) => void s.newDeck(),
  'file.open': (s) => (isChromium() ? void s.openFolder() : void openOrImport()),
  'file.importFolder': () => void openOrImport(),
  'file.importFile': () => void importFileOrZip(),
  'file.save': (s) => void s.save(),
  'file.saveAs': (s) => void s.saveAs(),
  'file.export': (s) => void s.exportDeck(),
  'view.overview': (s) => withFocusKept(s.toggleOverview),
  'view.showOverview': (s) => withFocusKept(() => s.setMode('overview')),
  'view.source': (s) => withFocusKept(s.toggleSource),
  'view.visual': (s) => withFocusKept(() => s.setMode('visual')),
  'view.markdown': (s) => withFocusKept(() => s.setMode('markdown')),
  'help.shortcuts': (s) => s.setShortcutsOpen(!s.shortcutsOpen),
  'format.bold': formatCommand('bold'),
  'format.italic': formatCommand('italic'),
  'format.underline': formatCommand('underline'),
  'format.headline': formatCommand('headline'),
  'format.code': formatCommand('code'),
  'format.comment': formatCommand('comment'),
  'edit.undo': (s) => s.undo(),
  'edit.redo': (s) => s.redo(),
  'slide.add': (s) => {
    s.addSlide()
    if (s.mode === 'visual') requestAnimationFrame(() => editorBridge.current?.focus())
  },
  'slide.duplicate': (s) => s.duplicate(),
  'slide.delete': (s) => s.remove(),
  'media.add': () => void addMediaFromPicker(),
  'present.toggle': (s) => s.present(false),
  'present.fromStart': (s) => s.present(true),
  'present.playToggle': (s) => s.togglePlay(),
  'present.stop': (s) => s.stopPresenting(),
  'focus.switch': () => switchFocus(),
  'overview.open': (s) => withFocusKept(() => s.setMode('visual')),
  // navigation (selection only)
  'nav.prev': (s) => s.step(-1),
  'nav.next': (s) => s.step(1),
  'nav.up': (s) => s.step(-s.rowStep),
  'nav.down': (s) => s.step(s.rowStep),
  'nav.pageUp': (s) => s.step(-next5 * s.rowStep),
  'nav.pageDown': (s) => s.step(next5 * s.rowStep),
  'nav.first': (s) => s.select(0),
  'nav.last': (s) => s.select(Number.MAX_SAFE_INTEGER),
  // typing-context navigation: one slide / five slides
  'type.prev': (s) => s.step(-1),
  'type.next': (s) => s.step(1),
  'type.pageUp': (s) => s.step(-next5),
  'type.pageDown': (s) => s.step(next5),
  // extend
  'extend.prev': (s) => s.step(-1, true),
  'extend.next': (s) => s.step(1, true),
  'extend.up': (s) => s.step(-s.rowStep, true),
  'extend.down': (s) => s.step(s.rowStep, true),
  // move slides
  'move.prev': (s) => s.moveBy(-1),
  'move.next': (s) => s.moveBy(1),
  'move.up': (s) => s.moveBy(-s.rowStep),
  'move.down': (s) => s.moveBy(s.rowStep),
  'move.pageUp': (s) => s.moveBy(-next5),
  'move.pageDown': (s) => s.moveBy(next5),
  'move.first': (s) => s.moveBy(-1e6),
  'move.last': (s) => s.moveBy(1e6),
} satisfies Record<string, Command>

export type CommandName = keyof typeof COMMANDS

export function runCommand(name: CommandName): void {
  COMMANDS[name](useApp.getState())
}

function isChromium(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

// ---- key tables ---------------------------------------------------------

/** Work everywhere (outside present mode), including while typing. */
const GLOBAL: Record<string, CommandName> = {
  'Ctrl+N': 'file.new',
  'Ctrl+O': 'file.open',
  'Ctrl+S': 'file.save',
  'Ctrl+Shift+S': 'file.saveAs',
  'Ctrl+E': 'file.export',
  'Ctrl+M': 'view.overview',
  'Ctrl+.': 'view.source',
  'Ctrl+B': 'format.bold',
  'Ctrl+I': 'format.italic',
  'Ctrl+U': 'format.underline',
  'Ctrl+H': 'format.headline',
  'Ctrl+K': 'format.code',
  'Ctrl+/': 'format.comment',
  F1: 'help.shortcuts',
  'Ctrl+Enter': 'slide.add',
  F5: 'present.toggle',
  'Ctrl+Space': 'present.toggle',
  'Shift+F5': 'present.fromStart',
  'Ctrl+Z': 'edit.undo',
  'Ctrl+Shift+Z': 'edit.redo',
  'Ctrl+Y': 'edit.redo',
}

/** Only when focus is in the sidebar / overview / elsewhere, not in a text box. */
const LIST: Record<string, CommandName> = {
  '?': 'help.shortcuts',
  Tab: 'focus.switch',
  'Shift+Tab': 'focus.switch',
  Left: 'nav.prev',
  Right: 'nav.next',
  Up: 'nav.up',
  Down: 'nav.down',
  PageUp: 'nav.pageUp',
  PageDown: 'nav.pageDown',
  Home: 'nav.first',
  End: 'nav.last',
  'Shift+Left': 'extend.prev',
  'Shift+Right': 'extend.next',
  'Shift+Up': 'extend.up',
  'Shift+Down': 'extend.down',
  'Ctrl+Left': 'move.prev',
  'Ctrl+Right': 'move.next',
  'Ctrl+Up': 'move.up',
  'Ctrl+Down': 'move.down',
  'Ctrl+PageUp': 'move.pageUp',
  'Ctrl+PageDown': 'move.pageDown',
  'Ctrl+Home': 'move.first',
  'Ctrl+End': 'move.last',
  'Ctrl+D': 'slide.duplicate',
  Delete: 'slide.delete',
}

/** Inside a CodeMirror editor. */
const EDITOR: Record<string, CommandName> = {
  Tab: 'focus.switch',
  'Shift+Tab': 'focus.switch',
  'Ctrl+Up': 'type.prev',
  'Ctrl+Down': 'type.next',
  'Ctrl+PageUp': 'type.pageUp',
  'Ctrl+PageDown': 'type.pageDown',
}

const PRESENT: Record<string, CommandName> = {
  F5: 'present.toggle',
  'Ctrl+Space': 'present.toggle',
  'Shift+F5': 'present.fromStart',
  Escape: 'present.stop',
  Right: 'nav.next',
  Down: 'nav.next',
  PageDown: 'nav.next',
  Enter: 'nav.next',
  Left: 'nav.prev',
  Up: 'nav.prev',
  PageUp: 'nav.prev',
  Backspace: 'nav.prev',
  Home: 'nav.first',
  End: 'nav.last',
}

export function keyName(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k.startsWith('Arrow')) k = k.slice(5)
  else if (k.length === 1) k = k.toUpperCase()
  const shift = e.shiftKey && k !== '?'
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (shift ? 'Shift+' : '') + k
}

export function contextOf(target: EventTarget | null): Context {
  const el = target instanceof Element ? target : null
  if (!el) return 'list'
  if (el.closest('.cm-editor')) return 'editor'
  if (el.closest('input, textarea, select, [contenteditable=true]')) return 'field'
  return 'list'
}

export interface KeyState {
  presenting: boolean
  mode: 'visual' | 'markdown' | 'overview'
  blocked: boolean // a dialog or menu is open
  hasPlayable: boolean
}

/** Pure: which command (if any) a key triggers. */
export function resolveKey(name: string, ctx: Context, st: KeyState): CommandName | null {
  if (st.presenting) {
    if (name === 'Space') return st.hasPlayable ? 'present.playToggle' : 'nav.next'
    return PRESENT[name] ?? null
  }
  if (st.blocked) return null
  if (ctx === 'field') return name === 'F1' ? 'help.shortcuts' : null
  if (ctx === 'editor') {
    if (name === 'Ctrl+Enter' && st.mode === 'overview') return null
    return EDITOR[name] ?? GLOBAL[name] ?? null
  }
  if (name === 'Enter' && st.mode === 'overview') return 'overview.open'
  if (st.mode === 'markdown' && (name === 'Home' || name === 'End')) return null
  return LIST[name] ?? GLOBAL[name] ?? null
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return
    const s = useApp.getState()
    const name = keyName(e)
    const blocked = !!s.dialog || !!document.querySelector('[role=menu]')
    if (s.shortcutsOpen && !s.presenting) {
      if (name === 'Escape' || name === '?' || name === 'F1') {
        e.preventDefault()
        s.setShortcutsOpen(false)
      }
      return
    }
    const command = resolveKey(name, contextOf(e.target), {
      presenting: s.presenting,
      mode: s.mode,
      blocked,
      hasPlayable: s.presenting && hasPlayable(s),
    })
    if (!command) return
    e.preventDefault()
    // Capture phase + stopPropagation so CodeMirror's own keymap never also acts on the key.
    e.stopPropagation()
    runCommand(command)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
