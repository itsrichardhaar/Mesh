/**
 * Renderer-side cache of the notifications table (Slice 42, v5;
 * converted to a Zustand vanilla store in Slice 48, v6 — ADR-0007).
 *
 * The renderer is intentionally a *cache* over main's authoritative
 * SQLite — every action (`markRead`, `markAllRead`, `clearAll`,
 * `setGlobalMute`) calls the IPC and waits for main's update event to
 * refresh local state, rather than updating optimistically. Keeps the
 * renderer simple and guarantees the UI always reflects persisted
 * state. The event subscriptions that drive `refresh` live in
 * `hooks/useNotifications.tsx`.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MeshApi } from '@shared/api'
import type { Notification } from '@shared/types'

type NotificationsApi = Pick<
  MeshApi['notifications'],
  'list' | 'markRead' | 'markAllRead' | 'clearAll' | 'getGlobalMute' | 'setGlobalMute'
>

export interface NotificationsState {
  notifications: ReadonlyArray<Notification>
  /** Slice 43 (v5): global mute state, echoed from main via mute-changed events. */
  globalMute: boolean

  /** Re-fetch the list from main. */
  refresh(): Promise<void>
  /** Load the persisted global-mute flag (once, on bootstrap). */
  loadGlobalMute(): Promise<void>
  markRead(id: string): Promise<void>
  markAllRead(opts?: { encodedPath?: string; sessionId?: string }): Promise<void>
  clearAll(opts?: { encodedPath?: string }): Promise<void>
  /**
   * Write-through only — local `globalMute` follows main's
   * `notifications:mute-changed` echo, so callers can disable buttons
   * on the in-flight promise without ever seeing unpersisted state.
   */
  setGlobalMute(value: boolean): Promise<void>
}

export interface NotificationsDeps {
  /** Production: `() => window.api.notifications`. Tests inject a fake. */
  api: () => NotificationsApi
}

export type NotificationsStore = StoreApi<NotificationsState>

export function createNotificationsStore(deps: NotificationsDeps): NotificationsStore {
  return createStore<NotificationsState>()((set) => ({
    notifications: [],
    globalMute: false,

    refresh: async () => {
      const next = await deps.api().list()
      set({ notifications: next })
    },

    loadGlobalMute: async () => {
      const value = await deps.api().getGlobalMute()
      set({ globalMute: value })
    },

    markRead: async (id) => {
      await deps.api().markRead(id)
    },

    markAllRead: async (opts) => {
      await deps.api().markAllRead(opts)
    },

    clearAll: async (opts) => {
      await deps.api().clearAll(opts)
    },

    setGlobalMute: async (value) => {
      await deps.api().setGlobalMute(value)
    }
  }))
}

export function unreadCount(state: Pick<NotificationsState, 'notifications'>): number {
  return state.notifications.filter((n) => n.readAt === null).length
}
