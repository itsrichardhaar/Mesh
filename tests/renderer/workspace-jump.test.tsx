import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import type { Project } from '@shared/types'
import { PtyHost } from '@renderer/components/PtyHost'
import { LiveSessionsProvider, useLiveSessionsActions } from '@renderer/hooks/useLiveSessions'
import { WorkspaceScreen, type PendingJump } from '@renderer/screens/WorkspaceScreen'
import { meshEmit } from './test-utils'

/**
 * Slice 46: Jump-to-session resolution inside WorkspaceScreen — the
 * trickiest renderer logic v5 shipped. Three tiers: (1) live tab whose
 * ptyId matches, (2) any live tab for the sessionId, (3) transcript
 * fallback. Consumption is one-shot, keyed by a monotonic `key` so a
 * repeat jump to the same session re-triggers.
 *
 * Heavy leaf components are stubbed: xterm (PtyView) and Monaco
 * (FileViewer) cannot run in jsdom — permanently excluded per PRD-v6 —
 * and FileTree / Transcript / SessionsList are out of this test's
 * scope. Stubs expose the two state outputs the jump effect writes:
 * which Pty Tab is visible, and which Session is selected.
 */

vi.mock('@renderer/components/PtyView', () => ({
  PtyView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`pty-view-${sessionId}`} />
  )
}))
vi.mock('@renderer/components/FileViewer', () => ({
  FileViewer: () => <div data-testid="file-viewer" />
}))
vi.mock('@renderer/components/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />
}))
vi.mock('@renderer/components/Transcript', () => ({
  Transcript: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="transcript" data-session={sessionId} />
  )
}))
vi.mock('@renderer/components/SessionsList', () => ({
  SessionsList: ({
    selectedSessionId,
    onSelect
  }: {
    selectedSessionId: string | null
    onSelect: (sessionId: string) => void
  }) => (
    <div data-testid="sessions-list" data-selected={selectedSessionId ?? 'none'}>
      <button type="button" onClick={() => onSelect('unrelated-session')}>
        select unrelated session
      </button>
    </div>
  )
}))

const PROJECT: Project = {
  encodedPath: '-Users-x-proj',
  sourcePath: '/Users/x/proj',
  name: 'proj',
  autoSubtitle: null,
  activity: '2026-07-07T12:00:00.000Z',
  sourceMissing: false,
  hidden: false,
  muteNotifications: false
}

interface SeedTab {
  slotId: string
  sessionId: string
  ptyId?: string
}

