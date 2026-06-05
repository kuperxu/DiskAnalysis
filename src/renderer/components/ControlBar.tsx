import React from 'react'
import { useStore } from '../store'
import { formatBytes } from '../categories'

export function ControlBar(): JSX.Element {
  const lifecycle = useStore((s) => s.lifecycle)
  const tree = useStore((s) => s.tree)
  const focusPath = useStore((s) => s.focusPath)
  const setFocus = useStore((s) => s.setFocus)

  const handlePick = async (): Promise<void> => {
    const p = await window.api.pickRoot()
    if (p) await window.api.start(p)
  }

  const statusText = (() => {
    switch (lifecycle.kind) {
      case 'idle':
        return 'Idle'
      case 'scanning':
        return `Scanning · queued ${lifecycle.queued} · in-flight ${lifecycle.inFlight}`
      case 'paused':
        return `Paused · ${lifecycle.queued} queued`
      case 'done':
        return `Done · ${formatBytes(lifecycle.totalBytes)} · ${(lifecycle.durationMs / 1000).toFixed(1)}s`
      case 'error':
        return `Error: ${lifecycle.message}`
    }
  })()

  return (
    <div className="topbar">
      <button onClick={handlePick}>Choose folder…</button>
      <button
        disabled={lifecycle.kind !== 'scanning'}
        onClick={() => window.api.pause()}
      >
        Pause
      </button>
      <button
        disabled={lifecycle.kind !== 'paused'}
        onClick={() => window.api.resume()}
      >
        Resume
      </button>

      <Breadcrumb
        root={tree?.path ?? null}
        focusPath={focusPath}
        onJump={setFocus}
      />

      <span className="status">{statusText}</span>
    </div>
  )
}

interface BreadcrumbProps {
  root: string | null
  focusPath: string | null
  onJump: (p: string) => void
}

function Breadcrumb({ root, focusPath, onJump }: BreadcrumbProps): JSX.Element {
  if (!root || !focusPath) return <div className="breadcrumb" />
  const tail = focusPath === root ? '' : focusPath.slice(root.length).replace(/^\/+/, '')
  const segs = tail ? tail.split('/') : []
  return (
    <div className="breadcrumb">
      <span
        className={`seg ${segs.length === 0 ? 'last' : ''}`}
        onClick={() => onJump(root)}
      >
        {root}
      </span>
      {segs.map((s, i) => {
        const p = [root, ...segs.slice(0, i + 1)].join('/')
        const isLast = i === segs.length - 1
        return (
          <React.Fragment key={p}>
            <span className="sep">›</span>
            <span
              className={`seg ${isLast ? 'last' : ''}`}
              onClick={() => onJump(p)}
            >
              {s}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}
