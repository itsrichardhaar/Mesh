import { contextBridge, ipcRenderer } from 'electron'
import type { MeshApi } from '@shared/api'

function subscribe(channel: string, cb: () => void): () => void {
  const handler = (): void => cb()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: MeshApi = {
  ping: () => ipcRenderer.invoke('ping'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    update: (encodedPath, patch) => ipcRenderer.invoke('projects:update', encodedPath, patch),
    stats: (encodedPath) => ipcRenderer.invoke('projects:stats', encodedPath)
  },
  menu: {
    onOpenSettings: (cb) => subscribe('menu:open-settings', cb),
    onCloseRequested: (cb) => subscribe('menu:close-requested', cb)
  },
  window: {
    close: () => ipcRenderer.send('window:close')
  }
}

contextBridge.exposeInMainWorld('api', api)
