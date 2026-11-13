import { EditorView } from '@codemirror/view'

/** Move the cursor of a mounted editor without notifying onCursor. */
export function setCursorQuietly(view: EditorView, offset: number, scrollToTop = false) {
  const pos = Math.max(0, Math.min(view.state.doc.length, offset))
  view.dispatch({ selection: { anchor: pos }, effects: scrollToTop ? EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) : EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 24 }) })
}
