import React, { useState } from 'react'
import { useStore } from '../store'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  formatBytes
} from '../categories'
import type { DirNode, FileCategory } from '@shared/types'

export function DetailsPanel(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const focusPath = useStore((s) => s.focusPath)
  const selectedPath = useStore((s) => s.selectedPath)
  const nodeAt = useStore((s) => s.nodeAt)

  if (!tree) return <div style={{ color: '#64748b' }}>Pick a folder to begin.</div>

  const targetPath = selectedPath ?? focusPath ?? tree.path
  const isPseudoFile = targetPath?.includes('/§other-')
  if (isPseudoFile) {
    return <PseudoInfo path={targetPath!} />
  }

  // Selected might be a real file inside the focused dir.
  const focused = focusPath ? nodeAt(focusPath) : tree
  const fileSelected = (() => {
    if (!selectedPath || !focused) return null
    const i = selectedPath.lastIndexOf('/')
    const name = i >= 0 ? selectedPath.slice(i + 1) : selectedPath
    return focused.files.find((f) => f.name === name) ?? null
  })()

  if (fileSelected && selectedPath) {
    return <FileInfo path={selectedPath} file={fileSelected} />
  }

  // Otherwise show directory info for the focused node.
  const node = nodeAt(targetPath)
  if (!node) return <div style={{ color: '#64748b' }}>Unknown path.</div>
  return <DirInfo node={node} />
}

function DirInfo({ node }: { node: DirNode }): JSX.Element {
  const total = Math.max(1, node.size)
  return (
    <>
      <h3 title={node.path}>{node.path}</h3>
      <div className="row"><span className="k">Total</span><span>{formatBytes(node.size)}</span></div>
      <div className="row"><span className="k">Own files</span><span>{formatBytes(node.ownSize)}</span></div>
      <div className="row"><span className="k">Subdirs</span><span>{Object.keys(node.children).length}</span></div>
      <div className="row"><span className="k">Status</span><span>{node.status}</span></div>
      {node.error && (
        <div className="row"><span className="k">Error</span><span>{node.error}</span></div>
      )}

      <div className="section-title">Composition</div>
      <div className="bar-stack">
        {CATEGORY_ORDER.map((c) =>
          node.breakdown[c] > 0 ? (
            <div
              key={c}
              style={{
                width: `${(node.breakdown[c] / total) * 100}%`,
                background: CATEGORY_COLOR[c]
              }}
              title={`${CATEGORY_LABEL[c]}: ${formatBytes(node.breakdown[c])}`}
            />
          ) : null
        )}
      </div>
      {CATEGORY_ORDER.filter((c) => node.breakdown[c] > 0).map((c) => (
        <div key={c} className="row">
          <span className="k">
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: CATEGORY_COLOR[c],
                borderRadius: 2,
                marginRight: 6
              }}
            />
            {CATEGORY_LABEL[c]}
          </span>
          <span>{formatBytes(node.breakdown[c])}</span>
        </div>
      ))}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <RevealButton path={node.path} />
        <TrashButton path={node.path} sizeBytes={node.size} kind="folder" />
      </div>
    </>
  )
}

function FileInfo({ path, file }: { path: string; file: { name: string; size: number; category: FileCategory } }): JSX.Element {
  return (
    <>
      <h3 title={path}>{file.name}</h3>
      <div className="row"><span className="k">Path</span><span style={{ wordBreak: 'break-all', textAlign: 'right' }}>{path}</span></div>
      <div className="row"><span className="k">Size</span><span>{formatBytes(file.size)}</span></div>
      <div className="row">
        <span className="k">Category</span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: CATEGORY_COLOR[file.category],
              borderRadius: 2,
              marginRight: 6
            }}
          />
          {CATEGORY_LABEL[file.category]}
        </span>
      </div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <RevealButton path={path} />
        <TrashButton path={path} sizeBytes={file.size} kind="file" />
      </div>
    </>
  )
}

function PseudoInfo({ path }: { path: string }): JSX.Element {
  const cat = path.split('/§other-')[1] as FileCategory
  return (
    <>
      <h3>Other {CATEGORY_LABEL[cat] ?? cat} files</h3>
      <p style={{ color: '#94a3b8' }}>
        These small files were grouped together for the treemap view. Drill into
        a subfolder or sort by file in the future to see individual entries.
      </p>
    </>
  )
}

function RevealButton({ path }: { path: string }): JSX.Element {
  return (
    <button onClick={() => window.api.reveal(path)}>Show in Finder</button>
  )
}

function TrashButton({
  path,
  sizeBytes,
  kind
}: {
  path: string
  sizeBytes: number
  kind: 'file' | 'folder'
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const onClick = async (): Promise<void> => {
    const ok = window.confirm(
      `Move this ${kind} to the Trash?\n\n${path}\n\n${formatBytes(sizeBytes)}`
    )
    if (!ok) return
    setBusy(true)
    setErr(null)
    const res = await window.api.trash(path)
    setBusy(false)
    if (!res.ok) setErr(res.error)
  }
  return (
    <>
      <button className="danger" onClick={onClick} disabled={busy}>
        {busy ? 'Moving…' : `Move to Trash (${formatBytes(sizeBytes)})`}
      </button>
      {err && <div style={{ color: '#fca5a5', marginTop: 6 }}>Failed: {err}</div>}
    </>
  )
}
