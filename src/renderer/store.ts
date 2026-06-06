import { create } from 'zustand'
import { produce } from 'immer'
import type {
  DirNode,
  TreePatch,
  ScanLifecycle,
  FileCategory
} from '@shared/types'

const emptyBreakdown = (): Record<FileCategory, number> => ({
  video: 0, image: 0, audio: 0, archive: 0, code: 0,
  document: 0, cache: 0, binary: 0, app: 0, other: 0
})

const blankNode = (path: string): DirNode => ({
  path,
  size: 0,
  ownSize: 0,
  children: {},
  files: [],
  status: 'pending',
  breakdown: emptyBreakdown()
})

interface AppState {
  tree: DirNode | null
  /** Currently focused path (treemap & details panel). Defaults to root. */
  focusPath: string | null
  /** Selected file/folder path inside the focused dir, for the details panel. */
  selectedPath: string | null
  lifecycle: ScanLifecycle

  setTree: (n: DirNode | null) => void
  setFocus: (p: string | null) => void
  setSelected: (p: string | null) => void
  applyPatch: (patch: TreePatch) => void
  setLifecycle: (s: ScanLifecycle) => void
  /** Navigate to a node by path; returns the node or null. */
  nodeAt: (p: string) => DirNode | null
}

export const useStore = create<AppState>((set, get) => ({
  tree: null,
  focusPath: null,
  selectedPath: null,
  lifecycle: { kind: 'idle' },

  setTree: (n) => set({ tree: n, focusPath: n?.path ?? null, selectedPath: null }),
  setFocus: (p) => set({ focusPath: p, selectedPath: null }),
  setSelected: (p) => set({ selectedPath: p }),
  setLifecycle: (s) =>
    set((state) =>
      produce(state, (draft) => {
        // When the scan root changes, reset the tree proactively. This stops
        // late patches from a previous scan flickering the UI; they'll be
        // dropped by the isInsideCurrent guard in applyPatch.
        const lifecycleRoot =
          s.kind === 'scanning' || s.kind === 'paused' || s.kind === 'done' || s.kind === 'error'
            ? s.root
            : null
        if (lifecycleRoot && draft.tree && draft.tree.path !== lifecycleRoot) {
          draft.tree = blankNode(lifecycleRoot)
          draft.focusPath = lifecycleRoot
          draft.selectedPath = null
        }
        draft.lifecycle = s
      })
    ),

  applyPatch: (patch) =>
    set((state) =>
      produce(state, (draft) => {
        // A patch whose path is NOT inside the current tree means a brand-new
        // scan started (user picked a different folder, or it's the very first
        // scan). Reset the tree to a fresh root before applying.
        // Without this guard the renderer silently drops patches from new
        // scans and the UI looks frozen on the previous folder.
        const currentRoot = draft.tree?.path
        const isInsideCurrent =
          !!currentRoot &&
          (patch.path === currentRoot || patch.path.startsWith(currentRoot + '/'))
        if (!draft.tree || !isInsideCurrent) {
          // The first patch from a fresh scan is always for the root itself.
          // If it's something deeper (unlikely but possible if events arrive
          // out of order across IPC), synthesize the deepest common prefix
          // we can — for now: use the root of the patch path as the new tree.
          const newRoot = inferRoot(patch.path)
          draft.tree = blankNode(newRoot)
          draft.focusPath = newRoot
          draft.selectedPath = null
        }
        const target = locate(draft.tree!, patch.path)
        if (!target) return

        // Replace own facts.
        target.size = patch.node.size
        target.ownSize = patch.node.ownSize
        target.status = patch.node.status
        target.files = patch.node.files
        target.breakdown = patch.node.breakdown
        target.error = patch.node.error
        target.crossDevice = patch.node.crossDevice
        target.trashingFiles = patch.node.trashingFiles

        // Merge children stubs: for any new child not already in target,
        // create it; for existing ones, update size/status only (don't
        // clobber their own subtree which they manage via their own patches).
        for (const [name, stub] of Object.entries(patch.node.children)) {
          const existing = target.children[name]
          if (!existing) {
            target.children[name] = {
              ...stub,
              children: {},
              files: stub.files ?? []
            }
          } else {
            existing.size = stub.size
            existing.ownSize = stub.ownSize
            existing.status = stub.status
            existing.breakdown = stub.breakdown
            existing.crossDevice = stub.crossDevice
            existing.error = stub.error
          }
        }
      })
    ),

  nodeAt: (p) => {
    const t = get().tree
    if (!t) return null
    return locate(t, p)
  }
}))

function locate(root: DirNode, target: string): DirNode | null {
  if (root.path === target) return root
  if (!target.startsWith(root.path)) return null
  // Walk down by path segments — but child keys are basenames. Use sep '/'.
  const tail = target.slice(root.path.length).replace(/^\/+/, '')
  if (!tail) return root
  const parts = tail.split('/')
  let cur: DirNode = root
  for (const part of parts) {
    const next = cur.children[part]
    if (!next) return null
    cur = next
  }
  return cur
}

/** When the renderer is freshly mounted and a patch arrives for a path it
 *  doesn't know about, we have to invent a root. For the first patch of any
 *  scan this is always the root path itself (controller sends it that way),
 *  so identity is the right answer. Kept as a helper for the rare case of
 *  out-of-order delivery — falls back to the patch path. */
function inferRoot(patchPath: string): string {
  return patchPath
}
