// Shared types between main and renderer.
// Keep this file dependency-free so it can be imported from any process.

export type FileCategory =
  | 'video'
  | 'image'
  | 'audio'
  | 'archive'
  | 'code'
  | 'document'
  | 'cache'
  | 'binary'
  | 'app'
  | 'other'

export type ScanStatus =
  | 'pending'
  | 'scanning'
  | 'done'
  | 'error'
  | 'denied'
  /** Optimistically marked for trash; user can't interact with it. */
  | 'trashing'
  /** Trashed successfully but kept as a tombstone in the tree (greyed-out
   *  red) so the user can see what was removed. The node is not pruned —
   *  it's just inert. */
  | 'trashed'

/** A summarized file entry kept on its parent directory. We never create a
 *  full DirNode for leaf files — there can be millions, and they don't have
 *  children to track. */
export interface FileEntry {
  name: string
  size: number
  category: FileCategory
}

/** A directory node held in the in-memory tree. */
export interface DirNode {
  path: string
  /** Total bytes inside this directory (own files + scanned subdirs).
   *  Grows incrementally as children finish scanning. */
  size: number
  /** Bytes from leaf files directly inside this dir (final once status === 'done'). */
  ownSize: number
  /** Map<childName, DirNode>. Serialized as plain object across IPC. */
  children: Record<string, DirNode>
  /** Leaf files in this directory. Final once status === 'done'. */
  files: FileEntry[]
  status: ScanStatus
  /** Per-category byte aggregate (recursive). */
  breakdown: Record<FileCategory, number>
  /** True if this dir crosses a mount point and was therefore not descended. */
  crossDevice?: boolean
  /** Optional error message when status === 'error' or 'denied'. */
  error?: string
  /** Names of leaf files inside this directory that are mid-trash (UI greys
   *  them out). Cleared when the trash op completes (file is removed from
   *  `files`) or fails (entry removed from this set). Sent over IPC as a
   *  plain array — see serializeNode. */
  trashingFiles?: Set<string> | string[]
}

/** A patch broadcast from main to renderer when a directory finishes scanning.
 *  The full subtree state at `path` is provided; renderer replaces the node
 *  in place. We send small subtrees (one dir + its immediate children stubs),
 *  not the whole tree, to keep IPC traffic bounded. */
export interface TreePatch {
  path: string
  node: DirNode
  /** Cumulative size delta applied to ancestors. Renderer walks up and adds. */
  ancestorDelta?: number
  /** Per-category delta to apply to ancestors. */
  ancestorBreakdownDelta?: Partial<Record<FileCategory, number>>
}

export type ScanLifecycle =
  | { kind: 'idle' }
  | { kind: 'scanning'; root: string; queued: number; inFlight: number }
  | { kind: 'paused'; root: string; queued: number }
  | { kind: 'done'; root: string; totalBytes: number; durationMs: number }
  | { kind: 'error'; root: string; message: string }

/** Channels exposed to the renderer via contextBridge. */
export interface RendererApi {
  /** Pick a directory via the system dialog; returns the chosen path or null. */
  pickRoot: () => Promise<string | null>

  /** Begin scanning at `root`. Resets any prior scan. */
  start: (root: string) => Promise<void>

  /** Pause the worker pool. In-flight readdir calls finish; the queue stops draining. */
  pause: () => Promise<void>

  /** Resume from pause. */
  resume: () => Promise<void>

  /** User clicked a directory — boost priority of its pending subtree so it
   *  scans next. No-op if path already 'done' or unknown. */
  focus: (path: string) => Promise<void>

  /** Move a file/dir to the system trash and prune it from the tree.
   *  Returns immediately after marking the node — actual deletion runs in
   *  the background and lifecycle of the node updates via tree patches
   *  (status: 'trashing' → 'trashed' or back to 'done' on failure). */
  trash: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>

  /** Reveal the path in Finder (selects it in its parent folder). */
  reveal: (path: string) => Promise<void>

  /** Subscribe to incremental tree patches. Returns an unsubscribe fn. */
  onPatch: (cb: (patch: TreePatch) => void) => () => void

  /** Subscribe to scan lifecycle changes. Returns an unsubscribe fn. */
  onLifecycle: (cb: (s: ScanLifecycle) => void) => () => void

  /** Get current full tree (used after the renderer (re)mounts). */
  getTree: () => Promise<DirNode | null>
}

declare global {
  interface Window {
    api: RendererApi
  }
}

/** IPC channel string constants — main and preload reference these. */
export const IPC = {
  // command -> main
  pickRoot: 'scan:pickRoot',
  start: 'scan:start',
  pause: 'scan:pause',
  resume: 'scan:resume',
  focus: 'scan:focus',
  trash: 'fs:trash',
  reveal: 'fs:reveal',
  getTree: 'scan:getTree',
  // event -> renderer
  patch: 'scan:patch',
  lifecycle: 'scan:lifecycle'
} as const
