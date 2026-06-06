import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { EventEmitter } from 'node:events'
import type {
  DirNode,
  TreePatch,
  ScanLifecycle,
  FileCategory
} from '../../shared/types'
import { PriorityQueue } from './queue'
import { scanDirectory, makeNode, breakdownDelta } from './tree'
import { CATEGORY_ORDER, emptyBreakdown } from './fileTypes'

interface DirTask {
  path: string
  depth: number
}

/**
 * Owns the in-memory tree and a worker loop that drains a priority queue of
 * pending directories. Emits `patch` and `lifecycle` events.
 *
 * Design notes:
 *  - I/O bound work (readdir + lstat) runs on libuv's threadpool. We just
 *    keep N concurrent promises in flight; no need for worker_threads.
 *  - `UV_THREADPOOL_SIZE` is bumped at app startup (see main/index.ts).
 *  - Pause = the loop awaits a "resumed" promise before pulling the next task.
 *    In-flight scans complete naturally.
 *  - Focus boost = re-prioritize all pending tasks under a path to a very
 *    negative priority so they pop first.
 */
export class ScannerController extends EventEmitter {
  private tree: DirNode | null = null
  private root: string | null = null
  private rootDev = 0

  /** path -> node for O(1) lookup. Includes every directory we know about. */
  private index = new Map<string, DirNode>()

  private queue = new PriorityQueue<DirTask>()
  private inFlight = 0
  private readonly concurrency: number

  private paused = false
  private pauseGate: Promise<void> = Promise.resolve()
  private releasePause: () => void = () => {}

  /** Monotonic; lower = scans first. We use depth as the base priority and
   *  subtract a big constant for focused subtrees. */
  private static readonly FOCUS_BOOST = -1_000_000

  /** Prefixes (with trailing sep) the user has focused. New tasks pushed
   *  under any of these get the same priority boost as existing ones, so
   *  descendants discovered after the click also scan first. */
  private focusedPrefixes = new Set<string>()

  /** Roots currently being trashed (status='trashing' on the node itself).
   *  Used by the scan loop to skip queued descendants without rebuilding
   *  the priority heap, and by IPC serialization to mark cell stubs inert
   *  in the renderer. Cleared on markTrashed/unmarkTrashing. */
  private trashingRoots = new Set<string>()
  /** Roots that finished trashing (tombstones). Same lookup story as
   *  trashingRoots but never cleared — these stay for the session so the
   *  UI keeps showing the strike-through. */
  private trashedRoots = new Set<string>()

  private startedAt = 0
  private cancelToken = 0

  constructor(concurrency = Math.max(4, os.cpus().length)) {
    super()
    this.concurrency = concurrency
  }

  getTree(): DirNode | null {
    return this.tree
  }

  async start(rootPath: string): Promise<void> {
    // Cancel any prior scan first.
    this.cancelToken++
    this.queue.clear()
    this.index.clear()
    this.focusedPrefixes.clear()
    this.trashingRoots.clear()
    this.trashedRoots.clear()
    this.paused = false
    this.releasePause()
    this.pauseGate = Promise.resolve()

    const root = path.resolve(rootPath)
    let stat: import('node:fs').Stats
    try {
      stat = await fs.lstat(root)
    } catch (e) {
      this.emitLifecycle({
        kind: 'error',
        root,
        message: (e as Error).message
      })
      return
    }
    if (!stat.isDirectory()) {
      this.emitLifecycle({ kind: 'error', root, message: 'Not a directory' })
      return
    }

    this.root = root
    this.rootDev = stat.dev
    this.tree = makeNode(root)
    this.index.set(root, this.tree)
    this.startedAt = Date.now()

    this.queue.push({ path: root, depth: 0 }, 0)
    this.emitLifecycleSnapshot()
    this.spinUp()
  }

  pause(): void {
    if (this.paused || !this.root) return
    this.paused = true
    this.pauseGate = new Promise<void>((resolve) => {
      this.releasePause = resolve
    })
    this.emitLifecycleSnapshot()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.releasePause()
    this.emitLifecycleSnapshot()
    this.spinUp()
  }

  /**
   * The user clicked into `targetPath`. Re-prioritize every pending task that
   * lives under it so it scans next. Existing in-flight tasks are not
   * interrupted.
   */
  focus(targetPath: string): void {
    const t = path.resolve(targetPath)
    const prefix = t.endsWith(path.sep) ? t : t + path.sep
    this.focusedPrefixes.add(prefix)
    const moved = this.queue.reprioritize((task, current) => {
      if (this.isFocused(task.path)) {
        return ScannerController.FOCUS_BOOST + task.depth
      }
      return current
    })
    if (moved > 0 && !this.paused) this.spinUp()
  }

