import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { editorBridge } from '../app/editorBridge'
import { formatText } from '../app/markdownFormat'
import type { FormatKind } from '../app/markdownFormat'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'

/** Front matter (`---` ... `---` at the top) would otherwise read as a setext heading. */
const frontMatter = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(u: ViewUpdate) { if (u.docChanged) this.decorations = this.build(u.view) }
  build(view: EditorView): DecorationSet {
    const doc = view.state.doc
    if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return Decoration.none
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.trimEnd() === '---') {
        const marks = []
        for (let n = 1; n <= i; n++) marks.push(Decoration.line({ class: 'cm-frontmatter' }).range(doc.line(n).from))
        return Decoration.set(marks)
      }
    }
    return Decoration.none
  }
}, { decorations: (v) => v.decorations })

const highlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--ui-syntax-heading)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--ui-syntax-link)' },
  { tag: t.url, color: 'var(--ui-syntax-link)' },
  { tag: t.monospace, color: 'var(--ui-syntax-code)' },
  { tag: t.quote, color: 'var(--ui-syntax-quote)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--ui-syntax-comment)' },
  { tag: t.comment, color: 'var(--ui-syntax-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--ui-syntax-string)' },
  { tag: [t.propertyName, t.keyword], color: 'var(--ui-syntax-keyword)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ui-foreground)', backgroundColor: 'var(--ui-background)' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace", lineHeight: '1.6', fontSize: '15px' },
  '.cm-content': { caretColor: 'var(--ui-foreground)', padding: '14px 0' },
  '.cm-line': { padding: '0 18px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--ui-foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--ui-selection) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--ui-active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--ui-background)', color: 'var(--ui-muted)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ui-foreground)' },
  '.cm-frontmatter, .cm-frontmatter *': { color: 'var(--ui-muted) !important', fontWeight: '400 !important', fontStyle: 'normal !important' },
  '.cm-placeholder': { color: 'var(--ui-muted)' },
})

export interface CodeEditorProps {
  value: string
  /** When this changes the document is replaced and the cursor reset (e.g. a different slide). */
  docKey: string | number
  /** Maps text emitted by the editor to what `value` will look like (hidden blank lines). */
  normalize?: (text: string) => string
  onChange(text: string): void
  /** User-driven cursor movement (not programmatic). */
  onCursor?(offset: number): void
  onReady?(view: EditorView | null): void
  lineNumbers?: boolean
  placeholder?: string
  ariaLabel: string
}

export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props
  const own = useRef<string | null>(null)
  const quiet = useRef(false)
  const key = useRef(props.docKey)

  useEffect(() => {
    const extensions = [
      theme,
      markdown(),
      syntaxHighlighting(highlight),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      keymap.of(defaultKeymap.filter((b) => b.key !== 'Mod-Enter')),
      EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel, spellcheck: 'false' }),
      EditorView.updateListener.of((u) => {
        if (quiet.current) return
        const p = latest.current
        if (u.docChanged) {
          own.current = u.state.doc.toString()
          p.onChange(own.current)
        }
        if (u.selectionSet || u.docChanged) p.onCursor?.(u.state.selection.main.head)
      }),
      ...(props.lineNumbers ? [lineNumbers(), frontMatter] : []),
      ...(props.placeholder ? [placeholder(props.placeholder)] : []),
    ]
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: latest.current.value, extensions }),
    })
    viewRef.current = view
    own.current = latest.current.value
    latest.current.onReady?.(view)
    editorBridge.current = {
      focus: () => view.focus(),
      hasFocus: () => view.hasFocus,
      format(kind: FormatKind) {
        const sel = view.state.selection.main
        const old = view.state.doc.toString()
        const r = formatText(old, sel.from, sel.to, kind)
        if (r.text !== old) {
          let a = 0
          while (a < old.length && a < r.text.length && old[a] === r.text[a]) a++
          let b = 0
          while (b < old.length - a && b < r.text.length - a && old[old.length - 1 - b] === r.text[r.text.length - 1 - b]) b++
          view.dispatch({
            changes: { from: a, to: old.length - b, insert: r.text.slice(a, r.text.length - b) },
            selection: { anchor: r.start, head: r.end },
            scrollIntoView: true,
          })
        } else view.dispatch({ selection: { anchor: r.start, head: r.end } })
        view.focus()
      },
    }
    return () => {
      latest.current.onReady?.(null)
      editorBridge.current = null
      view.destroy()
      viewRef.current = null
    }
    // The editor is created once per mount; props flow through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    const reset = key.current !== props.docKey
    key.current = props.docKey
    if (!reset && (current === props.value || (own.current !== null && (props.normalize ?? ((x) => x))(own.current) === props.value))) return
    quiet.current = true
    try {
      const sel = view.state.selection.main
      view.dispatch({
        changes: { from: 0, to: current.length, insert: props.value },
        selection: reset
          ? { anchor: 0 }
          : { anchor: Math.min(sel.anchor, props.value.length), head: Math.min(sel.head, props.value.length) },
        scrollIntoView: !reset,
      })
      if (reset) view.scrollDOM.scrollTop = 0
    } finally {
      quiet.current = false
    }
    own.current = props.value
  }, [props.value, props.docKey, props.normalize])

  return <div className="code-editor" ref={host} />
}

/** Move the cursor of a mounted editor without notifying onCursor. */
export function setCursorQuietly(view: EditorView, offset: number, scrollToTop = false) {
  const pos = Math.max(0, Math.min(view.state.doc.length, offset))
  view.dispatch({ selection: { anchor: pos }, effects: scrollToTop ? EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) : EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 24 }) })
}
