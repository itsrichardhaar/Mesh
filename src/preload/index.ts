import { contextBridge, ipcRenderer } from 'electron'
import type { MeshApi } from '@shared/api'

const api: MeshApi = {
  ping: () => ipcRenderer.invoke('ping')
}

contextBridge.exposeInMainWorld('api', api)