  private isFocused(p: string): boolean {
    for (const pre of this.focusedPrefixes) {
      // pre always ends with sep; allow exact match too.
      if (p === pre.slice(0, -1) || p.startsWith(pre)) return true
    }
    return false
  }

  private priorityFor(taskPath: string, depth: number): number {
    return this.isFocused(taskPath)
      ? ScannerController.FOCUS_BOOST + depth
      : depth
  }

  /** Remove a path from the tree (after trash). Bubble size deltas up. */
  prune(targetPath: string): boolean {
    const t = path.resolve(targetPath)
    const node = this.index.get(t)
    const parentPath = path.dirname(t)
    const parent = this.index.get(parentPath)

    if (node) {
      // Removed a directory we tracked: full subtree size.
      if (!parent) return false
      delete parent.children[path.basename(t)]
      this.removeFromIndex(node)
      this.bubbleUp(parent, -node.size, this.negate(node.breakdown))
      this.emitPatch(parentPath, parent)
      return true
    }

    // Maybe a file inside a known parent.
    if (parent) {
      const i = parent.files.findIndex(
        (f) => path.join(parentPath, f.name) === t
      )
      if (i >= 0) {
        const f = parent.files[i]
        parent.files.splice(i, 1)
        parent.ownSize -= f.size
        const delta: Partial<Record<FileCategory, number>> = { [f.category]: -f.size }
        this.bubbleUp(parent, -f.size, delta)
        this.emitPatch(parentPath, parent)
        return true
      }
    }
    return false
  }

  /**
   * Optimistically mark a path as 'trashing' so the renderer can grey it out
   * immediately. **Does NOT recurse into the subtree** — that used to take
   * hundreds of ms for a large folder and stalled all IPC during deletion.
   * Instead the renderer treats anything *under* a trashing/trashed node
   * as inert via an ancestor lookup; see store.trashingTops / trashedTops.
   *
   * Pending scan tasks beneath the doomed subtree are dropped lazily: the
   * scan loop checks `isUnderTrashedRoot(task.path)` before running each
   * task, so tasks effectively become no-ops without a O(n) heap rebuild.
   */
  markTrashing(targetPath: string): 'dir' | 'file' | 'unknown' {
    const t = path.resolve(targetPath)
    const node = this.index.get(t)
    if (node) {
      node.status = 'trashing'
      this.trashingRoots.add(t)
      this.emitPatch(node.path, node)
      const parent = this.parentOf(node)
      if (parent) this.emitPatch(parent.path, parent)
      return 'dir'
    }
    // Maybe a leaf file inside a known parent.
    const parentPath = path.dirname(t)
    const parent = this.index.get(parentPath)
    if (parent) {
      const name = path.basename(t)
      const f = parent.files.find((x) => x.name === name)
      if (f) {
        if (!parent.trashingFiles) parent.trashingFiles = new Set()
        ;(parent.trashingFiles as Set<string>).add(name)
        this.emitPatch(parent.path, parent)
        return 'file'
      }
    }
    return 'unknown'
  }

  /**
   * After a successful trash:
   *  - Directory: status becomes 'trashed' (tombstone, size kept). Subtree
   *    status doesn't need to change — renderer treats descendants as inert
   *    via ancestor lookup.
   *  - File: actually remove it from the parent and bubble size deltas;
   *    we don't keep per-file tombstones (would clutter the treemap).
   */
  markTrashed(targetPath: string): void {
    const t = path.resolve(targetPath)
    const node = this.index.get(t)
    if (node) {
      node.status = 'trashed'
      this.trashingRoots.delete(t)
      this.trashedRoots.add(t)
      this.emitPatch(node.path, node)
      const parent = this.parentOf(node)
      if (parent) this.emitPatch(parent.path, parent)
      return
    }
    const parentPath = path.dirname(t)
    const parent = this.index.get(parentPath)
    if (parent) {
      const name = path.basename(t)
      const i = parent.files.findIndex((x) => x.name === name)
      if (i >= 0) {
        const f = parent.files[i]
        parent.files.splice(i, 1)
        parent.ownSize -= f.size
        const delta: Partial<Record<FileCategory, number>> = { [f.category]: -f.size }
        ;(parent.trashingFiles as Set<string> | undefined)?.delete(name)
        this.bubbleUp(parent, -f.size, delta)
        this.emitPatch(parent.path, parent)
      }
    }
  }

