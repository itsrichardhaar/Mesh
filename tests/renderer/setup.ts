import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { liveSessionsStore } from '@renderer/hooks/useLiveSessions'
import { notificationsStore } from '@renderer/hooks/useNotifications'
import { quotaStore } from '@renderer/hooks/useQuota'
import { usageStore } from '@renderer/hooks/useUsage'
import { ptyHostStore } from '@renderer/state/pty-host'
import { installMeshApi } from './test-utils'

// A fresh typed `window.api` fake before every test — mock overrides and
// event subscriptions never leak across tests. (React Testing Library's
// auto-cleanup is active via vitest's `globals: true`.)
beforeEach(() => {
  installMeshApi()
})

// The renderer's stores are per-window singletons (Slice 48, ADR-0007);
// in tests, one jsdom "window" hosts every test in a file, so reset
// them the way a window reload would.
afterEach(() => {
  liveSessionsStore.setState({ tabs: [] })
  notificationsStore.setState({ notifications: [], globalMute: false })
  quotaStore.setState({ enabled: false, snapshot: null })
  usageStore.setState({ dashboard: null, indexing: false, metric: 'tokens', granularity: 'day', range: '30d' })
  ptyHostStore.setState({ mountNode: null, activeSlotId: null })
})
