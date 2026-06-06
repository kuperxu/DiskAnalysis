import React, { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import { useStore } from '../store'
import type { DirNode, FileEntry, FileCategory } from '@shared/types'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  dominantCategory,
  formatBytes,
  isDirInert,
  isFileTrashing
} from '../categories'

/**
 * Squarified treemap of the focused directory's immediate children
 * (subdirs + leaf files). Click a directory cell to drill in (and boost its
 * scan priority). Click a file cell to select it for the details panel.
 */
export function TreemapView(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const focusPath = useStore((s) => s.focusPath)
  const setFocus = useStore((s) => s.setFocus)
  const setSelected = useStore((s) => s.setSelected)
  const nodeAt = useStore((s) => s.nodeAt)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const focused: DirNode | null = focusPath ? nodeAt(focusPath) : tree
  const layout = useMemo(() => {
    if (!focused) return null
    return computeLayout(focused, size.w, size.h)
  }, [
    focused,
    size.w,
    size.h,
    // re-layout when relevant aspects of the focused subtree change
    focused?.size,
    Object.keys(focused?.children ?? {}).length,
    focused?.files.length,
    focused?.status,
    serializeTrashingFiles(focused?.trashingFiles),
    serializeChildStatuses(focused)
  ])

  const [hover, setHover] = useState<{
    x: number
    y: number
    label: string
    sub: string
    bytes: number
    note?: string
  } | null>(null)

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseLeave={() => setHover(null)}
    >
      <svg width={size.w} height={size.h} style={{ display: 'block' }}>
        {layout?.cells.map((c) => {
          const isDir = c.kind === 'dir'
          const inert =
            c.status === 'trashing' ||
            c.status === 'trashed' ||
            (c.kind === 'file' && c.fileTrashing === true)
          const cellClass = [
            'cell',
            isDir && (c.status === 'scanning' || c.status === 'pending') ? 'scanning' : '',
            c.status === 'denied' ? 'denied' : '',
            c.status === 'trashing' || c.fileTrashing ? 'trashing' : '',
            c.status === 'trashed' ? 'trashed' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <g
              key={c.path}
              className={cellClass}
              transform={`translate(${c.x0},${c.y0})`}
              onClick={() => {
                if (inert) return
                if (isDir) {
                  setFocus(c.path)
                  window.api.focus(c.path)
                } else {
                  setSelected(c.path)
                }
              }}
              onMouseMove={(e) => {
                const rect = containerRef.current?.getBoundingClientRect()
                setHover({
                  x: (e.clientX - (rect?.left ?? 0)) + 12,
                  y: (e.clientY - (rect?.top ?? 0)) + 12,
                  label: basename(c.path),
                  sub: c.path,
                  bytes: c.value,
                  note:
                    c.status === 'trashing' || c.fileTrashing
                      ? 'Moving to Trash…'
                      : c.status === 'trashed'
                        ? 'Moved to Trash'
                        : undefined
                })
              }}
              style={{ cursor: inert ? 'not-allowed' : 'pointer' }}
            >
              <rect
                width={Math.max(0, c.x1 - c.x0)}
                height={Math.max(0, c.y1 - c.y0)}
                fill={c.color}
                opacity={
                  c.status === 'trashing' || c.fileTrashing
                    ? 0.35
                    : c.status === 'trashed'
                      ? 0.5
                      : c.kind === 'file'
                        ? 0.75
                        : 0.92
                }
              />
              {c.x1 - c.x0 > 70 && c.y1 - c.y0 > 22 && (
                <>
                  <text className="cell-label" x={6} y={14}>
                    {truncate(basename(c.path), Math.floor((c.x1 - c.x0) / 7))}
                  </text>
                  {c.y1 - c.y0 > 38 && (
                    <text className="cell-label size" x={6} y={28}>
                      {formatBytes(c.value)}
                    </text>
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>

      {focused?.status === 'pending' && (
        <div className="empty-state">Scanning {focused.path}…</div>
      )}
      {focused && Object.keys(focused.children).length === 0 && focused.files.length === 0 && focused.status === 'done' && (
        <div className="empty-state">Empty directory.</div>
      )}

      <Legend />

      {hover && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <div><strong>{hover.label}</strong></div>
          <div className="path">{hover.sub}</div>
          <div className="size">{formatBytes(hover.bytes)}</div>
          {hover.note && <div style={{ color: '#fca5a5' }}>{hover.note}</div>}
        </div>
      )}
    </div>
  )
}

interface Cell {
  path: string
  kind: 'dir' | 'file'
  status: 'pending' | 'scanning' | 'done' | 'error' | 'denied' | 'trashing' | 'trashed'
  /** Only relevant for files — set when the file is mid-trash. */
  fileTrashing?: boolean
  x0: number
  y0: number
  x1: number
  y1: number
  value: number
  color: string
}

interface Layout {
  cells: Cell[]
}

interface Item {
  path: string
  kind: 'dir' | 'file'
  status: Cell['status']
  fileTrashing?: boolean
  value: number
  color: string
}

function computeLayout(node: DirNode, w: number, h: number): Layout {
  // Build a list of "items" — children dirs and own files — that we'll feed
  // into d3-hierarchy as a flat one-level tree.
  const items: Item[] = []

  for (const child of Object.values(node.children)) {
    items.push({
      path: child.path,
      kind: 'dir',
      status: child.status,
      value: Math.max(child.size, child.status === 'pending' || child.status === 'scanning' ? 1 : 0),
      color: CATEGORY_COLOR[dominantCategory(child.breakdown)]
    })
  }
  // Group small files into their categories rather than rendering every leaf.
  // For files larger than 0.5% of parent or top 50 absolute, keep individual.
  const totalOwn = node.files.reduce((s, f) => s + f.size, 0)
  const threshold = Math.max(totalOwn * 0.005, 1024 * 1024) // 1MB or 0.5%
  const big: FileEntry[] = []
  const grouped: Record<FileCategory, number> = {
    video: 0, image: 0, audio: 0, archive: 0, code: 0,
    document: 0, cache: 0, binary: 0, app: 0, other: 0
  }
  for (const f of node.files) {
    if (f.size >= threshold) big.push(f)
    else grouped[f.category] += f.size
  }
  big.sort((a, b) => b.size - a.size)
  for (const f of big.slice(0, 200)) {
    items.push({
      path: node.path + '/' + f.name,
      kind: 'file',
      status: 'done',
      fileTrashing: isFileTrashing(node.trashingFiles, f.name),
      value: f.size,
      color: CATEGORY_COLOR[f.category]
    })
  }
  for (const c of CATEGORY_ORDER) {
    if (grouped[c] > 0) {
      items.push({
        path: `${node.path}/§other-${c}`,
        kind: 'file',
        status: 'done',
        value: grouped[c],
        color: CATEGORY_COLOR[c]
      })
    }
  }

  if (items.length === 0) return { cells: [] }

  const root = hierarchy<{ children?: Item[]; value?: number }>({ children: items as never })
    .sum((d) => (d as Item).value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  const lay = treemap<{ children?: Item[] }>()
    .tile(treemapSquarify)
    .size([w, h])
    .padding(1)
    .round(true)(root)

  const cells: Cell[] = []
  for (const leaf of lay.leaves()) {
    const item = leaf.data as unknown as Item
    cells.push({
      path: item.path,
      kind: item.kind,
      status: item.status,
      fileTrashing: item.fileTrashing,
      x0: leaf.x0!,
      y0: leaf.y0!,
      x1: leaf.x1!,
      y1: leaf.y1!,
      value: item.value,
      color: item.color
    })
  }
  return { cells }
}

function basename(p: string): string {
  if (p.includes('/§other-')) return 'other ' + p.split('/§other-')[1]
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function serializeTrashingFiles(
  t: string[] | Set<string> | undefined
): string {
  if (!t) return ''
  if (Array.isArray(t)) return t.join(',')
  return Array.from(t).join(',')
}

function serializeChildStatuses(node: DirNode | null): string {
  if (!node) return ''
  // Cheap fingerprint — picks up trashing/trashed/scanning transitions of
  // any direct child so the treemap re-renders.
  const parts: string[] = []
  for (const c of Object.values(node.children)) parts.push(c.status)
  return parts.join(',')
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(1, n - 1)) + '…'
}

function Legend(): JSX.Element {
  return (
    <div className="legend">
      {CATEGORY_ORDER.map((c) => (
        <span key={c}>
          <span className="swatch" style={{ background: CATEGORY_COLOR[c] }} />
          {CATEGORY_LABEL[c]}
        </span>
      ))}
    </div>
  )
}
