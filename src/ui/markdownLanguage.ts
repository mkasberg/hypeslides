import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { MarkdownParser } from '@lezer/markdown'
import type { LanguageSupport } from '@codemirror/language'

/**
 * The editor's Markdown language: CommonMark plus GFM (tables, strikethrough,
 * task lists, autolinks). Keeps lang-markdown's list continuation / Backspace
 * keymap, folding and URL paste. HTML tag completion is off (it needs the real
 * lang-html, which is aliased out of the bundle; see vite.config.ts).
 */
export function markdownLanguage(): LanguageSupport {
  return markdown({
    base: { parser: (commonmarkLanguage.parser as MarkdownParser).configure(GFM) } as unknown as typeof commonmarkLanguage,
    completeHTMLTags: false,
  })
}
