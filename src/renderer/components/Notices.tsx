import React, { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { Notice } from '@shared/types'

interface ToastState {
  toasts: (Notice & { id: string })[]
  push: (n: Notice) => void
  dismiss: (id: string) => void
}

/**
 * Lightweight toast store. Decoupled from the main app store because notices
 * fan in from IPC and from user-side actions (like confirmation modals), and
 * we don't want a store-wide rerender for every dismissed toast.
 */
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (n) =>
    set((s) => {
      const id = n.id ?? Math.random().toString(36).slice(2)
      // Deduplicate by id: replaces previous occurrence so repeated permission
      // errors for the same path don't stack.
      const without = s.toasts.filter((t) => t.id !== id)
      return { toasts: [...without, { ...n, id }] }
    }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export function ToastHost(): JSX.Element {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <Toast key={t.id} notice={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function Toast({
  notice,
  onDismiss
}: {
  notice: Notice & { id: string }
  onDismiss: () => void
}): JSX.Element {
  // Info / success toasts auto-dismiss; errors and permission notices stick
  // until the user clicks them (or the X).
  useEffect(() => {
    if (notice.kind === 'info' || notice.kind === 'success') {
      const id = window.setTimeout(onDismiss, 4500)
      return () => window.clearTimeout(id)
    }
    return
  }, [notice.id, notice.kind, onDismiss])

  const openSettings = (): void => {
    // Deep-link to the Full Disk Access pane. macOS opens System Settings on
    // the right pane when given this URL.
    window.api.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
    )
  }

  return (
    <div className={`toast ${notice.kind}`} role="alert">
      <div className="toast-title">{notice.title}</div>
      {notice.body && <div className="toast-body">{notice.body}</div>}
      {notice.path && <div className="toast-path">{notice.path}</div>}
      {notice.kind === 'permission' && (
        <button className="toast-action" onClick={openSettings}>
          Open Full Disk Access settings
        </button>
      )}
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

/* ─────────────────── confirm modal (non-blocking) ─────────────────── */

interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null
  ask: (req: ConfirmRequest) => Promise<boolean>
  resolve: (ok: boolean) => void
}

/**
 * Replaces window.confirm() which is synchronous and freezes the renderer's
 * main thread. This pumps a real React modal and resolves a Promise on
 * either action.
 */
export const useConfirm = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      set({ request: { ...req, resolve } })
    }),
  resolve: (ok) => {
    const req = get().request
    if (req) {
      req.resolve(ok)
      set({ request: null })
    }
  }
}))

export function ConfirmHost(): JSX.Element | null {
  const request = useConfirm((s) => s.request)
  const resolve = useConfirm((s) => s.resolve)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (request) {
      setMounted(true)
      // Focus the confirm button so Enter triggers it; Escape cancels.
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') resolve(false)
        if (e.key === 'Enter') resolve(true)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
    return
  }, [request, resolve])

  if (!request || !mounted) return null

  return (
    <div className="modal-backdrop" onClick={() => resolve(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{request.title}</div>
        {request.body && <div className="modal-body">{request.body}</div>}
        <div className="modal-actions">
          <button onClick={() => resolve(false)}>
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={request.danger ? 'danger' : 'primary'}
            onClick={() => resolve(true)}
            autoFocus
          >
            {request.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
