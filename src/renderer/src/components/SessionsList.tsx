import { useEffect, useState } from 'react'
import type { SessionSummary } from '@shared/sessions'
import { useSessionIndicator } from '../hooks/useLiveSessions'
import { relativeTime } from '../util/relativeTime'
import { ActivitySpinner } from './ActivitySpinner'

interface Props {
  encodedPath: string
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
}

/**
 * Middle column of the Workspace Screen. Fetches the Project's
 * Sessions on mount and whenever chokidar reports a `.jsonl` change.
 * Card click selects a Session; the right pane reads its transcript.
 *
 * Slice 39 (v5): each row reads the live-PTY indicator state from the
 * App-level registry. Sessions with at least one live Pty Tab carry a
 * subtle green background tint (sticky); the activity area renders an
 * `<ActivitySpinner>` while the most-active tab is producing output
 * (within the 2 s recency window), and falls back to the existing
 * timestamp when idle.
 */
export function SessionsList({ encodedPath, selectedSessionId, onSelect }: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await window.api.sessions.list(encodedPath)
        if (!cancelled) {
          setSessions(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    setSessions(null)
    setError(null)
    void load()
    const off = window.api.sessions.onChanged((changed) => {
      if (changed === encodedPath) void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [encodedPath])

  if (error) {
    return (
      <p className="sessions-list-error" role="alert">
        {error}
      </p>
    )
  }
  if (!sessions) return <p className="sessions-list-loading">Loading…</p>
  if (sessions.length === 0) return <p className="sessions-list-empty">No sessions yet.</p>

  return (
    <ul className="sessions-list" role="list">
      {sessions.map((s) => (
        <SessionRow
          key={s.sessionId}
          summary={s}
          isSelected={s.sessionId === selectedSessionId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

function SessionRow({
  summary: s,
  isSelected,
  onSelect
}: {
  summary: SessionSummary
  isSelected: boolean
  onSelect: (sessionId: string) => void
}): JSX.Element {
  const { isLive, isActive } = useSessionIndicator(s.sessionId)
  const cardClass = [
    'session-card',
    isSelected ? 'session-card-selected' : '',
    isLive ? 'session-card-live' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li>
      <button
        type="button"
        className={cardClass}
        onClick={() => onSelect(s.sessionId)}
        aria-current={isSelected ? 'true' : undefined}
      >
        <div className="session-card-header">
          <span className="session-card-title">
            {s.title || <em className="session-card-untitled">Untitled session</em>}
          </span>
          <span className="session-card-time">
            {isActive ? (
              <ActivitySpinner size="small" ariaLabel="Agent active" />
            ) : (
              relativeTime(s.lastActivityAt)
            )}
          </span>
        </div>
        {s.preview && <p className="session-card-preview">{s.preview}</p>}
      </button>
    </li>
  )
}
