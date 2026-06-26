import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { PtyCreateErrorCode } from '@shared/pty'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  encodedPath: string
  sessionId: string
  onExit?: () => void
}

type State =
  | { status: 'spawning' }
  | { status: 'running'; ptyId: string }
  | { status: 'exited'; exitCode: number }
  | { status: 'error'; code: PtyCreateErrorCode | 'unknown'; message: string }

/**
 * Live `claude --resume` view: spawns a pty via the main process,
 * pipes its output into xterm, and writes user keystrokes back. The
 * `FitAddon` keeps the terminal matched to the container's pixel
 * dimensions; resize events propagate back to the pty so the child
 * process sees a consistent COLUMNS/LINES. Unmount kills the pty —
 * single-tab semantics in Slice 16; multi-tab persistence lands in
 * Slice 17.
 */
export function PtyView({ encodedPath, sessionId, onExit }: Props): JSX.Element {
  const { effective } = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const writeQueueRef = useRef<string[]>([])
  const [state, setState] = useState<State>({ status: 'spawning' })

  // Single-shot lifecycle effect: build the terminal, request a pty,
  // wire data/exit streams, and tear it all down on unmount. We
  // intentionally don't re-run on session change — `App` swaps the
  // PtyView via a `key={sessionId}` change so a session switch
  // remounts cleanly with a fresh pty.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 13,
      theme: xtermTheme(effective),
      scrollback: 10_000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(node)
    try {
      fit.fit()
    } catch {
      // Container may have zero size on the very first paint; the
      // ResizeObserver below catches up once layout settles.
    }
    termRef.current = term
    fitRef.current = fit

    // Until the pty is ready, queue keystrokes so a fast typer
    // doesn't lose input during the spawn round-trip.
    term.onData((data) => {
      const id = ptyIdRef.current
      if (id) {
        void window.api.pty.write(id, data)
      } else {
        writeQueueRef.current.push(data)
      }
    })

    const offData = window.api.pty.onData((event) => {
      if (event.ptyId === ptyIdRef.current) term.write(event.data)
    })
    const offExit = window.api.pty.onExit((event) => {
      if (event.ptyId !== ptyIdRef.current) return
      setState({ status: 'exited', exitCode: event.exitCode })
      onExit?.()
    })

    const dims = term.cols && term.rows ? { cols: term.cols, rows: term.rows } : { cols: 80, rows: 24 }
    ;(async () => {
      try {
        const result = await window.api.pty.create({
          encodedPath,
          sessionId,
          cols: dims.cols,
          rows: dims.rows
        })
        if (!result.ok) {
          setState({ status: 'error', code: result.code, message: result.message })
          return
        }
        ptyIdRef.current = result.ptyId
        setState({ status: 'running', ptyId: result.ptyId })
        // Drain any input the user typed while the spawn was in flight.
        const drained = writeQueueRef.current
        writeQueueRef.current = []
        for (const chunk of drained) {
          void window.api.pty.write(result.ptyId, chunk)
        }
      } catch (err) {
        setState({
          status: 'error',
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    })()

    // Keep the pty's COLUMNS/LINES in sync with the container.
    const observer = new ResizeObserver(() => {
      const f = fitRef.current
      const t = termRef.current
      const id = ptyIdRef.current
      if (!f || !t) return
      try {
        f.fit()
      } catch {
        return
      }
      if (id) void window.api.pty.resize(id, t.cols, t.rows)
    })
    observer.observe(node)

    return () => {
      observer.disconnect()
      offData()
      offExit()
      const id = ptyIdRef.current
      ptyIdRef.current = null
      if (id) void window.api.pty.kill(id)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedPath, sessionId])

  // Push theme changes into the live terminal without re-creating it.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(effective)
    }
  }, [effective])

  return (
    <div className="pty-view">
      {state.status === 'error' && <PtyErrorBanner state={state} />}
      <div ref={containerRef} className="pty-view-terminal" />
      {state.status === 'exited' && (
        <div className="pty-view-exited" role="status">
          Session exited (code {state.exitCode}).
        </div>
      )}
    </div>
  )
}

function PtyErrorBanner({
  state
}: {
  state: { code: PtyCreateErrorCode | 'unknown'; message: string }
}): JSX.Element {
  if (state.code === 'claude-not-found') {
    return (
      <div className="pty-view-banner pty-view-banner-error" role="alert">
        <strong>Claude CLI not found</strong>
        <p>
          Mesh couldn’t locate the <code>claude</code> binary on your
          <code>PATH</code>. Install Claude Code, then click Resume again.
        </p>
        <p>
          <a
            href="https://www.claude.com/product/claude-code"
            onClick={(e) => {
              e.preventDefault()
              void window.api.shell.openExternal(
                'https://www.claude.com/product/claude-code'
              )
            }}
          >
            Get Claude Code →
          </a>
        </p>
      </div>
    )
  }
  return (
    <div className="pty-view-banner pty-view-banner-error" role="alert">
      <strong>Couldn’t start the session</strong>
      <p>{state.message}</p>
    </div>
  )
}

function xtermTheme(effective: 'light' | 'dark'): Record<string, string> {
  // Minimal token-aligned default; the full design-token integration
  // criterion deferred from Slice 18 will replace this with a
  // CSS-variable-driven palette under Slice 17.
  if (effective === 'dark') {
    return {
      background: '#1a1814',
      foreground: '#f5f1ea',
      cursor: '#d97757',
      selectionBackground: '#3a352e'
    }
  }
  return {
    background: '#faf8f4',
    foreground: '#1a1814',
    cursor: '#d97757',
    selectionBackground: '#e8e4dc'
  }
}
