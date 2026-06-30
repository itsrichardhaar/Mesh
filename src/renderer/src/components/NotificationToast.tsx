import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Notification } from '@shared/types'
import type { JumpToSessionInput } from './NotificationsBell'
import { useNotifications } from '../hooks/useNotifications'

const TOAST_VISIBLE_MS = 6_000

interface Props {
  onJumpToSession: (input: JumpToSessionInput) => Promise<void> | void
}

interface ActiveToast {
  notification: Notification
  enteredAt: number
}

/**
 * App-level transient toast that pops in the top-right whenever the
 * idle detector fires a new notification (v5 / Slice 42). Subscribes
 * directly to `notifications.onCreated` rather than the dropdown's
 * cache so toasts arrive immediately even before the dropdown's list
 * re-fetch completes.
 *
 * Each toast displays for 6 seconds and then auto-dismisses. Multiple
 * toasts stack vertically (newest on top) — if two notifications fire
 * close together, both are visible simultaneously. Manual dismissal
 * via the × button removes the toast immediately without affecting
 * read state (the row stays unread in the dropdown until the user
 * clicks it).
 */
export function NotificationToast({ onJumpToSession }: Props): JSX.Element | null {
  const { markAllRead } = useNotifications()
  const [active, setActive] = useState<ActiveToast[]>([])
  // Refs to running timers so we can clear them on manual dismiss.
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const off = window.api.notifications.onCreated((notification) => {
      const enteredAt = Date.now()
      setActive((prev) => [{ notification, enteredAt }, ...prev])
      const timer = setTimeout(() => {
        setActive((prev) => prev.filter((t) => t.notification.id !== notification.id))
        timersRef.current.delete(notification.id)
      }, TOAST_VISIBLE_MS)
      timersRef.current.set(notification.id, timer)
    })
    return () => {
      off()
      // Clear any pending timers on unmount so they don't leak.
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [])

  const dismiss = (id: string): void => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setActive((prev) => prev.filter((t) => t.notification.id !== id))
  }

  const handleJump = async (notification: Notification): Promise<void> => {
    dismiss(notification.id)
    await markAllRead({ sessionId: notification.sessionId })
    await onJumpToSession({
      encodedPath: notification.encodedPath,
      sessionId: notification.sessionId,
      ptyId: notification.ptyId
    })
  }

  if (active.length === 0) return null

  return (
    <div className="notification-toast-stack" role="region" aria-label="New notifications">
      {active.map(({ notification }) => (
        <div key={notification.id} className="notification-toast" role="status">
          <button
            type="button"
            className="notification-toast-body"
            onClick={() => void handleJump(notification)}
            aria-label={`${notification.labelText} — jump to session`}
          >
            <div className="notification-toast-label">{notification.labelText}</div>
            <div className="notification-toast-meta">
              Session {notification.sessionId.slice(0, 8)}
            </div>
            <div className="notification-toast-jump">Jump to session →</div>
          </button>
          <button
            type="button"
            className="notification-toast-dismiss"
            onClick={() => dismiss(notification.id)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
