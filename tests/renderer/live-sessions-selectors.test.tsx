import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import {
  LiveSessionsProvider,
  liveSessionsStore,
  useLiveTabsForProject,
  useProjectIndicator
} from '@renderer/hooks/useLiveSessions'
import { meshEmit } from './test-utils'

/**
 * Slice 48: subscription granularity — the ADR-0007 requirement that
 * high-frequency PTY activity doesn't re-render coarse consumers.
 * Each probe counts its own renders; assertions pin the count.
 */

function IndicatorProbe({ encodedPath }: { encodedPath: string }): JSX.Element {
  const renders = useRef(0)
  renders.current += 1
  const { isLive, isActive } = useProjectIndicator(encodedPath)
  return (
    <output aria-label={`indicator ${encodedPath}`} data-renders={renders.current}>
      {`live:${isLive} active:${isActive}`}
    </output>
  )
}

function TabCountProbe({ encodedPath }: { encodedPath: string }): JSX.Element {
  const renders = useRef(0)
  renders.current += 1
  const tabs = useLiveTabsForProject(encodedPath)
  return (
    <output aria-label={`tabs ${encodedPath}`} data-renders={renders.current}>
      {`count:${tabs.length}`}
    </output>
  )
}

const renderCount = (label: string): string =>
  screen.getByLabelText(label).getAttribute('data-renders')!

function seedTab(slotId: string, encodedPath: string, ptyId: string): void {
  const state = liveSessionsStore.getState()
  state.add({ slotId, encodedPath, sessionId: `sess-${slotId}`, lastActivityAt: Date.now() })
  state.updatePtyId(slotId, ptyId)
}

describe('live-sessions subscription granularity', () => {
  it('PTY activity chunks do not re-render an indicator whose state is unchanged', async () => {
    seedTab('s1', '-proj-a', 'pty-1')
    render(
      <LiveSessionsProvider>
        <IndicatorProbe encodedPath="-proj-a" />
      </LiveSessionsProvider>
    )
    expect(screen.getByLabelText('indicator -proj-a')).toHaveTextContent('live:true active:true')
    const before = renderCount('indicator -proj-a')

    // Three PTY chunks — lastActivityAt advances in the store on each,
    // but isLive/isActive stay true throughout.
    const base = Date.now()
    for (let i = 1; i <= 3; i += 1) {
      await act(async () => {
        liveSessionsStore.getState().markActivity('s1', base + i)
      })
    }

    expect(renderCount('indicator -proj-a')).toBe(before)
    expect(screen.getByLabelText('indicator -proj-a')).toHaveTextContent('live:true active:true')
  })

  it("another Project's tabs never touch an unrelated indicator", async () => {
    render(
      <LiveSessionsProvider>
        <IndicatorProbe encodedPath="-proj-b" />
      </LiveSessionsProvider>
    )
    expect(screen.getByLabelText('indicator -proj-b')).toHaveTextContent('live:false active:false')
    const before = renderCount('indicator -proj-b')

    await act(async () => {
      seedTab('s1', '-proj-a', 'pty-1')
      liveSessionsStore.getState().markActivity('s1', Date.now() + 5)
    })

    expect(renderCount('indicator -proj-b')).toBe(before)
    expect(screen.getByLabelText('indicator -proj-b')).toHaveTextContent('live:false active:false')
  })

  it('the indicator flips when its Project\'s last tab exits', async () => {
    seedTab('s1', '-proj-a', 'pty-1')
    render(
      <LiveSessionsProvider>
        <IndicatorProbe encodedPath="-proj-a" />
      </LiveSessionsProvider>
    )
    expect(screen.getByLabelText('indicator -proj-a')).toHaveTextContent('live:true active:true')

    // The provider's pty:exit bridge removes the tab from the registry.
    await act(async () => {
      meshEmit().ptyExit({ ptyId: 'pty-1', exitCode: 0 })
    })

    expect(screen.getByLabelText('indicator -proj-a')).toHaveTextContent('live:false active:false')
  })

  it('useLiveTabsForProject is shallow — unrelated Projects do not re-render it', async () => {
    render(
      <LiveSessionsProvider>
        <TabCountProbe encodedPath="-proj-a" />
      </LiveSessionsProvider>
    )
    expect(screen.getByLabelText('tabs -proj-a')).toHaveTextContent('count:0')
    const before = renderCount('tabs -proj-a')

    await act(async () => {
      seedTab('s-other', '-proj-b', 'pty-9')
    })
    expect(renderCount('tabs -proj-a')).toBe(before)

    await act(async () => {
      seedTab('s-mine', '-proj-a', 'pty-10')
    })
    expect(screen.getByLabelText('tabs -proj-a')).toHaveTextContent('count:1')
  })
})
