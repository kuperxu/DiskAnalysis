# Disk Analysis

A progressive macOS disk usage analyzer. Pick a folder, watch sizes appear top-down (first-level first, then deeper), pause anytime, click into any subdirectory to prioritize its scan. Result is shown as an interactive treemap colored by file type.

## Highlights

- **Progressive BFS scan** — depth-1 directories return first; the queue keeps draining deeper until you stop it.
- **Click-to-prioritize** — clicking any not-yet-scanned subdirectory boosts its priority so it scans next, even while other branches are still being explored.
- **Pause / resume** — in-flight `readdir`s finish, the queue stops draining, UI freezes mid-scan.
- **Treemap visualization** — D3 squarified treemap; cell size = bytes, color = dominant file category (Video, Image, Code, Cache, …). Drill in by clicking a directory cell.
- **Move to Trash** — right-pane button moves a selected file/folder to the system Trash via `shell.trashItem`. Tree updates and ancestor sizes drop accordingly.
- **Persistent cache** — `better-sqlite3` cache under `app.getPath('userData')`. Re-opening a previously-scanned folder hydrates instantly; mtime-based revalidation re-scans only changed branches (revalidation pass is the next milestone).

## Architecture

```
src/
  shared/types.ts            # IPC-safe types shared by main + renderer
  main/
    index.ts                 # Electron entry, IPC, window
    scanner/
      controller.ts          # priority queue + concurrency loop
      queue.ts               # min-heap with reprioritize/drop
      tree.ts                # readdir+lstat for one directory
      fileTypes.ts           # extension/path -> category map
    cache/store.ts           # better-sqlite3 schema + put/load/invalidate
  preload/index.ts           # contextBridge -> window.api
  renderer/
    App.tsx                  # 3-pane layout
    store.ts                 # zustand + immer; applies tree patches
    categories.ts            # color + format helpers (mirrors main)
    components/
      ControlBar.tsx         # top bar + breadcrumb
      Sidebar.tsx            # collapsible directory tree
      TreemapView.tsx        # D3 squarified treemap
      DetailsPanel.tsx       # selected file/dir info + trash button
```

The scanner runs **N concurrent `readdir`/`lstat` promises** (default `max(4, cpu_count)`), riding on libuv's threadpool (`UV_THREADPOOL_SIZE=32`). I/O-bound work doesn't need `worker_threads`. Patches from main → renderer are coalesced on an 80ms timer per path.

## Run

```sh
npm install
npm run dev          # launches Electron + Vite HMR
```

> First install will compile `better-sqlite3` for your Electron version via `electron-builder install-app-deps`. If you change Electron major versions, run `npm run rebuild`.

## Build a macOS app

```sh
npm run dist
# Output: dist/Disk Analysis-0.1.0.dmg
```

> The build is unsigned. To open it the first time, right-click → Open. Signing & notarization can be added later with `electron-builder` config.

## macOS permissions

Scanning `~/Library`, `~/Documents`, etc. requires **Full Disk Access** on recent macOS. If the app hits `EPERM`, the affected directory is marked `denied` in the tree (red dashed border in the treemap). Grant access in **System Settings → Privacy & Security → Full Disk Access** and re-scan.

The default scan also skips `/System`, `/private/var/vm`, `/private/var/db`, `/.Spotlight-V100`, `/.fseventsd`, `/.DocumentRevisions-V100`, and other mount points (`/Volumes/*` is filtered unless you explicitly choose a path beneath it).

## Verification checklist

| What | How |
| --- | --- |
| Progressive scan | Choose `~`. The sidebar should fill in level by level — `~/Documents`, `~/Downloads`, etc. show sizes within seconds; deeper sizes refine over time. |
| Pause / resume | Hit Pause mid-scan. Status text shows "Paused · N queued"; sidebar sizes stop changing. Resume continues. |
| Click priority | While `~` is scanning, click a slow-to-finish subtree (e.g. `~/Library`). Its descendants should fill in before other branches' deeper levels. |
| Coloring | Scan `~/Movies` (red dominant) vs. `~/Library/Caches` (gray). Hover for tooltip. |
| Trash | Select a small file in the details pane → Move to Trash → verify it appears in Finder's Trash and disappears from the treemap; ancestor sizes drop by exactly that file's size. |
| Cache | Quit the app after a full scan; relaunch and choose the same folder. The first treemap should appear within a second (currently the cache only writes; the read-on-start path is wired but the controller hasn't been hooked up to consume it — see roadmap). |

## Roadmap

- [ ] **Cache hydration on start** (read path is wired in `CacheStore.loadShallow`; controller does not yet consume it). Implement: at `start(root)`, walk `cache.loadShallow` top-down before any scanDirectory, emit hydration patches, then schedule a background mtime revalidation pass.
- [ ] **Excludes settings UI** — currently hardcoded.
- [ ] **EPERM onboarding modal** — link straight to the Full Disk Access settings pane.
- [ ] **Code signing & notarization** for the dmg.
- [ ] **Memory ceiling** — drop cold subtrees from the in-memory index when total node count > N.
