import React, { useEffect } from 'react'
import { useStore } from './store'
import { ControlBar } from './components/ControlBar'
import { Sidebar } from './components/Sidebar'
import { TreemapView } from './components/TreemapView'
import { DetailsPanel } from './components/DetailsPanel'

export default function App(): JSX.Element {
  const setTree = useStore((s) => s.setTree)
  const applyPatch = useStore((s) => s.applyPatch)
  const setLifecycle = useStore((s) => s.setLifecycle)
  const tree = useStore((s) => s.tree)

  useEffect(() => {
    // Hydrate from main if it already has a tree (e.g. window reopened).
    window.api.getTree().then((t) => {
      if (t) setTree(t)
    })
    const offPatch = window.api.onPatch(applyPatch)
    const offLife = window.api.onLifecycle(setLifecycle)
    return () => {
      offPatch()
      offLife()
    }
  }, [setTree, applyPatch, setLifecycle])

  return (
    <div className="app">
      <ControlBar />
      <div className="sidebar">
        <Sidebar />
      </div>
      <div className="treemap-pane">
        {tree ? (
          <TreemapView />
        ) : (
          <div className="empty-state">
            <div>No scan yet.</div>
            <button
              className="primary"
              onClick={async () => {
                const p = await window.api.pickRoot()
                if (p) await window.api.start(p)
              }}
            >
              Choose a folder to scan
            </button>
            <button
              onClick={async () => {
                const ok = window.confirm(
                  'Scan the entire disk starting from "/"?\n\n' +
                    'This may take a long time and requires Full Disk Access ' +
                    '(System Settings → Privacy & Security → Full Disk Access) ' +
                    'to see ~/Library and other protected folders. System paths ' +
                    'and other mounted volumes are skipped automatically.'
                )
                if (ok) await window.api.start('/')
              }}
            >
              Scan entire disk
            </button>
          </div>
        )}
      </div>
      <div className="details">
        <DetailsPanel />
      </div>
    </div>
  )
}
