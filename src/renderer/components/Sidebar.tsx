import React, { useState } from 'react'
import { useStore } from '../store'
import type { DirNode } from '@shared/types'
import { formatBytes } from '../categories'

export function Sidebar(): JSX.Element {
  const tree = useStore((s) => s.tree)
  if (!tree) return <div style={{ color: '#64748b' }}>No scan yet.</div>
  return (
    <div>
      <TreeRow node={tree} depth={0} />
    </div>
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

  const handleClick = (): void => {
    setFocus(node.path)
    if (hasChildren) setOpen(true)
    // Boost priority on click so unscanned subtrees come up faster.
    window.api.focus(node.path)
  }

  return (
    <div>
      <div
        className={`tree-row ${isActive ? 'active' : ''} ${isScanning ? 'scanning' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={handleClick}
      >
        <span
          className="twirl"
          onClick={(e) => {
            e.stopPropagation()
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
