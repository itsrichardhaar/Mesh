import { contextBridge, ipcRenderer } from 'electron'
import type { MeshApi } from '@shared/api'

const api: MeshApi = {
  ping: () => ipcRenderer.invoke('ping'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    update: (encodedPath, patch) => ipcRenderer.invoke('projects:update', encodedPath, patch),
    stats: (encodedPath) => ipcRenderer.invoke('projects:stats', encodedPath)
  }
}

contextBridge.exposeInMainWorld('api', api)