/** Seeds the App-level registry once, the way Resume + pty:create would. */
function Seeder({ tabs }: { tabs: SeedTab[] }): null {
  const { addTab, setPtyId } = useLiveSessionsActions()
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    for (const tab of tabs) {
      addTab({ slotId: tab.slotId, encodedPath: PROJECT.encodedPath, sessionId: tab.sessionId })
      if (tab.ptyId) setPtyId(tab.slotId, tab.ptyId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function Harness({
  tabs,
  pendingJump,
  onConsumed
}: {
  tabs: SeedTab[]
  pendingJump: PendingJump | null
  onConsumed: () => void
}): JSX.Element {
  return (
    <LiveSessionsProvider>
      <Seeder tabs={tabs} />
      {/* Slice 49: PtyViews render under the App-level host and portal
          into the Workspace's mount pane while their tab is active. */}
      <PtyHost />
      <WorkspaceScreen
        project={PROJECT}
        visible={true}
        onBack={() => undefined}
        treeCollapsed={false}
        pendingJump={pendingJump}
        onPendingJumpConsumed={onConsumed}
      />
    </LiveSessionsProvider>
  )
}

const jump = (input: Partial<PendingJump> & { key: number }): PendingJump => ({
  encodedPath: PROJECT.encodedPath,
  sessionId: 'session-a',
  ptyId: null,
  ...input
})

// Slice 49: "visible" = the view's stable wrapper currently occupies
// the Workspace's PTY mount pane (inactive views sit in the PtyHost's
// holding container).
const ptyVisible = (sessionId: string): boolean =>
  screen.getByTestId(`pty-view-${sessionId}`).closest('[data-pty-mount]') !== null

const selectedSession = (): string | null =>
  screen.getByTestId('sessions-list').getAttribute('data-selected')

describe('Jump-to-session — three-tier resolution', () => {
  const TWO_TABS: SeedTab[] = [
    { slotId: 'slot-a', sessionId: 'session-a', ptyId: 'pty-a' },
    { slotId: 'slot-b', sessionId: 'session-b', ptyId: 'pty-b' }
  ]

  it('tier 1: activates the tab whose ptyId matches', async () => {
    const onConsumed = vi.fn()
    const { rerender } = render(<Harness tabs={TWO_TABS} pendingJump={null} onConsumed={onConsumed} />)
    await act(async () => {})

    rerender(
      <Harness
        tabs={TWO_TABS}
        pendingJump={jump({ key: 1, sessionId: 'session-b', ptyId: 'pty-b' })}
        onConsumed={onConsumed}
      />
    )

    expect(ptyVisible('session-b')).toBe(true)
    expect(ptyVisible('session-a')).toBe(false)
    expect(selectedSession()).toBe('session-b')
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('tier 2: falls back to any live tab for the sessionId when the ptyId is gone', async () => {
    const onConsumed = vi.fn()
    const { rerender } = render(<Harness tabs={TWO_TABS} pendingJump={null} onConsumed={onConsumed} />)
    await act(async () => {})

    // The notified PTY no longer exists (re-spawned agent) — same session does.
    rerender(
      <Harness
        tabs={TWO_TABS}
        pendingJump={jump({ key: 1, sessionId: 'session-a', ptyId: 'pty-dead' })}
        onConsumed={onConsumed}
      />
    )

    expect(ptyVisible('session-a')).toBe(true)
    expect(selectedSession()).toBe('session-a')
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('tier 3: no live tab — surfaces the read-only transcript selection', async () => {
    const onConsumed = vi.fn()
    const { rerender } = render(<Harness tabs={[]} pendingJump={null} onConsumed={onConsumed} />)
    await act(async () => {})

    rerender(
      <Harness
        tabs={[]}
        pendingJump={jump({ key: 1, sessionId: 'session-gone', ptyId: 'pty-gone' })}
        onConsumed={onConsumed}
      />
    )

    expect(selectedSession()).toBe('session-gone')
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('ignores jumps targeted at a different Project', async () => {
    const onConsumed = vi.fn()
    const { rerender } = render(<Harness tabs={TWO_TABS} pendingJump={null} onConsumed={onConsumed} />)
    await act(async () => {})

    rerender(
      <Harness
        tabs={TWO_TABS}
        pendingJump={jump({ key: 1, encodedPath: '-some-other-project', sessionId: 'session-a' })}
        onConsumed={onConsumed}
      />
    )

    expect(selectedSession()).toBe('none')
    expect(onConsumed).not.toHaveBeenCalled()
  })
})

describe('Jump-to-session — one-shot consumption + re-trigger', () => {
  const ONE_TAB: SeedTab[] = [{ slotId: 'slot-a', sessionId: 'session-a', ptyId: 'pty-a' }]

  it('a repeat jump to the same session re-triggers via a fresh key', async () => {
    const user = userEvent.setup()
    const onConsumed = vi.fn()
    const { rerender } = render(<Harness tabs={ONE_TAB} pendingJump={null} onConsumed={onConsumed} />)
    await act(async () => {})

    rerender(
      <Harness
        tabs={ONE_TAB}
        pendingJump={jump({ key: 1, sessionId: 'session-a', ptyId: 'pty-a' })}
        onConsumed={onConsumed}
      />
    )
    expect(ptyVisible('session-a')).toBe(true)
    expect(onConsumed).toHaveBeenCalledTimes(1)

    // App clears the one-shot after consumption.
    rerender(<Harness tabs={ONE_TAB} pendingJump={null} onConsumed={onConsumed} />)

    // The user wanders off — selecting another Session deactivates the tab.
    await user.click(screen.getByRole('button', { name: 'select unrelated session' }))
    expect(ptyVisible('session-a')).toBe(false)

    // Same payload, fresh key — the effect must re-fire.
    rerender(
      <Harness
        tabs={ONE_TAB}
        pendingJump={jump({ key: 2, sessionId: 'session-a', ptyId: 'pty-a' })}
        onConsumed={onConsumed}
      />
    )
    expect(ptyVisible('session-a')).toBe(true)
    expect(onConsumed).toHaveBeenCalledTimes(2)
  })
})

describe('live-sessions registry — PTY event sync', () => {
  it('removes a tab (and its view) when its PTY exits', async () => {
    const tabs: SeedTab[] = [{ slotId: 'slot-a', sessionId: 'session-a', ptyId: 'pty-a' }]
    render(<Harness tabs={tabs} pendingJump={null} onConsumed={() => undefined} />)
    await act(async () => {})
    expect(screen.getByTestId('pty-view-session-a')).toBeInTheDocument()

    await act(async () => {
      meshEmit().ptyExit({ ptyId: 'pty-a', exitCode: 0 })
    })

    expect(screen.queryByTestId('pty-view-session-a')).not.toBeInTheDocument()
  })
})
