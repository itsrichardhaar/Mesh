import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { PtyCreateErrorCode } from '@shared/pty'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  encodedPath: string
  sessionId: string
  onExit?: () => void
  /** Fired (with the assigned ptyId) once the pty spawns. */
  onPtyId?: (ptyId: string) => void
  /** Fired on every output chunk so the parent can drive the ● activity indicator. */
  onActivity?: () => void
  /**
   * When the Workspace is hosting multiple tabs (Slice 17), inactive
   * PtyViews stay mounted with `display: none` so scrollback survives.
   * The viewport hides itself when `hidden` is true.
   */
  hidden?: boolean
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
export function PtyView({
  encodedPath,
  sessionId,
  onExit,
  onPtyId,
  onActivity,
  hidden
}: Props): JSX.Element {
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
        "'JetBrains Mono Variable', 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 13,
      theme: xtermTheme(effective),
      // CLIs (Claude, git diff, delta, etc.) sometimes set foreground and
      // background to the same ANSI color, producing invisible text. xterm
      // can post-process the rendered colors to maintain a minimum WCAG
      // contrast ratio between fg and bg — 4.5 = WCAG AA for normal text.
      minimumContrastRatio: 4.5,
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
      if (event.ptyId === ptyIdRef.current) {
        term.write(event.data)
        onActivity?.()
      }
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
        onPtyId?.(result.ptyId)
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

  // Push theme changes into the live terminal without re-creating
  // it. We listen on the `[data-theme]` attribute itself rather than
  // the React `effective` value because child effects run before
  // parent effects — by the time `effective` flips, the DOM attribute
  // (which ThemeProvider writes from its own effect) might not have
  // updated yet, and `getComputedStyle` would still see the old
  // palette. The MutationObserver fires after the attribute write,
  // so the values are always fresh.
  useEffect(() => {
    const apply = (): void => {
      if (termRef.current) {
        termRef.current.options.theme = xtermTheme(effective)
      }
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [effective])

  return (
    <div className="pty-view" hidden={hidden}>
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

/**
 * Mesh Light ANSI palette (Slice 27). Built on Solarized Light's proven
 * saturated mid-tones — they're chosen so each slot is readable BOTH as
 * foreground text on a light canvas AND as a background with default
 * foreground text on top (the latter matters for `git diff`, `delta`,
 * etc., which highlight whole lines with `ESC[4N`m background codes).
 * A previous iteration of this palette used dark muted tones (e.g.,
 * green `#5e8454`) which caused green-on-green collisions when tools
 * used ANSI green as a background.
 */
const MESH_LIGHT_ANSI: Record<string, string> = {
  black: '#1a1814',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#9a948a',
  brightBlack: '#6b665d',
  brightRed: '#e54838',
  brightGreen: '#92a30f',
  brightYellow: '#c69500',
  brightBlue: '#3d99e3',
  brightMagenta: '#df4f93',
  brightCyan: '#37b3aa',
  brightWhite: '#1a1814'
}

/**
 * Mesh Dark ANSI palette. Explicit (rather than relying on xterm
 * defaults) so palette evolution is symmetric with light mode — both
 * tracked in source, no implicit version-dependent defaults.
 */
const MESH_DARK_ANSI: Record<string, string> = {
  black: '#2f2b25',
  red: '#e88a8a',
  green: '#88c180',
  yellow: '#e0b060',
  blue: '#88a8d0',
  magenta: '#c08ac0',
  cyan: '#80c0c0',
  white: '#b8b0a3',
  brightBlack: '#5a554d',
  brightRed: '#f0a6a6',
  brightGreen: '#a0d098',
  brightYellow: '#eec888',
  brightBlue: '#a0c0e0',
  brightMagenta: '#d0a6d0',
  brightCyan: '#a0d0d0',
  brightWhite: '#f5f1ea'
}

/**
 * Read xterm's surface palette from Mesh's design tokens via live
 * `getComputedStyle(document.documentElement)` (so the terminal stays
 * in lock-step with the rest of the app), and merge in the explicit
 * ANSI palette for `effective`. Without the ANSI override, xterm falls
 * back to its dark-tuned defaults which become unreadable on Mesh's
 * light canvas (yellow `#e5e510` on cream `#faf8f4` was the v1 bug).
 */
function xtermTheme(effective: 'light' | 'dark'): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => {
    const raw = css.getPropertyValue(name).trim()
    return raw.length > 0 ? raw : fallback
  }
  const ansi = effective === 'light' ? MESH_LIGHT_ANSI : MESH_DARK_ANSI
  return {
    background: v('--bg-canvas', '#faf8f4'),
    foreground: v('--text-primary', '#1a1814'),
    cursor: v('--accent', '#d97757'),
    cursorAccent: v('--accent-fg', '#ffffff'),
    selectionBackground: v('--bg-elevated', '#e8e4dc'),
    ...ansi
  }
}
