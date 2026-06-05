import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { DirNode, FileEntry, FileCategory } from '../../shared/types'
import { categorize, emptyBreakdown, CATEGORY_ORDER } from './fileTypes'

export function makeNode(p: string): DirNode {
  return {
    path: p,
    size: 0,
    ownSize: 0,
    children: {},
    files: [],
    status: 'pending',
    breakdown: emptyBreakdown()
  }
}

/** Result returned by scanDirectory — the readdir layer only fills in the
 *  immediate facts. The controller adds the node to the tree and queues
 *  children. */
export interface ScanResult {
  path: string
  ownSize: number
  files: FileEntry[]
  /** Names of subdirectories found here (full child paths). */
  subdirs: string[]
  breakdown: Record<FileCategory, number>
  /** Subdirs that crossed mount points; recorded as nodes but not descended. */
  crossDevice: string[]
  status: 'done' | 'denied' | 'error'
  error?: string
}

const DEFAULT_EXCLUDES = new Set([
  '/System',
  '/private/var/vm',
  '/private/var/db',
  '/.Spotlight-V100',
  '/.fseventsd',
  '/.DocumentRevisions-V100',
  '/Volumes'
])

export function isExcluded(p: string): boolean {
  if (DEFAULT_EXCLUDES.has(p)) return true
  // /Volumes/* but allow /Volumes itself (root could be on an ext drive picked
  // explicitly — see scanDirectory rootDev guard).
  return false
}

/** Single-directory scan: readdir + lstat each entry. Pure I/O, no recursion.
 *  Caller decides what to do with the discovered subdirs. */
export async function scanDirectory(
  dirPath: string,
  rootDev: number
): Promise<ScanResult> {
  const breakdown = emptyBreakdown()
  const files: FileEntry[] = []
  const subdirs: string[] = []
  const crossDevice: string[] = []
  let ownSize = 0

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { path: dirPath, ownSize: 0, files, subdirs, breakdown, crossDevice, status: 'denied', error: err.code }
    }
    return { path: dirPath, ownSize: 0, files, subdirs, breakdown, crossDevice, status: 'error', error: err.code ?? err.message }
  }

  for (const ent of entries) {
    const full = path.join(dirPath, ent.name)
    if (isExcluded(full)) continue

    let stat: import('node:fs').Stats
    try {
      stat = await fs.lstat(full)
    } catch {
      continue // file vanished between readdir and lstat; skip
    }

    if (stat.isSymbolicLink()) {
      // Treat symlinks as ~0 bytes (the inode itself) and never follow.
      continue
    }

    // App bundles are directories on macOS but we want to treat them as
    // single "things" — descend so we get an accurate size, but tagged.
    if (stat.isDirectory()) {
      if (stat.dev !== rootDev) {
        crossDevice.push(full)
        continue
      }
      subdirs.push(full)
      continue
    }

    if (stat.isFile()) {
      const cat = categorize(ent.name, dirPath)
      // st_blocks * 512 would give actual allocated bytes; st_size is the
      // logical size users expect to see. Use logical size to match Finder.
      const size = stat.size
      ownSize += size
      breakdown[cat] += size
      files.push({ name: ent.name, size, category: cat })
    }
    // Other types (sockets, fifos, char/block devices) are ignored.
  }

  return { path: dirPath, ownSize, files, subdirs, breakdown, crossDevice, status: 'done' }
}

/** Convert a breakdown delta into a plain object for IPC. */
export function breakdownDelta(
  prev: Record<FileCategory, number>,
  next: Record<FileCategory, number>
): Partial<Record<FileCategory, number>> {
  const out: Partial<Record<FileCategory, number>> = {}
  for (const c of CATEGORY_ORDER) {
    const d = next[c] - prev[c]
    if (d !== 0) out[c] = d
  }
  return out
}
