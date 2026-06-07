import React, { useEffect, useState } from 'react'
import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

/**
 * Renderer-side mirror of the persisted settings. Hydrated from main on
 * mount (see App.tsx). Writes go back through window.api.setSettings,
 * which both persists and re-runs scanner.applySettings().
 *
 * We keep a local copy of the current value so the UI can render
 * immediately without awaiting IPC on every render.
 */
export const useSettings = create<{
  value: Settings
  hydrated: boolean
  set: (patch: Partial<Settings>) => Promise<void>
  hydrate: (s: Settings) => void
}>((set, get) => ({
  value: { ...DEFAULT_SETTINGS },
  hydrated: false,
  hydrate: (s) => set({ value: s, hydrated: true }),
  set: async (patch) => {
    // Optimistic update; reconcile with whatever main returned (handles
    // server-side clamping in the future).
    set({ value: { ...get().value, ...patch } })
    const saved = await window.api.setSettings(patch)
    set({ value: saved })
  }
}))

/** Floating Settings button, anchored bottom-left over the sidebar. The
 *  caller is responsible for ensuring no other floating UI lives there. */
export function SettingsButton(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="settings-button"
        onClick={(e) => {
          setOpen(true)
          // Drop focus right away — we never want the button to look
          // selected after click. Combined with the no-focus-ring CSS this
          // keeps the button visually inert at all times (the user already
          // sees the modal as the activated state).
          e.currentTarget.blur()
        }}
        title="Settings"
        aria-label="Settings"
      >
        <span className="settings-icon" aria-hidden="true">⚙</span>
        <span>Settings</span>
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const value = useSettings((s) => s.value)
  const update = useSettings((s) => s.set)

  // Local draft so the slider updates instantly without awaiting IPC for
  // each tick; commit on blur/release.
  const [draftMb, setDraftMb] = useState(
    () => Math.round(value.expandDirThreshold / (1024 * 1024))
  )

  useEffect(() => {
    // Sync if the persisted value changed underneath us.
    setDraftMb(Math.round(value.expandDirThreshold / (1024 * 1024)))
  }, [value.expandDirThreshold])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commit = (mb: number): void => {
    const clamped = Math.max(0, Math.min(10_000, mb))
    update({ expandDirThreshold: clamped * 1024 * 1024 })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 420 }}>
        <div className="modal-title">Settings</div>

        <div className="settings-row">
          <label htmlFor="min-scan-size">
            <div className="settings-label">Collapse folders smaller than</div>
            <div className="settings-hint">
              Every folder is fully scanned for accurate sizes, but folders
              whose total size falls below this are shown as a single collapsed
              block (file details are dropped). Click a collapsed folder to
              expand it. Set to 0 to disable collapsing.
            </div>
          </label>
          <div className="settings-control">
            <input
              id="min-scan-size"
              type="number"
              min={0}
              max={10000}
              step={10}
              value={draftMb}
              onChange={(e) => setDraftMb(Number(e.target.value) || 0)}
              onBlur={() => commit(draftMb)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commit(draftMb)
                }
              }}
            />
            <span className="settings-unit">MB</span>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="primary">Done</button>
        </div>
      </div>
    </div>
  )
}
