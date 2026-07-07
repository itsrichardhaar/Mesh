import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { Notification } from '@shared/types'
import {
  createNotificationsStore,
  unreadCount as deriveUnreadCount
} from '../state/notifications'

/**
 * The App's notifications store instance (Slice 48 / v6, ADR-0007).
 * `window.api` is referenced lazily inside the deps closure, so
 * importing this module never touches the preload bridge.
 */
export const notificationsStore = createNotificationsStore({
  api: () => window.api.notifications
})

interface UseNotificationsValue {
  notifications: ReadonlyArray<Notification>
  unreadCount: number
  /** Mark a single notification as read; the main-process update event will refresh the list. */
  markRead: (id: string) => Promise<void>
  /** Mark all unread rows (optionally scoped) as read. */
  markAllRead: (opts?: { encodedPath?: string; sessionId?: string }) => Promise<void>
  clearAll: (opts?: { encodedPath?: string }) => Promise<void>
  /** Re-fetch the list from main. Useful after the renderer suspects desync. */
  refresh: () => Promise<void>
  /** Slice 43 (v5): global mute state + setter. */
  globalMute: boolean
  setGlobalMute: (value: boolean) => Promise<void>
}

/**
 * Event bridge, formerly the context provider (v5 / Slice 42). Loads
 * the list + mute flag from main on mount and keeps the store in sync
 * via the three lifecycle channels (`onCreated` / `onUpdated` /
 * `onCleared`) plus `onMuteChanged`. Both the `<NotificationsBell>`
 * dropdown and the App-level `<NotificationToast>` read the store.
 */
export function NotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    const state = notificationsStore.getState()
    void state.refresh()
    void state.loadGlobalMute()

    const refresh = (): void => {
      void notificationsStore.getState().refresh()
    }
    const offCreated = window.api.notifications.onCreated(refresh)
    const offUpdated = window.api.notifications.onUpdated(refresh)
    const offCleared = window.api.notifications.onCleared(refresh)
    const offMute = window.api.notifications.onMuteChanged((event) => {
      if (event.scope === 'global') notificationsStore.setState({ globalMute: event.value })
      // Per-project mute changes don't affect this store — the Project
      // objects themselves carry `muteNotifications`, and the context
      // menu / Project list refreshes through `projects.list`.
    })
    return () => {
      offCreated()
      offUpdated()
      offCleared()
      offMute()
    }
  }, [])

  return <>{children}</>
}

export function useNotifications(): UseNotificationsValue {
  const notifications = useStore(notificationsStore, (s) => s.notifications)
  const globalMute = useStore(notificationsStore, (s) => s.globalMute)
  const unreadCount = useStore(notificationsStore, deriveUnreadCount)
  const { markRead, markAllRead, clearAll, refresh, setGlobalMute } =
    notificationsStore.getState()
  return {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    clearAll,
    refresh,
    globalMute,
    setGlobalMute
  }
}
