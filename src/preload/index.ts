import { contextBridge, ipcRenderer } from 'electron'
import type { MeshApi } from '@shared/api'

const api: MeshApi = {
  ping: () => ipcRenderer.invoke('ping'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    update: (encodedPath, patch) => ipcRenderer.invoke('projects:update', encodedPath, patch)
  }
}

contextBridge.exposeInMainWorld('api', api)
