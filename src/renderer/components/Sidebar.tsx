import React, { useState } from 'react'
import { useStore } from '../store'
import type { DirNode } from '@shared/types'
import { formatBytes, isDirInert } from '../categories'

export function Sidebar(): JSX.Element {
  const tree = useStore((s) => s.tree)
  if (!tree) return <SidebarEmpty />
  return (
    <div>
      <div className="sidebar-header">
        <span className="sidebar-header-icon" aria-hidden="true">▦</span>
        <span className="sidebar-header-title">Scans</span>
        <span className="sidebar-header-count">1</span>
      </div>
      <TreeRow node={tree} depth={0} />
    </div>
  )
}

/** Pre-scan sidebar: header + decorative illustration + two outline buttons.
 *  The buttons are placeholders for future features (recent folders memory,
 *  saved smart cleanup rules) and currently no-op. */
function SidebarEmpty(): JSX.Element {
  return (
    <div className="sidebar-empty">
      <div className="sidebar-header">
        <span className="sidebar-header-icon" aria-hidden="true">▦</span>
        <span className="sidebar-header-title">Scans</span>
        <span className="sidebar-header-count">0</span>
      </div>
      <div className="sidebar-empty-art">
        <SidebarFolderArt />
      </div>
      <div className="sidebar-empty-title">No scans yet</div>
      <div className="sidebar-empty-sub">
        Your scanned folders<br />will appear here.
      </div>
      <div className="sidebar-empty-actions">
        <button className="ghost-pill" disabled title="Coming soon">
          <span className="pill-glyph" aria-hidden="true">⏱</span>
          Recent folders
        </button>
        <button className="ghost-pill" disabled title="Coming soon">
          <span className="pill-glyph" aria-hidden="true">▽</span>
          Smart cleanup rules
        </button>
      </div>
    </div>
  )
}

/** Decorative folder + magnifier illustration for the empty sidebar.
 *  Pure inline SVG so it survives the bundler without needing an asset. */
function SidebarFolderArt(): JSX.Element {
  return (
    <svg
      viewBox="0 0 160 140"
      width="140"
      height="120"
      role="img"
      aria-label="No scans"
    >
      <defs>
        <linearGradient id="sidebar-folder-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="sidebar-disk-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      {/* Disk slab */}
      <ellipse cx="80" cy="120" rx="58" ry="10" fill="url(#sidebar-disk-grad)" />
      {/* Back folder */}
      <path
        d="M30 60 Q30 54 36 54 L70 54 L78 60 L120 60 Q126 60 126 66 L126 102 Q126 108 120 108 L36 108 Q30 108 30 102 Z"
        fill="#1e3a8a"
        opacity="0.85"
      />
      {/* Front folder */}
      <path
        d="M40 70 Q40 64 46 64 L72 64 L80 70 L114 70 Q120 70 120 76 L120 110 Q120 116 114 116 L46 116 Q40 116 40 110 Z"
        fill="url(#sidebar-folder-grad)"
      />
      {/* Magnifier */}
      <circle cx="100" cy="58" r="14" fill="none" stroke="#93c5fd" strokeWidth="3" />
      <line x1="110" y1="68" x2="120" y2="78" stroke="#93c5fd" strokeWidth="3" strokeLinecap="round" />
      {/* Sparkles */}
      <g fill="#60a5fa">
        <circle cx="24" cy="46" r="1.5" />
        <circle cx="138" cy="42" r="2" />
        <circle cx="146" cy="78" r="1.5" />
        <circle cx="18" cy="92" r="1.5" />
      </g>
    </svg>
  )
}

interface RowProps {
  node: DirNode
  depth: number
}

function TreeRow({ node, depth }: RowProps): JSX.Element {
  const focusPath = useStore((s) => s.focusPath)
  const setFocus = useStore((s) => s.setFocus)
  const [open, setOpen] = useState(depth === 0)

  const children = Object.values(node.children).sort((a, b) => b.size - a.size)
  const hasChildren = children.length > 0
  const isActive = focusPath === node.path
  const isScanning = node.status === 'scanning' || node.status === 'pending'
  const inert = isDirInert(node.status)

  const handleClick = (): void => {
    if (inert) return // greyed-out / tombstoned — ignore clicks
    setFocus(node.path)
    if (hasChildren) setOpen(true)
    // Boost priority on click so unscanned subtrees come up faster.
    window.api.focus(node.path)
  }

  const stateClass =
    node.status === 'trashing'
      ? 'trashing'
      : node.status === 'trashed'
        ? 'trashed'
        : node.status === 'collapsed'
          ? 'collapsed'
          : isScanning
            ? 'scanning'
            : ''

  return (
    <div>
      <div
        className={`tree-row ${isActive && !inert ? 'active' : ''} ${stateClass}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={handleClick}
        title={
          node.status === 'trashing'
            ? 'Moving to Trash…'
            : node.status === 'trashed'
              ? 'Moved to Trash'
              : node.status === 'collapsed'
                ? 'Collapsed (below the threshold setting). Click to expand.'
                : node.path
        }
      >
        <span
          className="twirl"
          onClick={(e) => {
            e.stopPropagation()
            if (inert) return
            setOpen((o) => !o)
          }}
        >
          {hasChildren ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="name" title={node.path}>
          {basename(node.path) || node.path}
        </span>
        <span className="size">{formatBytes(node.size)}</span>
      </div>
      {open &&
        children
          .slice(0, 200) // cap render depth per level to avoid runaway DOM
          .map((c) => <TreeRow key={c.path} node={c} depth={depth + 1} />)}
    </div>
  )
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}
