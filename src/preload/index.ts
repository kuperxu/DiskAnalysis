import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi, type TreePatch, type ScanLifecycle, type DirNode } from '../shared/types'

const api: RendererApi = {
  pickRoot: () => ipcRenderer.invoke(IPC.pickRoot),
  start: (root) => ipcRenderer.invoke(IPC.start, root),
  pause: () => ipcRenderer.invoke(IPC.pause),
  resume: () => ipcRenderer.invoke(IPC.resume),
  focus: (path) => ipcRenderer.invoke(IPC.focus, path),
  trash: (path) => ipcRenderer.invoke(IPC.trash, path),
  reveal: (path) => ipcRenderer.invoke(IPC.reveal, path),
  getTree: () => ipcRenderer.invoke(IPC.getTree) as Promise<DirNode | null>,

  onPatch: (cb) => {
    const listener = (_: unknown, patch: TreePatch) => cb(patch)
    ipcRenderer.on(IPC.patch, listener)
    return () => ipcRenderer.off(IPC.patch, listener)
  },

  onLifecycle: (cb) => {
    const listener = (_: unknown, s: ScanLifecycle) => cb(s)
    ipcRenderer.on(IPC.lifecycle, listener)
    return () => ipcRenderer.off(IPC.lifecycle, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
