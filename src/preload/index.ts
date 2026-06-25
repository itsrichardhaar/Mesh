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
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  theme: {
    setSource: (source) => ipcRenderer.send('theme:set-source', source)
  },
  secrets: {
    available: () => ipcRenderer.invoke('secrets:available'),
    set: (provider, plaintext) => ipcRenderer.invoke('secrets:set', provider, plaintext),
    getMask: (provider) => ipcRenderer.invoke('secrets:get-mask', provider),
    clear: (provider) => ipcRenderer.invoke('secrets:clear', provider)
  }
}

contextBridge.exposeInMainWorld('api', api)
