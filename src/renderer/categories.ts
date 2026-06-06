import type { FileCategory } from '@shared/types'

/** Mirrors src/main/scanner/fileTypes.ts. Kept in sync manually — renderer
 *  needs colors without importing main-process code. */
export const CATEGORY_ORDER: FileCategory[] = [
  'video', 'image', 'audio', 'archive', 'code',
  'document', 'cache', 'binary', 'app', 'other'
]

export const CATEGORY_COLOR: Record<FileCategory, string> = {
  video: '#ef4444',
  image: '#f59e0b',
  audio: '#a855f7',
  archive: '#84cc16',
  code: '#22d3ee',
  document: '#3b82f6',
  cache: '#94a3b8',
  binary: '#64748b',
  app: '#10b981',
  other: '#cbd5e1'
}

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  archive: 'Archive',
  code: 'Code',
  document: 'Document',
  cache: 'Cache',
  binary: 'Binary',
  app: 'App',
  other: 'Other'
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(2) : v < 100 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** Pick the dominant category in a breakdown for treemap coloring. */
export function dominantCategory(
  breakdown: Record<FileCategory, number>
): FileCategory {
  let best: FileCategory = 'other'
  let bestN = -1
  for (const c of CATEGORY_ORDER) {
    if (breakdown[c] > bestN) {
      bestN = breakdown[c]
      best = c
    }
  }
  return best
}

/** True if a directory's status means the user can no longer interact with
 *  it (it's mid-delete or already a tombstone). */
export function isDirInert(status: string): boolean {
  return status === 'trashing' || status === 'trashed'
}

/** True if a leaf file in `parentNode` is currently being trashed. */
export function isFileTrashing(
  trashingFiles: string[] | Set<string> | undefined,
  fileName: string
): boolean {
  if (!trashingFiles) return false
  if (Array.isArray(trashingFiles)) return trashingFiles.includes(fileName)
  return trashingFiles.has(fileName)
}
