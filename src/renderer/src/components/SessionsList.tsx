import { useEffect, useState } from 'react'
import type { SessionSummary } from '@shared/sessions'
import { relativeTime } from '../util/relativeTime'

interface Props {
  encodedPath: string
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
}

/**
 * Middle column of the Workspace Screen. Fetches the Project's
 * Sessions on mount and whenever chokidar reports a `.jsonl` change.
 * Card click selects a Session; the right pane reads its transcript.
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
      {sessions.map((s) => {
        const isSelected = s.sessionId === selectedSessionId
        return (
          <li key={s.sessionId}>
            <button
              type="button"
              className={`session-card${isSelected ? ' session-card-selected' : ''}`}
              onClick={() => onSelect(s.sessionId)}
            >
              <div className="session-card-header">
                <span className="session-card-title">
                  {s.title || <em className="session-card-untitled">Untitled session</em>}
                </span>
                <span className="session-card-time">{relativeTime(s.lastActivityAt)}</span>
              </div>
              {s.preview && <p className="session-card-preview">{s.preview}</p>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
