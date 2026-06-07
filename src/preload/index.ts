import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type RendererApi,
  type TreePatch,
  type ScanLifecycle,
  type DirNode,
  type Notice,
  type Settings
} from '../shared/types'

const api: RendererApi = {
  pickRoot: () => ipcRenderer.invoke(IPC.pickRoot),
  start: (root) => ipcRenderer.invoke(IPC.start, root),
  pause: () => ipcRenderer.invoke(IPC.pause),
  resume: () => ipcRenderer.invoke(IPC.resume),
  focus: (path) => ipcRenderer.invoke(IPC.focus, path),
  trash: (path) => ipcRenderer.invoke(IPC.trash, path),
  reveal: (path) => ipcRenderer.invoke(IPC.reveal, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getTree: () => ipcRenderer.invoke(IPC.getTree) as Promise<DirNode | null>,

  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<Settings>,
  setSettings: (patch) =>
    ipcRenderer.invoke(IPC.setSettings, patch) as Promise<Settings>,

  onPatch: (cb) => {
    const listener = (_: unknown, patch: TreePatch) => cb(patch)
    ipcRenderer.on(IPC.patch, listener)
    return () => ipcRenderer.off(IPC.patch, listener)
  },

  onLifecycle: (cb) => {
    const listener = (_: unknown, s: ScanLifecycle) => cb(s)
    ipcRenderer.on(IPC.lifecycle, listener)
    return () => ipcRenderer.off(IPC.lifecycle, listener)
  },

  onNotice: (cb) => {
    const listener = (_: unknown, n: Notice) => cb(n)
    ipcRenderer.on(IPC.notice, listener)
    return () => ipcRenderer.off(IPC.notice, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
