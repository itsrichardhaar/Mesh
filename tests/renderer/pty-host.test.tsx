import { act, render, screen } from '@testing-library/react'
import { useCallback } from 'react'
import { PtyHost } from '@renderer/components/PtyHost'
import { liveSessionsStore } from '@renderer/hooks/useLiveSessions'
import { ptyHostStore } from '@renderer/state/pty-host'

/**
 * Slice 49: the PtyHost's placement state machine — which view sits
 * where, holding-container membership, disposal on registry removal,
 * and the no-remount guarantee (the same DOM node moves between
 * containers; it is never re-created, which is what preserves xterm's
 * scrollback in production). PtyView is stubbed — xterm cannot run in
 * jsdom (permanent exclusion per PRD-v6); the real terminal behavior
 * is HITL-verified in Slice 50.
 */

vi.mock('@renderer/components/PtyView', async () => {
  const { useEffect } = await import('react')
  return {
    PtyView: ({
      sessionId,
      focused,
      onPtyId
    }: {
      sessionId: string
      focused?: boolean
      onPtyId?: (ptyId: string) => void
    }) => {
      // Mimic the real view's spawn contract: report a ptyId once.
      useEffect(() => {
        onPtyId?.(`pty-for-${sessionId}`)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid={`pty-view-${sessionId}`} data-focused={String(Boolean(focused))} />
    }
  }
})

/** Stand-in for the Workspace's PTY pane registering itself. */
function MountPane(): JSX.Element {
  const ref = useCallback((node: HTMLDivElement | null) => {
    ptyHostStore.getState().setMountNode(node)
  }, [])
  return <div data-testid="mount-pane" data-pty-mount="true" ref={ref} />
}

function addTab(slotId: string, sessionId: string): void {
  liveSessionsStore
    .getState()
    .add({ slotId, encodedPath: '-proj-a', sessionId, lastActivityAt: 1000 })
}

const inMount = (sessionId: string): boolean =>
  screen.getByTestId(`pty-view-${sessionId}`).closest('[data-testid="mount-pane"]') !== null

const inHolding = (sessionId: string): boolean =>
  screen.getByTestId(`pty-view-${sessionId}`).closest('.pty-host-holding') !== null

describe('PtyHost placement', () => {
  it('renders a new tab into the holding container when no mount is registered', async () => {
    render(<PtyHost />)
    await act(async () => {
      addTab('s1', 'sess-1')
    })

    expect(inHolding('sess-1')).toBe(true)
  })

  it('moves the active slot into the mount pane; others stay held', async () => {
    render(
      <>
        <PtyHost />
        <MountPane />
      </>
    )
    await act(async () => {
      addTab('s1', 'sess-1')
      addTab('s2', 'sess-2')
      ptyHostStore.getState().setActiveSlot('s1')
    })

    expect(inMount('sess-1')).toBe(true)
    expect(inHolding('sess-2')).toBe(true)
  })

  it('switching the active slot moves views without remounting them', async () => {
    render(
      <>
        <PtyHost />
        <MountPane />
      </>
    )
    await act(async () => {
      addTab('s1', 'sess-1')
      addTab('s2', 'sess-2')
      ptyHostStore.getState().setActiveSlot('s1')
    })
    const view1 = screen.getByTestId('pty-view-sess-1')
    const view2 = screen.getByTestId('pty-view-sess-2')

    await act(async () => {
      ptyHostStore.getState().setActiveSlot('s2')
    })

    // The load-bearing assertion: identical DOM nodes after the swap.
    // A remount would re-create them — and dispose xterm in production.
    expect(screen.getByTestId('pty-view-sess-1')).toBe(view1)
    expect(screen.getByTestId('pty-view-sess-2')).toBe(view2)
    expect(inHolding('sess-1')).toBe(true)
    expect(inMount('sess-2')).toBe(true)
  })

  it('returns the active view to holding when the mount unregisters', async () => {
    render(
      <>
        <PtyHost />
        <MountPane />
      </>
    )
    await act(async () => {
      addTab('s1', 'sess-1')
      ptyHostStore.getState().setActiveSlot('s1')
    })
    expect(inMount('sess-1')).toBe(true)

    // Workspace unmounted (Project switch) — callback ref fires null.
    await act(async () => {
      ptyHostStore.getState().setMountNode(null)
    })

    expect(inHolding('sess-1')).toBe(true)
  })

  it('unmounts a view only when its tab leaves the registry', async () => {
    render(<PtyHost />)
    await act(async () => {
      addTab('s1', 'sess-1')
    })
    expect(screen.getByTestId('pty-view-sess-1')).toBeInTheDocument()

    await act(async () => {
      liveSessionsStore.getState().remove('s1')
    })

    expect(screen.queryByTestId('pty-view-sess-1')).not.toBeInTheDocument()
  })

  it('marks only the mounted view focused', async () => {
    render(
      <>
        <PtyHost />
        <MountPane />
      </>
    )
    await act(async () => {
      addTab('s1', 'sess-1')
      addTab('s2', 'sess-2')
      ptyHostStore.getState().setActiveSlot('s1')
    })

    expect(screen.getByTestId('pty-view-sess-1')).toHaveAttribute('data-focused', 'true')
    expect(screen.getByTestId('pty-view-sess-2')).toHaveAttribute('data-focused', 'false')
  })

  it('wires each view\'s spawned ptyId back into the registry', async () => {
    render(<PtyHost />)
    await act(async () => {
      addTab('s1', 'sess-1')
    })

    expect(liveSessionsStore.getState().tabs[0]!.ptyId).toBe('pty-for-sess-1')
  })
})
