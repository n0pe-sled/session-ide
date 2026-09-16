/**
 * Minimal VS Code-style inline icons (Seti-flavored palette: blue folders,
 * gray documents) so the explorer reads exactly like the VS Code file tree
 * without depending on any font or asset — only React + these tiny SVGs.
 */

import type { CSSProperties, ReactNode } from 'react'

/** Shared svg props. */
interface IconProps {
  size?: number
  color?: string
}

function svgProps(size: number): { width: number; height: number; viewBox: string; 'aria-hidden': boolean } {
  return { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true }
}

/** Closed folder (VS Code default blue). */
export function FolderIcon({ size = 16, color = '#519aba' }: IconProps): ReactNode {
  return (
    <svg {...svgProps(size)}>
      <path fill={color} d="M1.5 2.75h5.1l1.4 1.5h6.5a1 1 0 0 1 1 1V13a1.25 1.25 0 0 1-1.25 1.25H2.25A1.25 1.25 0 0 1 1 13V4a1.25 1.25 0 0 1 .5-1.25z" />
    </svg>
  )
}

/** Open folder. */
export function FolderOpenIcon({ size = 16, color = '#519aba' }: IconProps): ReactNode {
  return (
    <svg {...svgProps(size)}>
      <path fill={color} d="M1.5 2.75h5.1l1.4 1.5h6.5a1 1 0 0 1 1 1V7H3.9L2.5 12H1.5V4a1.25 1.25 0 0 1 .5-1.25z" />
      <path fill="#79b8d8" d="M2 8.25h13.4a.9.9 0 0 1 .87 1.12l-1.2 4.2a1 1 0 0 1-.97.75H3.4a1 1 0 0 1-.97-.75L1.2 9.4A1 1 0 0 1 2 8.25z" />
    </svg>
  )
}

/** Plain document (VS Code default gray). */
export function FileIcon({ size = 16, color = '#c5c5c5' }: IconProps): ReactNode {
  return (
    <svg {...svgProps(size)}>
      <path fill={color} d="M3.25 1.5h6.9l3.35 3.35V14a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" />
      <path fill="#1e1e1e" d="M10 1.7l3.3 3.3H10z" />
    </svg>
  )
}

/** Symlink/document variant (dashed stroke). */
export function LinkIcon({ size = 16, color = '#c5c5c5' }: IconProps): ReactNode {
  return (
    <svg {...svgProps(size)}>
      <path fill="none" stroke={color} strokeWidth="1.1" strokeDasharray="2.4 1.6" d="M4 2.5h6.8l3.2 3.2v7.8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
    </svg>
  )
}

/** Small chevron for tree expansion. */
export function ChevronIcon({ open, size = 12, style }: { open: boolean; size?: number; style?: CSSProperties }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden>
      <path fill="currentColor" d={open ? 'M4 6.5h8L8 11z' : 'M6.5 4l4.5 4-4.5 4z'} />
    </svg>
  )
}

/** Disk (save) icon. */
export function SaveIcon({ size = 13, color = '#ffffff' }: IconProps): ReactNode {
  return (
    <svg {...svgProps(size)}>
      <rect x="2" y="2.25" width="12" height="11.5" rx="1.4" fill="none" stroke={color} strokeWidth="1.4" />
      <rect x="4.6" y="2.9" width="6.8" height="3.6" fill={color} />
      <rect x="4.6" y="9" width="6.8" height="4.1" fill={color} />
    </svg>
  )
}

/** Close (x) icon for tabs. */
export function CloseIcon({ size = 12, color = 'currentColor' }: IconProps): ReactNode {
  return (
    <svg {...svgProps(size)}>
      <path fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

/** Explorer (files) activity-bar icon. */
export function FilesIcon({ size = 18, color = 'currentColor' }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 5h5.2l1.8 2H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4 9h16v10H4z" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

/** Chat activity-bar icon (comments/discussion). */
export function ChatIcon({ size = 18, color = 'currentColor' }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 5h16v11H9l-5 4V5z" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 9h8M8 12h5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
