import type { ReactNode } from 'react'

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const FileIcon = () => (
  <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>
)
export const GridIcon = () => (
  <Icon><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></Icon>
)
export const SlideIcon = () => (
  <Icon><rect x="3" y="5" width="18" height="14" rx="2" /></Icon>
)
export const PlayIcon = () => (
  <Icon><path d="M7 5l12 7-12 7z" /></Icon>
)
export const PaletteIcon = () => (
  <Icon><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.4-1.2-1.5-1.2-2.7 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" /><circle cx="7.5" cy="11" r=".8" /><circle cx="10" cy="7" r=".8" /><circle cx="14.5" cy="7" r=".8" /></Icon>
)
export const FontIcon = () => (
  <Icon><path d="M5 19 11 5h2l6 14" /><path d="M7.5 14h9" /></Icon>
)
export const ChevronIcon = () => (
  <Icon size={14}><path d="m6 9 6 6 6-6" /></Icon>
)
export const PlusIcon = () => (
  <Icon><path d="M12 5v14M5 12h14" /></Icon>
)
export const ImageIcon = () => (
  <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></Icon>
)
export const LayoutIcon = () => (
  <Icon><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Icon>
)
export const CheckIcon = () => (
  <Icon size={14}><path d="m5 12 5 5 9-10" /></Icon>
)
export const CodeIcon = () => (
  <Icon><path d="m8 8-4 4 4 4M16 8l4 4-4 4" /></Icon>
)
export const CommentIcon = () => (
  <Icon><path d="M4 5h16v11H9l-5 4z" /></Icon>
)
