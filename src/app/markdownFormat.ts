// Port of format() in ~/code/hype/src/Markdown.js: one complete edit for a
// formatting button / shortcut applied to a text selection.

export type FormatKind = 'bold' | 'italic' | 'underline' | 'headline' | 'code' | 'comment'

export interface FormatResult {
  text: string
  start: number
  end: number
}

export function formatText(source: string, start: number, end: number, kind: FormatKind): FormatResult {
  let selected = source.slice(start, end)
  let before = source.slice(0, start)
  let after = source.slice(end)
  let replacement = selected
  let selectionStart = start
  let selectionEnd = end
  if (kind === 'headline') {
    const originalStart = start
    const originalEnd = end
    start = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1
    const last = end > start && source[end - 1] === '\n' ? end - 1 : end
    end = source.indexOf('\n', last)
    if (end < 0) end = source.length
    before = source.slice(0, start)
    after = source.slice(end)
    const lines = source.slice(start, end).split('\n')
    const remove = lines.every((line) => !line.trim() || /^#{1,6} /.test(line))
    replacement = lines
      .map((line) => {
        if (!line.trim()) return line
        const text = line.replace(/^#{1,6} /, '')
        return remove ? text : '# ' + text
      })
      .join('\n')
    const mapPosition = (position: number): number => {
      let offset = start
      let delta = 0
      for (const line of lines) {
        const heading = line.match(/^#{1,6} /)
        const oldPrefix = heading ? heading[0].length : 0
        const newPrefix = line.trim() && !remove ? 2 : 0
        if (position <= offset + line.length) {
          return offset + delta + newPrefix + Math.max(0, position - offset - oldPrefix)
        }
        delta += newPrefix - oldPrefix
        offset += line.length + 1
      }
      return position + delta
    }
    selectionStart = mapPosition(originalStart)
    selectionEnd = mapPosition(originalEnd)
    if (!replacement) {
      replacement = '# Headline'
      selectionStart = start + 2
      selectionEnd = start + replacement.length
    }
  } else {
    let open: string
    let close: string
    let placeholder: string
    if (kind === 'code') {
      let fence = '```'
      while (selected.includes(fence)) fence += '`'
      open = (before && !before.endsWith('\n') ? '\n' : '') + fence + '\n'
      close = '\n' + fence + (after && !after.startsWith('\n') ? '\n' : '')
      placeholder = 'code'
    } else if (kind === 'comment') {
      open = '<!-- '
      close = ' -->'
      placeholder = 'Comment'
    } else if (kind === 'underline') {
      // Hype's dialect reads _underscores_ as underline and *asterisks* as italic.
      open = close = '_'
      placeholder = 'underlined text'
    } else {
      open = close = kind === 'bold' ? '**' : '*'
      placeholder = kind === 'bold' ? 'bold text' : 'italic text'
    }
    let wrapped = kind !== 'code' && before.endsWith(open) && after.startsWith(close)
    if (kind === 'italic' && wrapped) {
      const left = before.match(/\*+$/)![0].length
      const right = after.match(/^\*+/)![0].length
      wrapped = left % 2 === 1 && right % 2 === 1
    }
    if (wrapped) {
      before = before.slice(0, -open.length)
      after = after.slice(close.length)
      selectionStart = start - open.length
      selectionEnd = selectionStart + selected.length
    } else {
      selected = selected || placeholder
      replacement = open + selected + close
      selectionStart = start + open.length
      selectionEnd = selectionStart + selected.length
    }
  }
  return { text: before + replacement + after, start: selectionStart, end: selectionEnd }
}
