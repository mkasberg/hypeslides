import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, foldable } from '@codemirror/language'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { markdownLanguage } from './markdownLanguage'

function nodes(doc: string): Set<string> {
  const state = EditorState.create({ doc, extensions: markdownLanguage() })
  const tree = ensureSyntaxTree(state, doc.length, 5000)!
  const names = new Set<string>()
  tree.iterate({ enter: (n) => { names.add(n.name) } })
  return names
}

describe('editor markdown language', () => {
  it('parses GFM tables, strikethrough and task lists', () => {
    const n = nodes('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n- [ ] todo\n- [x] done\n')
    for (const name of ['Table', 'TableHeader', 'TableCell', 'Strikethrough', 'Task', 'TaskMarker']) expect(n).toContain(name)
  })

  it('recognizes HTML comments (inline and block) and tags', () => {
    expect(nodes('<!-- speaker note -->\n\ntext')).toContain('CommentBlock')
    expect(nodes('text <!-- hype: layout=left --> more')).toContain('Comment')
    expect(nodes('text <b>bold</b>')).toContain('HTMLTag')
    expect(nodes('<div>\nhi\n</div>\n')).toContain('HTMLBlock')
  })

  it('mounts the lightweight HTML tokenizer inside HTML blocks', () => {
    const doc = '<div>\n<p class="x">hi</p>\n</div>\n'
    const state = EditorState.create({ doc, extensions: markdownLanguage() })
    const tree = ensureSyntaxTree(state, doc.length, 5000)!
    const inner = tree.resolveInner(doc.indexOf('class'), 1)
    expect(inner.name).toBe('AttributeName')
  })

  it('parses fenced code and headings, and folds sections', () => {
    const doc = '# One\n\n```svg\n<svg/>\n```\n\n## Two\n\ntext\n'
    expect(nodes(doc)).toContain('FencedCode')
    const state = EditorState.create({ doc, extensions: markdownLanguage() })
    ensureSyntaxTree(state, doc.length, 5000)
    expect(foldable(state, 0, 5)).not.toBeNull()
  })

  it('continues lists on Enter', () => {
    let state = EditorState.create({ doc: '- item', selection: { anchor: 6 }, extensions: markdownLanguage() })
    ensureSyntaxTree(state, 6, 5000)
    insertNewlineContinueMarkup({ state, dispatch: (tr) => { state = tr.state } })
    expect(state.doc.toString()).toBe('- item\n- ')
  })
})
