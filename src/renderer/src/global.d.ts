import type { MeshApi } from '@shared/api'

declare global {
  interface Window {
    api: MeshApi
  }
}

export {}
