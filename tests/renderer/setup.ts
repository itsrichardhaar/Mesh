import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { installMeshApi } from './test-utils'

// A fresh typed `window.api` fake before every test — mock overrides and
// event subscriptions never leak across tests. (React Testing Library's
// auto-cleanup is active via vitest's `globals: true`.)
beforeEach(() => {
  installMeshApi()
})