  /** Revert an optimistic 'trashing' state on failure. */
  unmarkTrashing(targetPath: string): void {
    const t = path.resolve(targetPath)
    const node = this.index.get(t)
    if (node) {
      node.status = 'done'
      this.trashingRoots.delete(t)
      this.emitPatch(node.path, node)
      const parent = this.parentOf(node)
      if (parent) this.emitPatch(parent.path, parent)
      return
    }
    const parentPath = path.dirname(t)
    const parent = this.index.get(parentPath)
    if (parent && parent.trashingFiles) {
      ;(parent.trashingFiles as Set<string>).delete(path.basename(t))
      this.emitPatch(parent.path, parent)
    }
  }

  /** True if `p` is at or below any trashing/trashed root — used by the
   *  scan loop to skip doomed work without rebuilding the heap. */
  private isUnderTrashRoot(p: string): boolean {
    for (const r of this.trashingRoots) {
      if (p === r || p.startsWith(r + path.sep)) return true
    }
    for (const r of this.trashedRoots) {
      if (p === r || p.startsWith(r + path.sep)) return true
    }
    return false
  }

  // ────────────────────────── internals ──────────────────────────

  private removeFromIndex(node: DirNode): void {
    this.index.delete(node.path)
    for (const child of Object.values(node.children)) this.removeFromIndex(child)
    // Also remove its pending tasks from the queue.
    const prefix = node.path.endsWith(path.sep) ? node.path : node.path + path.sep
    this.queue.drop(
      (t) => t.path === node.path || t.path.startsWith(prefix)
    )
  }

  private negate(b: Record<FileCategory, number>): Partial<Record<FileCategory, number>> {
    const out: Partial<Record<FileCategory, number>> = {}
    for (const c of CATEGORY_ORDER) if (b[c]) out[c] = -b[c]
    return out
  }

  private spinUp(): void {
    while (this.inFlight < this.concurrency && this.queue.size > 0 && !this.paused) {
      const task = this.queue.pop()
      if (!task) break
      this.inFlight++
      this.runTask(task).finally(() => {
        this.inFlight--
        if (this.queue.size > 0 && !this.paused) {
          this.spinUp()
        } else if (this.inFlight === 0 && this.queue.size === 0 && this.root) {
          this.emitLifecycle({
            kind: 'done',
            root: this.root,
            totalBytes: this.tree?.size ?? 0,
            durationMs: Date.now() - this.startedAt
          })
        }
      })
    }
    // Periodic lifecycle nudge so the UI sees queue size shrink.
    this.emitLifecycleSnapshot()
  }

  private async runTask(task: DirTask): Promise<void> {
    if (this.paused) await this.pauseGate
    const generation = this.cancelToken
    const node = this.index.get(task.path)
    if (!node) return // pruned
    // Doomed subtree: don't bother scanning. Cheap O(K) ancestor check
    // (K = number of trashed roots), much cheaper than rebuilding the
    // priority heap on every trash action.
    if (this.isUnderTrashRoot(task.path)) return

    node.status = 'scanning'
    const result = await scanDirectory(task.path, this.rootDev)
    if (this.cancelToken !== generation) return // scan was reset

    if (result.status !== 'done') {
      node.status = result.status
      node.error = result.error
      this.emitPatch(node.path, node)
      return
    }

    // Absorb file results.
    node.files = result.files
    node.ownSize = result.ownSize
    const prevBreakdown = { ...node.breakdown }
    for (const c of CATEGORY_ORDER) node.breakdown[c] += result.breakdown[c]
    const ownDelta = result.ownSize
    node.size += ownDelta
    node.status = 'done'

    // Add subdir nodes (pending), enqueue them.
    for (const child of result.subdirs) {
      const childNode = makeNode(child)
      node.children[path.basename(child)] = childNode
      this.index.set(child, childNode)
      const childDepth = task.depth + 1
      this.queue.push(
        { path: child, depth: childDepth },
        this.priorityFor(child, childDepth)
      )
    }
    for (const cd of result.crossDevice) {
      const childNode = makeNode(cd)
      childNode.status = 'done'
      childNode.crossDevice = true
      node.children[path.basename(cd)] = childNode
      this.index.set(cd, childNode)
    }

    // Bubble own-size delta + breakdown delta up to ancestors.
    const breakdownAdd = breakdownDelta(prevBreakdown, node.breakdown)
    this.bubbleUp(this.parentOf(node), ownDelta, breakdownAdd)
    this.emitPatch(node.path, node)
  }

  private parentOf(node: DirNode): DirNode | null {
    if (!this.root || node.path === this.root) return null
    return this.index.get(path.dirname(node.path)) ?? null
  }

