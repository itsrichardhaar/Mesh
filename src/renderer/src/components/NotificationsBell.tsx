import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import type { Notification } from '@shared/types'
import { useNotifications } from '../hooks/useNotifications'
import { relativeTime } from '../util/relativeTime'

export interface JumpToSessionInput {
  encodedPath: string
  sessionId: string
  ptyId: string | null
}

interface Props {
  onJumpToSession: (input: JumpToSessionInput) => Promise<void> | void
  /**
   * Slice 43 (v5) hook: when global mute is active, the bell renders
   * the `BellOff` variant. Wired in Slice 43; defaults to `false` so
   * Slice 42 can ship with the always-`Bell` glyph.
   */
  globalMute?: boolean
}

/**
 * Top-bar bell icon + dropdown anchor (v5 / Slice 42). Click toggles
 * the dropdown. An unread dot (no number — matches the muted-style
 * pattern from Slice 36's Analyze button subtitle) appears in the
 * top-right corner of the icon when at least one unread notification
 * exists.
 *
 * Rendered inside `TopBar.tsx` between the spacer and the theme
 * toggle, so it sits to the left of the Light/Dark + Settings buttons
 * as described in the v5 planning grilling session.
 */
export function NotificationsBell({ onJumpToSession, globalMute = false }: Props): JSX.Element {
  const { notifications, unreadCount, markAllRead, clearAll, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleJump = async (n: Notification): Promise<void> => {
    setOpen(false)
    // Mark this session's unread as read so the badge clears in step
    // with the navigation, regardless of what the destination does.
    await markAllRead({ sessionId: n.sessionId })
    await onJumpToSession({
      encodedPath: n.encodedPath,
      sessionId: n.sessionId,
      ptyId: n.ptyId
    })
  }

  const Glyph = globalMute ? BellOff : Bell
  const label = open
    ? 'Close notifications'
    : `${unreadCount > 0 ? `${unreadCount} unread n` : 'N'}otifications`

  return (
    <div className="notifications-bell" ref={containerRef}>
      <button
        type="button"
        className={`top-bar-action${open ? ' top-bar-action-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={globalMute ? 'Notifications (muted)' : 'Notifications'}
      >
        <Glyph size={16} />
        {unreadCount > 0 && (
          <span className="notifications-bell-dot" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          className="notifications-dropdown"
          role="dialog"
          aria-label="Notifications"
        >
          <header className="notifications-dropdown-header">
            <span className="notifications-dropdown-title">Notifications</span>
            <div className="notifications-dropdown-actions">
              <button
                type="button"
                className="notifications-dropdown-action"
                onClick={() => void markAllRead()}
                disabled={unreadCount === 0}
              >
                Mark all read
              </button>
              <button
                type="button"
                className="notifications-dropdown-action notifications-dropdown-action-danger"
                onClick={() => void clearAll()}
                disabled={notifications.length === 0}
              >
                Clear all
              </button>
            </div>
          </header>
          <div className="notifications-dropdown-body">
            {notifications.length === 0 ? (
              <p className="notifications-dropdown-empty">No notifications yet.</p>
            ) : (
              <ul className="notifications-list" role="list">
                {notifications.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onJump={() => void handleJump(n)}
                    onMarkRead={() => void markRead(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NotificationRow({
  notification: n,
  onJump,
  onMarkRead
}: {
  notification: Notification
  onJump: () => void
  onMarkRead: () => void
}): JSX.Element {
  const unread = n.readAt === null
  const className = `notifications-row${unread ? ' notifications-row-unread' : ''}`
  return (
    <li className={className}>
      <div className="notifications-row-text">
        <div className="notifications-row-label">{n.labelText}</div>
        <div className="notifications-row-meta">
          <span className="notifications-row-session">Session {n.sessionId.slice(0, 8)}</span>
          <span aria-hidden="true">·</span>
          <span className="notifications-row-time">{relativeTime(n.createdAt)}</span>
        </div>
      </div>
      <div className="notifications-row-actions">
        <button type="button" className="notifications-row-jump" onClick={onJump}>
          Jump to session
        </button>
        {unread && (
          <button
            type="button"
            className="notifications-row-dismiss"
            onClick={onMarkRead}
            aria-label="Mark as read"
            title="Mark as read"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  )
}
