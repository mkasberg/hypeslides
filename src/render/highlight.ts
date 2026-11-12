// Lazy Shiki syntax highlighting for fenced code. The colors follow Hype's
// source-highlight mapping (src/syntax.cpp): keyword magenta, type yellow,
// string green, number red, function accent, preprocessor/symbol/escape cyan,
// comment dark_foreground. Token colors come out as `var(--role)` so the same
// highlighted HTML serves every theme; only the CSS variables change.
//
// Shiki is imported dynamically (fine-grained: core + JS regex engine + a few
// languages) so none of it is in the main bundle.

import type { CodeHighlighter } from './markdown'

type Role = 'foreground' | 'magenta' | 'yellow' | 'green' | 'red' | 'accent' | 'cyan' | 'dark_foreground'

// Placeholder colors, one per role; mapped to CSS variables after tokenizing.
const PLACEHOLDER: Record<Role, string> = {
  foreground: '#010101',
  magenta: '#020202',
  yellow: '#030303',
  green: '#040404',
  red: '#050505',
  accent: '#060606',
  cyan: '#070707',
  dark_foreground: '#080808',
}
const ROLE_BY_COLOR = new Map<string, Role>(
  (Object.keys(PLACEHOLDER) as Role[]).map((role) => [PLACEHOLDER[role], role]),
)

const rule = (role: Role, ...scope: string[]) => ({ scope, settings: { foreground: PLACEHOLDER[role] } })

const HYPE_THEME = {
  name: 'hype',
  type: 'dark' as const,
  fg: PLACEHOLDER.foreground,
  bg: '#000000',
  settings: [
    rule('dark_foreground', 'comment', 'punctuation.definition.comment'),
    rule('magenta', 'keyword', 'storage.modifier', 'storage.type.function', 'storage.type.class', 'keyword.operator.new',
      'keyword.operator.expression', 'keyword.operator.logical.python'),
    rule('yellow', 'entity.name.type', 'entity.name.class', 'entity.other.inherited-class', 'support.type', 'support.class',
      'storage.type', 'entity.name.namespace', 'entity.name.tag'),
    rule('green', 'string', 'string.regexp', 'punctuation.definition.string'),
    rule('cyan', 'constant.character.escape', 'constant.other.symbol', 'meta.preprocessor', 'keyword.control.directive',
      'punctuation.definition.constant', 'meta.directive', 'entity.other.attribute-name'),
    rule('red', 'constant.numeric', 'constant.language', 'variable.language', 'variable.other.constant', 'constant.other',
      'punctuation.definition.variable', 'variable.other.readwrite.global', 'variable.other.readwrite.instance'),
    rule('accent', 'entity.name.function', 'support.function', 'meta.function-call', 'variable.function'),
    rule('foreground', 'keyword.operator', 'punctuation', 'meta.brace'),
  ],
}

const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  java: () => import('shiki/langs/java.mjs'),
}

const ALIASES: Record<string, string> = {
  rs: 'rust', js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  sh: 'bash', shell: 'bash', shellscript: 'bash', zsh: 'bash', console: 'bash', py: 'python', rb: 'ruby',
  golang: 'go', yml: 'yaml', md: 'markdown', 'c++': 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp', htm: 'html', xml: 'html',
  jsonc: 'json',
}

export function normalizeLanguage(lang: string): string | null {
  const name = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()
  return name in LOADERS ? name : null
}

interface Highlighter {
  codeToTokensBase(code: string, options: { lang: string; theme: string }): { content: string; color?: string; fontStyle?: number }[][]
  loadLanguage(...langs: unknown[]): Promise<void>
}

let highlighterPromise: Promise<Highlighter> | undefined
const loadedLanguages = new Set<string>()
const pendingLanguages = new Map<string, Promise<void>>()
const inflight = new Set<Promise<void>>()
const listeners = new Set<() => void>()
const cache = new Map<string, string>()
let highlighter: Highlighter | undefined

/** Called whenever a language finishes loading (so views can re-render). */
export function onHighlighterChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Resolves once no language is loading (including ones requested while waiting). */
export async function highlighterIdle(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight])
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Start loading Shiki and the language (no-op when unsupported or loaded). */
export function loadLanguage(lang: string): Promise<void> {
  const name = normalizeLanguage(lang)
  if (!name || loadedLanguages.has(name)) return Promise.resolve()
  let pending = pendingLanguages.get(name)
  if (!pending) {
    pending = (async () => {
      highlighterPromise ??= (async () => {
        const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
        ])
        return (await createHighlighterCore({
          themes: [HYPE_THEME],
          langs: [],
          engine: createJavaScriptRegexEngine(),
        })) as unknown as Highlighter
      })()
      const h = await highlighterPromise
      const mod = await LOADERS[name]()
      await h.loadLanguage(mod.default)
      highlighter = h
      loadedLanguages.add(name)
      listeners.forEach((fn) => fn())
    })().catch(() => {
      // Unsupported in this engine: stay plain.
    })
    pendingLanguages.set(name, pending)
    const p = pending
    inflight.add(p)
    void p.finally(() => inflight.delete(p))
  }
  return pending
}

/**
 * Synchronous highlighter for `renderSlideHtml`: returns colored HTML if the
 * language is loaded, otherwise starts loading it and returns null (plain).
 */
export const highlightCode: CodeHighlighter = (code, lang) => {
  const name = normalizeLanguage(lang)
  if (!name) return null
  if (!highlighter || !loadedLanguages.has(name)) {
    void loadLanguage(name)
    return null
  }
  const key = name + '\n' + code
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let html: string
  try {
    html = highlighter
      .codeToTokensBase(code, { lang: name, theme: 'hype' })
      .map((line) =>
        line
          .map((token) => {
            const role = token.color ? ROLE_BY_COLOR.get(token.color.toLowerCase()) : undefined
            const text = escapeHtml(token.content)
            const style =
              (role && role !== 'foreground' ? `color:var(--${role.replace('_', '-')});` : '') +
              (token.fontStyle && token.fontStyle & 1 ? 'font-style:italic;' : '')
            return style ? `<span style="${style}">${text}</span>` : text
          })
          .join(''),
      )
      .join('\n')
  } catch {
    return null
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, html)
  return html
}
