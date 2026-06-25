import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Virtuoso } from 'react-virtuoso'
import type { TranscriptMessage } from '@shared/sessions'

interface Props {
  encodedPath: string
  sessionId: string
}

/**
 * Workspace right pane when a Session is selected. Streams the
 * transcript via the `sessions:read-transcript` IPC and renders one
 * row per user/assistant text message — `react-markdown` for prose,
 * `react-virtuoso` for the virtualized scroll container so long
 * Sessions don't lock up the renderer. The "Resume in terminal →"
 * button is intentionally disabled here; Slice 16 wires it up.
 */
export function Transcript({ encodedPath, sessionId }: Props): JSX.Element {
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await window.api.sessions.readTranscript(encodedPath, sessionId)
        if (!cancelled) {
          setMessages(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    setMessages(null)
    setError(null)
    void load()

    const off = window.api.sessions.onChanged((changed) => {
      if (changed === encodedPath) void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [encodedPath, sessionId])

  return (
    <div className="transcript">
      <div className="transcript-toolbar">
        <button
          type="button"
          className="transcript-resume"
          disabled
          title="Live terminal lands in Slice 16"
        >
          Resume in terminal →
        </button>
      </div>
      {error && (
        <p className="transcript-error" role="alert">
          {error}
        </p>
      )}
      {!error && messages === null && <p className="transcript-loading">Loading…</p>}
      {!error && messages && messages.length === 0 && (
        <p className="transcript-empty">No rendered messages in this Session yet.</p>
      )}
      {!error && messages && messages.length > 0 && (
        <Virtuoso
          className="transcript-scroll"
          data={messages}
          computeItemKey={(_, item) => item.uuid}
          itemContent={(_, message) => <TranscriptRow message={message} />}
        />
      )}
    </div>
  )
}

function TranscriptRow({ message }: { message: TranscriptMessage }): JSX.Element {
  return (
    <div className={`transcript-row transcript-row-${message.role}`}>
      <div className="transcript-row-role">{message.role}</div>
      <div className="transcript-row-body">
        <ReactMarkdown>{message.markdown}</ReactMarkdown>
      </div>
    </div>
  )
}
