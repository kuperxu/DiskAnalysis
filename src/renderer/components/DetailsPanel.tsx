import React, { useState } from 'react'
import { useStore } from '../store'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  formatBytes,
  isDirInert,
  isFileTrashing
} from '../categories'
import { useConfirm, useToasts } from './Notices'
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
    return (
      <FileInfo
        path={selectedPath}
        file={fileSelected}
        isTrashing={isFileTrashing(focused?.trashingFiles, fileSelected.name)}
      />
    )
  }

  // Otherwise show directory info for the focused node.
  const node = nodeAt(targetPath)
  if (!node) return <div style={{ color: '#64748b' }}>Unknown path.</div>
  return <DirInfo node={node} />
}

function DirInfo({ node }: { node: DirNode }): JSX.Element {
  const total = Math.max(1, node.size)
  const inert = isDirInert(node.status)
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
        <TrashButton
          path={node.path}
          sizeBytes={node.size}
          kind="folder"
          status={node.status}
          disabled={inert}
        />
      </div>
    </>
  )
}

function FileInfo({
  path,
  file,
  isTrashing
}: {
  path: string
  file: { name: string; size: number; category: FileCategory }
  isTrashing: boolean
}): JSX.Element {
  return (
    <>
      <h3 title={path}>{file.name}</h3>
      <div className="row"><span className="k">Path</span><span style={{ wordBreak: 'break-all', textAlign: 'right' }}>{path}</span></div>
      <div className="row"><span className="k">Size</span><span>{formatBytes(file.size)}</span></div>
      {isTrashing && (
        <div className="row"><span className="k">Status</span><span style={{ color: '#f87171' }}>trashing…</span></div>
      )}
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
        <TrashButton
          path={path}
          sizeBytes={file.size}
          kind="file"
          status={isTrashing ? 'trashing' : 'done'}
          disabled={isTrashing}
        />
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
  kind,
  status,
  disabled
}: {
  path: string
  sizeBytes: number
  kind: 'file' | 'folder'
  status: 'pending' | 'scanning' | 'done' | 'error' | 'denied' | 'trashing' | 'trashed' | 'collapsed'
  disabled: boolean
}): JSX.Element {
  // The "busy" state is now strictly the brief moment between confirm and
  // the IPC reply (which returns immediately after marking — see
  // src/main/index.ts). The actual move-to-trash runs in the background and
  // its progress is shown via node status (trashing → trashed).
  const [busy, setBusy] = useState(false)
  const ask = useConfirm((s) => s.ask)
  const pushToast = useToasts((s) => s.push)

  const onClick = async (): Promise<void> => {
    if (busy || disabled) return // double-click guard
    let ok = false
    try {
      ok = await ask({
        title: `Move this ${kind} to the Trash?`,
        body: `${formatBytes(sizeBytes)} · ${path}`,
        confirmLabel: 'Move to Trash',
        cancelLabel: 'Cancel',
        danger: true
      })
    } catch (e) {
      // ask() shouldn't throw, but if a future change breaks it we don't
      // want the button stuck in busy state.
      console.error('[trash] confirm failed', e)
      return
    }
    if (!ok) return
    setBusy(true)
    try {
      const res = await window.api.trash(path)
      if (!res.ok) {
        // Main side also pushes a richer notice for known error codes; this
        // fallback covers the synchronous refusal cases (existsSync, root).
        pushToast({
          kind: 'error',
          title: "Couldn't move to Trash",
          body: res.error,
          path
        })
      }
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Trash IPC failed',
        body: (e as Error).message,
        path
      })
    } finally {
      // Always release the busy latch — even if IPC throws or the renderer
      // is mid-tear-down, the button must not stay disabled.
      setBusy(false)
    }
  }

  const label = (() => {
    if (status === 'trashed') return 'Already moved to Trash'
    if (status === 'trashing' || busy) return 'Moving to Trash…'
    return `Move to Trash (${formatBytes(sizeBytes)})`
  })()

  return (
    <button className="danger" onClick={onClick} disabled={disabled || busy}>
      {label}
    </button>
  )
}