  private bubbleUp(
    start: DirNode | null,
    sizeDelta: number,
    breakdownAdd: Partial<Record<FileCategory, number>>
  ): void {
    let cur = start
    while (cur) {
      cur.size += sizeDelta
      for (const c of CATEGORY_ORDER) {
        const d = breakdownAdd[c] ?? 0
        if (d !== 0) cur.breakdown[c] += d
      }
      // Emit a small patch for ancestors so the renderer sees them grow.
      this.emitAncestorPatch(cur, sizeDelta, breakdownAdd)
      cur = this.parentOf(cur)
    }
  }

  // ────────────────────────── events ──────────────────────────

  private patchTimer: NodeJS.Timeout | null = null
  private pendingPatches = new Map<string, TreePatch>()

  private emitPatch(p: string, node: DirNode): void {
    // Coalesce: keep latest patch per path; flush on a small timer.
    this.pendingPatches.set(p, { path: p, node: this.serializeNode(node) })
    this.scheduleFlush()
  }

  private emitAncestorPatch(
    node: DirNode,
    delta: number,
    breakdownAdd: Partial<Record<FileCategory, number>>
  ): void {
    const existing = this.pendingPatches.get(node.path)
    if (existing) {
      existing.node = this.serializeNode(node)
      return
    }
    this.pendingPatches.set(node.path, {
      path: node.path,
      node: this.serializeNode(node),
      ancestorDelta: delta,
      ancestorBreakdownDelta: breakdownAdd
    })
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.patchTimer) return
    this.patchTimer = setTimeout(() => {
      this.patchTimer = null
      const batch = Array.from(this.pendingPatches.values())
      this.pendingPatches.clear()
      for (const p of batch) this.emit('patch', p)
      this.emitLifecycleSnapshot()
    }, 80)
  }

  /** Strip nested children so each patch is bounded — children are sent as
   *  shallow stubs (size + status only). The renderer tracks them separately
   *  via their own patches. Sets are converted to arrays for IPC.
   *
   *  If this node lives under a trashing/trashed root, its child stubs are
   *  reported with the inherited status so the renderer doesn't have to
   *  walk ancestors itself. */
  private serializeNode(node: DirNode): DirNode {
    const inherited: 'trashing' | 'trashed' | null =
      node.status === 'trashed'
        ? 'trashed'
        : node.status === 'trashing'
          ? 'trashing'
          : this.inheritedTrashStatus(node.path)
    const childStubs: Record<string, DirNode> = {}
    for (const [k, c] of Object.entries(node.children)) {
      childStubs[k] = {
        path: c.path,
        size: c.size,
        ownSize: c.ownSize,
        children: {},
        files: [],
        // Descendants of a trashing/trashed root inherit the visual state.
        status: inherited && c.status !== 'trashed' ? inherited : c.status,
        breakdown: { ...c.breakdown },
        crossDevice: c.crossDevice,
        error: c.error
      }
    }
    return {
      path: node.path,
      size: node.size,
      ownSize: node.ownSize,
      children: childStubs,
      files: node.files,
      status: node.status,
      breakdown: { ...node.breakdown },
      crossDevice: node.crossDevice,
      error: node.error,
      trashingFiles: node.trashingFiles
        ? Array.from(node.trashingFiles as Set<string>)
        : undefined
    }
  }

  private inheritedTrashStatus(p: string): 'trashing' | 'trashed' | null {
    for (const r of this.trashedRoots) {
      if (p === r || p.startsWith(r + path.sep)) return 'trashed'
    }
    for (const r of this.trashingRoots) {
      if (p === r || p.startsWith(r + path.sep)) return 'trashing'
    }
    return null
  }

  private emitLifecycle(s: ScanLifecycle): void {
    this.emit('lifecycle', s)
  }

  private emitLifecycleSnapshot(): void {
    if (!this.root) {
      this.emitLifecycle({ kind: 'idle' })
      return
    }
    if (this.paused) {
      this.emitLifecycle({
        kind: 'paused',
        root: this.root,
        queued: this.queue.size
      })
      return
    }
    if (this.queue.size === 0 && this.inFlight === 0) {
      this.emitLifecycle({
        kind: 'done',
        root: this.root,
        totalBytes: this.tree?.size ?? 0,
        durationMs: Date.now() - this.startedAt
      })
      return
    }
    this.emitLifecycle({
      kind: 'scanning',
      root: this.root,
      queued: this.queue.size,
      inFlight: this.inFlight
    })
  }
}

// Helper used by emptyBreakdown reference above (kept for tree.ts symmetry).
export { emptyBreakdown }
