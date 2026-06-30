import { useEffect, useRef, useState } from 'react'
import { ChevronsDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type {
  TranscriptEntry,
  TranscriptMessage,
  TranscriptSidechain,
  TranscriptToolEvent
} from '@shared/sessions'
import { CodeBlock } from './CodeBlock'

interface Props {
  encodedPath: string
  sessionId: string
  onResume: (sessionId: string) => void
}

/**
 * Workspace right pane when a Session is selected. Streams the
 * transcript via the `sessions:read-transcript` IPC and renders one
 * row per entry — message bubbles use `react-markdown` with a
 * shiki-backed code renderer; tool entries render as a `● Tool · arg`
 * one-liner; sidechains render as a `↳ sub-agent (N messages)` line.
 * `react-virtuoso` virtualizes the scroll container so long Sessions
 * don't lock up the renderer. The "Resume in terminal →" button is
 * intentionally disabled here; Slice 16 wires it up.
 */
export function Transcript({ encodedPath, sessionId, onResume }: Props): JSX.Element {
  const [entries, setEntries] = useState<TranscriptEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const scrollToBottom = (): void => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth'
    })
  }

  const canScroll = !error && entries !== null && entries.length > 0

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await window.api.sessions.readTranscript(encodedPath, sessionId)
        if (!cancelled) {
          setEntries(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    setEntries(null)
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
          className="transcript-jump-bottom"
          onClick={scrollToBottom}
          disabled={!canScroll}
          aria-label="Jump to bottom of transcript"
          title="Jump to bottom"
        >
          <ChevronsDown size={14} aria-hidden="true" />
          <span>Jump to bottom</span>
        </button>
        <button
          type="button"
          className="transcript-resume"
          onClick={() => onResume(sessionId)}
        >
          Resume in terminal →
        </button>
      </div>
      {error && (
        <p className="transcript-error" role="alert">
          {error}
        </p>
      )}
      {!error && entries === null && <p className="transcript-loading">Loading…</p>}
      {!error && entries && entries.length === 0 && (
        <p className="transcript-empty">No rendered messages in this Session yet.</p>
      )}
      {!error && entries && entries.length > 0 && (
        <Virtuoso
          ref={virtuosoRef}
          className="transcript-scroll"
          data={entries}
          computeItemKey={(_, item) => keyFor(item)}
          itemContent={(_, entry) => <EntryRow entry={entry} />}
        />
      )}
    </div>
  )
}

function keyFor(entry: TranscriptEntry): string {
  if (entry.kind === 'sidechain') return `sc:${entry.id}`
  return `${entry.kind}:${entry.uuid}`
}

function EntryRow({ entry }: { entry: TranscriptEntry }): JSX.Element {
  if (entry.kind === 'message') return <MessageRow message={entry} />
  if (entry.kind === 'tool') return <ToolRow tool={entry} />
  return <SidechainRow sidechain={entry} />
}

function MessageRow({ message }: { message: TranscriptMessage }): JSX.Element {
  return (
    <div className={`transcript-row transcript-row-${message.role}`}>
      <div className="transcript-row-role">{message.role}</div>
      <div className="transcript-row-body">
        <ReactMarkdown
          components={{
            code(props) {
              const { className, children, node: _node, ref: _ref, ...rest } = props
              const text = String(children ?? '').replace(/\n$/, '')
              const inline = !text.includes('\n')
              if (inline) {
                return (
                  <code className={className} {...rest}>
                    {children}
                  </code>
                )
              }
              const langMatch = /language-([\w-]+)/.exec(className ?? '')
              return <CodeBlock code={text} lang={langMatch?.[1]} />
            }
          }}
        >
          {message.markdown}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function ToolRow({ tool }: { tool: TranscriptToolEvent }): JSX.Element {
  return (
    <div className="transcript-tool-row">
      <span className="transcript-tool-bullet" aria-hidden="true">
        ●
      </span>
      <span className="transcript-tool-name">{tool.tool}</span>
      {tool.keyArg && (
        <>
          <span className="transcript-tool-sep" aria-hidden="true">
            ·
          </span>
          <span className="transcript-tool-arg" title={tool.keyArg}>
            {tool.keyArg}
          </span>
        </>
      )}
      {tool.resultSummary && (
        <span className="transcript-tool-summary">({tool.resultSummary})</span>
      )}
    </div>
  )
}

function SidechainRow({ sidechain }: { sidechain: TranscriptSidechain }): JSX.Element {
  const noun = sidechain.messageCount === 1 ? 'message' : 'messages'
  return (
    <div className="transcript-sidechain-row" role="note">
      <span aria-hidden="true">↳</span> sub-agent ({sidechain.messageCount} {noun})
    </div>
  )
}
