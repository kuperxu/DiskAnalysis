import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { DirNode, FileEntry, FileCategory } from '../../shared/types'
import { CATEGORY_ORDER, emptyBreakdown } from '../scanner/fileTypes'

/**
 * Persistent cache of scanned subtrees, keyed by directory path.
 *
 * Schema is denormalized for speed: each `nodes` row holds aggregate size +
 * breakdown for that directory; `files` rows hold leaf files per directory.
 * Children are reconstructed by `parent` lookup, not stored as JSON, so partial
 * reads (load a single subtree) are cheap.
 *
 * Cache is write-through: when a directory finishes scanning we persist it
 * along with its mtime. On the next start we walk top-down from the root: if
 * the dir's current mtime matches the cached mtime, we hydrate from cache;
 * otherwise we rescan that level. (Revalidation logic lives in the controller
 * once we wire this in; this module just exposes get/put primitives.)
 */
export class CacheStore {
  private db: Database.Database
  private putNodeStmt: Database.Statement
  private putFileStmt: Database.Statement
  private clearFilesStmt: Database.Statement
  private clearChildrenFilesStmt: Database.Statement
  private clearChildrenNodesStmt: Database.Statement
  private getNodeStmt: Database.Statement
  private listFilesStmt: Database.Statement
  private listChildrenStmt: Database.Statement

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        path TEXT PRIMARY KEY,
        parent TEXT,
        size INTEGER NOT NULL,
        own_size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        scanned_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        breakdown TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS nodes_parent_idx ON nodes(parent);

      CREATE TABLE IF NOT EXISTS files (
        parent TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        category TEXT NOT NULL,
        PRIMARY KEY (parent, name)
      );
    `)

    this.putNodeStmt = this.db.prepare(`
      INSERT INTO nodes (path, parent, size, own_size, mtime_ms, scanned_at, status, breakdown)
      VALUES (@path, @parent, @size, @own_size, @mtime_ms, @scanned_at, @status, @breakdown)
      ON CONFLICT(path) DO UPDATE SET
        parent = excluded.parent,
        size = excluded.size,
        own_size = excluded.own_size,
        mtime_ms = excluded.mtime_ms,
        scanned_at = excluded.scanned_at,
        status = excluded.status,
        breakdown = excluded.breakdown
    `)
    this.putFileStmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (parent, name, size, category) VALUES (?, ?, ?, ?)
    `)
    this.clearFilesStmt = this.db.prepare('DELETE FROM files WHERE parent = ?')
    this.clearChildrenFilesStmt = this.db.prepare(
      "DELETE FROM files WHERE parent = ? OR parent LIKE ? ESCAPE '\\'"
    )
    this.clearChildrenNodesStmt = this.db.prepare(
      "DELETE FROM nodes WHERE path = ? OR path LIKE ? ESCAPE '\\'"
    )
    this.getNodeStmt = this.db.prepare('SELECT * FROM nodes WHERE path = ?')
    this.listFilesStmt = this.db.prepare(
      'SELECT name, size, category FROM files WHERE parent = ?'
    )
    this.listChildrenStmt = this.db.prepare(
      'SELECT path FROM nodes WHERE parent = ?'
    )
  }

  /** Persist a single scanned directory (its files, size, mtime). */
  putNode(node: DirNode, mtimeMs: number, parent: string | null): void {
    const tx = this.db.transaction(() => {
      this.putNodeStmt.run({
        path: node.path,
        parent,
        size: node.size,
        own_size: node.ownSize,
        mtime_ms: Math.floor(mtimeMs),
        scanned_at: Date.now(),
        status: node.status,
        breakdown: JSON.stringify(node.breakdown)
      })
      this.clearFilesStmt.run(node.path)
      for (const f of node.files) {
        this.putFileStmt.run(node.path, f.name, f.size, f.category)
      }
    })
    tx()
  }

  /** Drop a path and everything beneath it (after trash, or stale entry). */
  invalidate(p: string): void {
    const like = escapeLike(p) + '/%'
    const tx = this.db.transaction(() => {
      this.clearChildrenFilesStmt.run(p, like)
      this.clearChildrenNodesStmt.run(p, like)
    })
    tx()
  }

  /** Return the cached node if present, else null. Children/files populated. */
  loadShallow(p: string): {
    size: number
    ownSize: number
    mtimeMs: number
    status: string
    breakdown: Record<FileCategory, number>
    files: FileEntry[]
    childPaths: string[]
  } | null {
    const row = this.getNodeStmt.get(p) as
      | {
          size: number
          own_size: number
          mtime_ms: number
          status: string
          breakdown: string
        }
      | undefined
    if (!row) return null
    const files = (this.listFilesStmt.all(p) as Array<{ name: string; size: number; category: FileCategory }>).map(
      (r) => ({ name: r.name, size: r.size, category: r.category })
    )
    const childPaths = (this.listChildrenStmt.all(p) as Array<{ path: string }>).map(
      (r) => r.path
    )
    let breakdown: Record<FileCategory, number>
    try {
      breakdown = { ...emptyBreakdown(), ...JSON.parse(row.breakdown) }
    } catch {
      breakdown = emptyBreakdown()
    }
    return {
      size: row.size,
      ownSize: row.own_size,
      mtimeMs: row.mtime_ms,
      status: row.status,
      breakdown,
      files,
      childPaths
    }
  }

  close(): void {
    this.db.close()
  }
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// Suppress unused-import warning for CATEGORY_ORDER if linter runs.
void CATEGORY_ORDER
