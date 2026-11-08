// Lets keyboard shortcuts and toolbar buttons reach the single mounted
// CodeMirror editor (visual slide editor or markdown source editor).

import type { FormatKind } from './markdownFormat'

export interface EditorHandle {
  format(kind: FormatKind): void
  focus(): void
  hasFocus(): boolean
}

export const editorBridge: { current: EditorHandle | null } = { current: null }

/** Focus the slide list (sidebar or overview grid). */
export function focusList(): void {
  document.querySelector<HTMLElement>('[data-slide-list]')?.focus({ preventScroll: true })
}
