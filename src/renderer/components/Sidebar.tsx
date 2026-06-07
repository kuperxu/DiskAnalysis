import React, { useState } from 'react'
import { useStore } from '../store'
import type { DirNode } from '@shared/types'
import { formatBytes, isDirInert } from '../categories'
import sidebarEmptyArt from '../assets/sidebar-empty.png'

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
        <img src={sidebarEmptyArt} alt="" draggable={false} />
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
 *  Source PNG lives in `assets/sidebar-empty.png` (3D-rendered art). */

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
