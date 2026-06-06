import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { IPC, type DirNode, type ScanLifecycle, type TreePatch } from '../shared/types'
import { ScannerController } from './scanner/controller'
import { CacheStore } from './cache/store'

// Bump the libuv threadpool so concurrent fs.lstat / readdir calls don't
// queue against each other. Must be set BEFORE any I/O kicks off, ie. here
// at the top of the entry module.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE ?? '32'

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

  ipcMain.handle(IPC.trash, async (_e, p: string) => {
    // Refuse fast cases synchronously — the renderer awaits this just for the
    // refusal feedback, otherwise it returns ok almost instantly and the
    // actual `shell.trashItem` runs in the background.
    if (!fs.existsSync(p)) return { ok: false, error: 'Not found' }
    const root = scanner?.getTree()?.path
    if (root && path.resolve(p) === path.resolve(root)) {
      return { ok: false, error: 'Refusing to trash the scan root' }
    }

    // Optimistic UI: mark immediately so the renderer can grey out the cell.
    scanner?.markTrashing(p)

    // Don't await — return ok now; if shell.trashItem fails later, we revert
    // the mark and broadcast a fresh patch. This is what stops the UI from
    // hanging during a slow trash operation (e.g. a large folder on a slow
    // disk, or a path that triggers a system permission prompt).
    void (async (): Promise<void> => {
      try {
        await shell.trashItem(p)
        scanner?.markTrashed(p)
        // Fire-and-forget cache invalidation; don't block tree updates on it.
        queueMicrotask(() => cache?.invalidate(p))
      } catch (e) {
        scanner?.unmarkTrashing(p)
        // Surface to the main console; renderer sees the node return to its
        // prior state via the patch from unmarkTrashing.
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
