import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  IPC,
  type DirNode,
  type ScanLifecycle,
  type TreePatch,
  type Notice
} from '../shared/types'
import { ScannerController } from './scanner/controller'
import { CacheStore } from './cache/store'

// Bump the libuv threadpool so concurrent fs.lstat / readdir calls don't
// queue against each other. Must be set BEFORE any I/O kicks off, ie. here
// at the top of the entry module.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE ?? '32'

// Disable Electron's transparent asar interception. By default any fs.* call
// on a path containing ".asar" gets routed through Electron's archive parser
// — fine for an Electron app loading its own app.asar, useless and noisy for
// a disk scanner that just wants lstat on whatever's on disk. Without this,
// any .asar file the user owns (VSCode/Slack/Discord all ship asars under
// Contents/Resources/, and there are many test-fixture asars in source
// trees) logs an "archive.cc Failed to parse header" warning and does an
// extra read every time we touch it. Treat .asar as ordinary files.
process.noAsar = true

let mainWindow: BrowserWindow | null = null
let scanner: ScannerController | null = null
let cache: CacheStore | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function notify(n: Omit<Notice, 'id'> & { id?: string }): void {
  mainWindow?.webContents.send(IPC.notice, { id: n.id ?? randomUUID(), ...n })
}

/** Convert a Node/Electron error from a trash op into a user-facing Notice.
 *  Permission errors are tagged so the renderer can surface a Full Disk
 *  Access hint instead of the cryptic errno. */
function classifyTrashError(p: string, e: unknown): Notice {
  const err = e as NodeJS.ErrnoException
  const code = err?.code ?? ''
  const msg = err?.message ?? String(e)

  // shell.trashItem swallows the underlying errno into the message string on
  // some macOS versions, so we fingerprint both the code and the text.
  const looksPermission =
    code === 'EACCES' ||
    code === 'EPERM' ||
    /not permitted|permission|operation not permitted/i.test(msg)

  if (looksPermission) {
    return {
      kind: 'permission',
      title: "Couldn't move to Trash — permission denied",
      body:
        'macOS protects this location. To delete here, grant the app ' +
        'Full Disk Access in System Settings → Privacy & Security → ' +
        'Full Disk Access, then try again.',
      path: p
    }
  }
  if (code === 'EROFS') {
    return {
      kind: 'error',
      title: "Couldn't move to Trash — read-only volume",
      body: 'This volume is mounted read-only.',
      path: p
    }
  }
  if (code === 'ENOENT') {
    return {
      kind: 'info',
      title: 'Already gone',
      body: 'The file no longer exists at this path.',
      path: p
    }
  }
  return {
    kind: 'error',
    title: "Couldn't move to Trash",
    body: msg,
    path: p
  }
}

function setupScanner(): void {
  scanner = new ScannerController()

  scanner.on('patch', (patch: TreePatch) => {
    mainWindow?.webContents.send(IPC.patch, patch)
    // Persist this patch's node to cache (only if scan complete on it).
    if (cache && (patch.node.status === 'done' || patch.node.status === 'denied')) {
      // Best-effort: stat for mtime; ignore if it disappeared.
      fs.promises
        .lstat(patch.path)
        .then((st) =>
          cache!.putNode(patch.node, st.mtimeMs, path.dirname(patch.path) || null)
        )
        .catch(() => {})
    }
  })

  scanner.on('lifecycle', (s: ScanLifecycle) => {
    mainWindow?.webContents.send(IPC.lifecycle, s)
  })
}

function setupIpc(): void {
  ipcMain.handle(IPC.pickRoot, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a folder to scan',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('home')
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.start, async (_e, root: string) => {
    if (!scanner) return
    await scanner.start(root)
  })

  ipcMain.handle(IPC.pause, () => scanner?.pause())
  ipcMain.handle(IPC.resume, () => scanner?.resume())
  ipcMain.handle(IPC.focus, (_e, p: string) => scanner?.focus(p))
  ipcMain.handle(IPC.getTree, (): DirNode | null => scanner?.getTree() ?? null)

  ipcMain.handle(IPC.reveal, (_e, p: string) => {
    // showItemInFolder opens Finder and highlights the item; if the path no
    // longer exists, fall back to opening its parent directory.
    if (fs.existsSync(p)) {
      shell.showItemInFolder(p)
    } else {
      const parent = path.dirname(p)
      if (fs.existsSync(parent)) shell.openPath(parent)
    }
  })

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // shell.openExternal handles https://, mailto:, and macOS-specific
    // schemes like x-apple.systempreferences: that deep-link into System
    // Settings panes.
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.trash, async (_e, p: string) => {
    // Refuse fast cases synchronously — the renderer awaits this just for the
    // refusal feedback, otherwise it returns ok almost instantly and the
    // actual `shell.trashItem` runs in the background.
    if (!fs.existsSync(p)) {
      notify({ kind: 'info', title: 'Already gone', path: p })
      return { ok: false, error: 'Not found' }
    }
    const root = scanner?.getTree()?.path
    if (root && path.resolve(p) === path.resolve(root)) {
      notify({
        kind: 'error',
        title: "Can't trash the scan root",
        body: 'Pick a child folder or file instead.',
        path: p
      })
      return { ok: false, error: 'Refusing to trash the scan root' }
    }

    // Pre-flight permission check: write access on the *parent* is what
    // governs unlink/rename to ~/.Trash. Failing here lets us show the Full
    // Disk Access hint instantly, instead of waiting for shell.trashItem to
    // fail (which on macOS can take a few hundred ms).
    try {
      fs.accessSync(path.dirname(p), fs.constants.W_OK)
    } catch (e) {
      notify(classifyTrashError(p, e))
      return { ok: false, error: (e as Error).message }
    }

    // Optimistic UI: mark immediately so the renderer can grey out the cell.
    // This is now O(1) on the target node — descendants are handled lazily
    // by the renderer via ancestor lookup, so even a huge subtree marks
    // instantly without blocking the main process. (See controller.ts.)
    scanner?.markTrashing(p)

    // Don't await — return ok now; if shell.trashItem fails later, we revert
    // the mark and broadcast a fresh patch. This is what stops the UI from
    // hanging during a slow trash operation (e.g. a large folder on a slow
    // disk, or a path that triggers a system permission prompt).
    void (async (): Promise<void> => {
      try {
        await shell.trashItem(p)
        scanner?.markTrashed(p)
        // setImmediate yields to the event loop one tick later than
        // queueMicrotask, which keeps tree patches reaching the renderer
        // ahead of cache writes when many trashes pile up.
        setImmediate(() => cache?.invalidate(p))
      } catch (e) {
        scanner?.unmarkTrashing(p)
        notify(classifyTrashError(p, e))
        console.error('[trash] failed', p, e)
      }
    })()

    return { ok: true } as const
  })
}

app.whenReady().then(() => {
  cache = new CacheStore(path.join(app.getPath('userData'), 'cache.db'))
  setupScanner()
  setupIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cache?.close()
  if (process.platform !== 'darwin') app.quit()
})
