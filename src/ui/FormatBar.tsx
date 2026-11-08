import { parseMedia, selectedSlide, DEFAULT_PLACED_SIZE, MEDIA_POSITIONS } from '../core'
import { runCommand } from '../app/shortcuts'
import type { CommandName } from '../app/shortcuts'
import { useApp } from '../app/useApp'
import { Dropdown } from './Menu'
import type { MenuItem } from './Menu'
import { ChevronIcon, CodeIcon, CommentIcon, ImageIcon, LayoutIcon } from './icons'

function FormatButton({ cmd, title, children }: { cmd: CommandName; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="tool"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => runCommand(cmd)}
    >
      {children}
    </button>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ')

export function FormatBar() {
  const slide = useApp((s) => selectedSlide(s.doc))
  const layout = useApp((s) => s.layout)
  const media = parseMedia(slide)
  const hasMedia = !!media && (!!media.file || !!media.svg)
  const placed = !!media?.position
  const size = media?.size ?? DEFAULT_PLACED_SIZE

  const items: MenuItem[] = [
    { label: 'Fit', checked: !!media && !media.span && !placed, onSelect: () => layout('mode', 'fit') },
    { label: 'Span', checked: !!media?.span, onSelect: () => layout('mode', 'span') },
    {
      label: 'Place',
      disabled: !!media?.video,
      items: MEDIA_POSITIONS.map((p) => ({ label: cap(p), checked: media?.position === p, onSelect: () => layout('position', p) })),
    },
    {
      label: 'Size',
      disabled: !placed,
      items: ([['Small', 10], ['Medium', 20], ['Large', 35]] as const).map(([name, pct]) => ({
        label: `${name} (${pct}%)`, checked: placed && size === pct, onSelect: () => layout('size', pct),
      })),
    },
    { separator: true },
    { label: 'Match image edges', disabled: placed, checked: media?.background === 'auto', onSelect: () => layout('background', 'auto') },
    { label: media?.video ? 'Blurred first frame' : 'Blurred image', disabled: placed, checked: media?.background === 'blur', onSelect: () => layout('background', 'blur') },
    { label: 'White', disabled: placed, checked: media?.background === 'white', onSelect: () => layout('background', 'white') },
    { label: 'Black', disabled: placed, checked: media?.background === 'black', onSelect: () => layout('background', 'black') },
    { label: 'Use theme color', disabled: placed, checked: media?.background === 'theme', onSelect: () => layout('background', 'theme') },
  ]

  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      <FormatButton cmd="format.bold" title="Bold (Ctrl+B)"><b>B</b></FormatButton>
      <FormatButton cmd="format.italic" title="Italic (Ctrl+I)"><i>I</i></FormatButton>
      <FormatButton cmd="format.underline" title="Underline (Ctrl+U)"><u>U</u></FormatButton>
      <FormatButton cmd="format.headline" title="Headline (Ctrl+H)"><span className="h">H</span></FormatButton>
      <FormatButton cmd="format.code" title="Code block (Ctrl+K)"><CodeIcon /></FormatButton>
      <FormatButton cmd="format.comment" title="Hidden comment (Ctrl+/)"><CommentIcon /></FormatButton>
      <span className="spacer" />
      <button type="button" className="tool wide" title="Add or replace an image / video" onClick={() => runCommand('media.add')}>
        <ImageIcon /> <span>Media</span>
      </button>
      <Dropdown className="tool wide" title="Image / video layout options" items={items} alignRight disabled={!hasMedia}>
        <LayoutIcon /> <span>Layout</span> <ChevronIcon />
      </Dropdown>
    </div>
  )
}
