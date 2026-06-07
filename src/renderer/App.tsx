import React, { useEffect } from 'react'
import { useStore } from './store'
import { ControlBar } from './components/ControlBar'
import { Sidebar } from './components/Sidebar'
import { TreemapView } from './components/TreemapView'
import { DetailsPanel } from './components/DetailsPanel'
import { LandingHero } from './components/LandingHero'
import { GettingStartedPanel } from './components/GettingStartedPanel'
import {
  ToastHost,
  ConfirmHost,
  useToasts
} from './components/Notices'
import { SettingsButton, useSettings } from './components/Settings'

export default function App(): JSX.Element {
  const setTree = useStore((s) => s.setTree)
  const applyPatch = useStore((s) => s.applyPatch)
  const setLifecycle = useStore((s) => s.setLifecycle)
  const tree = useStore((s) => s.tree)
  const pushToast = useToasts((s) => s.push)
  const hydrateSettings = useSettings((s) => s.hydrate)

  useEffect(() => {
    // Hydrate from main if it already has a tree (e.g. window reopened).
    window.api.getTree().then((t) => {
      if (t) setTree(t)
    })
    window.api.getSettings().then(hydrateSettings)
    const offPatch = window.api.onPatch(applyPatch)
    const offLife = window.api.onLifecycle(setLifecycle)
    const offNotice = window.api.onNotice(pushToast)
    return () => {
      offPatch()
      offLife()
      offNotice()
    }
  }, [setTree, applyPatch, setLifecycle, pushToast, hydrateSettings])

  return (
    <div className="app">
      <ControlBar />
      <div className="sidebar">
        <div className="sidebar-list">
          <Sidebar />
        </div>
        <SettingsButton />
      </div>
      <div className="treemap-pane">
        {tree ? <TreemapView /> : <LandingHero />}
      </div>
      <div className="details">
        {tree ? <DetailsPanel /> : <GettingStartedPanel />}
      </div>
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}
