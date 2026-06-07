import * as fs from 'node:fs'
import * as path from 'node:path'
import { type Settings, DEFAULT_SETTINGS } from '../../shared/types'

/**
 * Tiny JSON-backed settings store. Synchronous on read (called once at
 * startup), debounced on write (settings changes can fire rapidly while a
 * user drags a slider).
 *
 * Why not electron-store? One dependency, one file, zero migration story.
 * We have ~5 fields total; the moment we grow schemas worth migrating
 * we'll switch to it.
 */
export class SettingsStore {
  private current: Settings
  private writeTimer: NodeJS.Timeout | null = null

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.current = this.load()
  }

  get(): Settings {
    return { ...this.current }
  }

  /** Merge `patch` into current settings, persist, and return the merged
   *  result. Returns the new value synchronously even though the disk write
   *  is debounced — the in-memory state is the source of truth. */
  set(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch }
    this.scheduleWrite()
    return { ...this.current }
  }

  private load(): Settings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Settings>
      // Merge with defaults so adding a new field in a future version
      // doesn't break older saved files.
      return { ...DEFAULT_SETTINGS, ...parsed }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // Corrupt settings file: log and fall back to defaults rather than
        // refusing to launch.
        console.warn('[settings] failed to read, using defaults:', e)
      }
      return { ...DEFAULT_SETTINGS }
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    // 250ms debounce — long enough to absorb slider drag, short enough that
    // a quit-then-launch cycle doesn't lose the latest value.
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      try {
        fs.writeFileSync(
          this.filePath,
          JSON.stringify(this.current, null, 2),
          'utf8'
        )
      } catch (e) {
        console.error('[settings] write failed:', e)
      }
    }, 250)
  }

  /** Flush any pending write — call on app quit. */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      try {
        fs.writeFileSync(
          this.filePath,
          JSON.stringify(this.current, null, 2),
          'utf8'
        )
      } catch (e) {
        console.error('[settings] flush failed:', e)
      }
    }
  }
}
