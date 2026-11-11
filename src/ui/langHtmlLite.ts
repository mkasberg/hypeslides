/**
 * Stand-in for `@codemirror/lang-html`, aliased in vite.config.ts.
 *
 * `@codemirror/lang-markdown` imports lang-html unconditionally (inline HTML
 * and HTML blocks are parsed with it), which drags in the HTML, CSS and
 * JavaScript grammars. Hype only needs HTML comments (speaker notes,
 * directives) and the odd inline tag to look reasonable, so this tokenizer
 * highlights comments, tag names, attributes, and strings. It exports the same
 * names as the parts of lang-html that lang-markdown uses.
 */
import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'

interface State { inTag: boolean }

const parser: StreamParser<State> = {
  startState: () => ({ inTag: false }),
  token(stream, state) {
    if (stream.match('<!--')) {
      if (stream.skipTo('-->')) stream.match('-->')
      else stream.skipToEnd()
      return 'comment'
    }
    if (!state.inTag) {
      if (stream.match(/^<\/?[A-Za-z][\w:.-]*/)) { state.inTag = true; return 'tagName' }
      stream.next()
      stream.eatWhile(/[^<]/)
      return null
    }
    if (stream.eatSpace()) return null
    if (stream.match('>') || stream.match('/>')) { state.inTag = false; return 'tagName' }
    if (stream.match(/^"[^"]*"?/) || stream.match(/^'[^']*'?/)) return 'string'
    if (stream.match(/^[\w:.-]+/)) return 'attributeName'
    stream.next()
    return null
  },
}

const language = StreamLanguage.define(parser)

export function html(_config?: unknown): LanguageSupport {
  return new LanguageSupport(language)
}

/** Only used when `completeHTMLTags` is on; the editor turns it off. */
export function htmlCompletionSource(): null {
  return null
}
