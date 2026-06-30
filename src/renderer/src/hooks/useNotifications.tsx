import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { Notification } from '@shared/types'

interface ContextValue {
  notifications: ReadonlyArray<Notification>
  unreadCount: number
  /** Mark a single notification as read; the main-process update event will refresh the list. */
  markRead: (id: string) => Promise<void>
  /** Mark all unread rows (optionally scoped) as read. */
  markAllRead: (opts?: { encodedPath?: string; sessionId?: string }) => Promise<void>
  clearAll: (opts?: { encodedPath?: string }) => Promise<void>
  /** Re-fetch the list from main. Useful after the renderer suspects desync. */
  refresh: () => Promise<void>
}

const NotificationsContext = createContext<ContextValue | null>(null)

/**
 * v5 / Slice 42: App-level state for in-window notifications. Loads
 * the list from main on mount and stays in sync via the three event
 * channels (`onCreated` / `onUpdated` / `onCleared`). Both the
 * `<NotificationsBell>` (top-bar dropdown) and the App-level
 * `<NotificationToast>` consume this context.
 *
 * The renderer is intentionally a *cache* over main's authoritative
 * SQLite — every action (`markRead`, `markAllRead`, `clearAll`) calls
 * the IPC and waits for main's update event to refresh local state,
 * rather than updating optimistically. Keeps the renderer simple and
 * guarantees the UI always reflects persisted state.
 */
export function NotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [notifications, setNotifications] = useState<ReadonlyArray<Notification>>([])

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.api.notifications.list()
    setNotifications(next)
  }, [])

  useEffect(() => {
    void refresh()
    const offCreated = window.api.notifications.onCreated(() => {
      void refresh()
    })
    const offUpdated = window.api.notifications.onUpdated(() => {
      void refresh()
    })
    const offCleared = window.api.notifications.onCleared(() => {
      void refresh()
    })
    return () => {
      offCreated()
      offUpdated()
      offCleared()
    }
  }, [refresh])

  const markRead = useCallback(async (id: string): Promise<void> => {
    await window.api.notifications.markRead(id)
  }, [])

  const markAllRead = useCallback(
    async (opts?: { encodedPath?: string; sessionId?: string }): Promise<void> => {
      await window.api.notifications.markAllRead(opts)
    },
    []
  )

  const clearAll = useCallback(async (opts?: { encodedPath?: string }): Promise<void> => {
    await window.api.notifications.clearAll(opts)
  }, [])

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.readAt === null).length,
    [notifications]
  )

  const value = useMemo<ContextValue>(
    () => ({ notifications, unreadCount, markRead, markAllRead, clearAll, refresh }),
    [notifications, unreadCount, markRead, markAllRead, clearAll, refresh]
  )

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  )
}

export function useNotifications(): ContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications: missing <NotificationsProvider> above this component')
  }
  return ctx
}
