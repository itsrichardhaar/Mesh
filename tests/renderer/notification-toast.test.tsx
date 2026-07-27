import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationToast } from '@renderer/components/NotificationToast'
import { NotificationsProvider } from '@renderer/hooks/useNotifications'
import { buildNotification, meshApi, meshEmit } from './test-utils'

/**
 * Slice 46: toast lifecycle. The toast subscribes directly to
 * `notifications:created` (not the dropdown's cache) so it renders
 * immediately on the event. Mute is enforced in main — a muted
 * notification never produces a created event, which is why the last
 * test drives only the list/updated channel and expects no toast.
 *
 * Fake timers are scoped to the auto-dismiss test only: user-event and
 * fake timers deadlock in jsdom, and the interaction tests finish well
 * inside the 6 s window on real timers.
 */

async function renderToast(onJump = vi.fn()): Promise<{ onJump: ReturnType<typeof vi.fn> }> {
  render(
    <NotificationsProvider>
      <NotificationToast onJumpToSession={onJump} />
    </NotificationsProvider>
  )
  // Settle the provider's initial list/mute fetch.
  await act(async () => {})
  return { onJump }
}

async function emitCreated(overrides: Parameters<typeof buildNotification>[0] = {}): Promise<void> {
  await act(async () => {
    meshEmit().notificationCreated(buildNotification(overrides))
  })
}

describe('NotificationToast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing until a notification is created', async () => {
    await renderToast()
    expect(screen.queryByRole('region', { name: 'New notifications' })).not.toBeInTheDocument()
  })

  it('shows a toast with label and session meta, and auto-dismisses after 6 s', async () => {
    await renderToast()
    vi.useFakeTimers()
    await emitCreated({ labelText: 'Agent is idle', sessionId: 'abcdef12-3456' })

    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Agent is idle')
    expect(toast).toHaveTextContent('Session abcdef12')

    await act(async () => {
      vi.advanceTimersByTime(5_999)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stacks multiple toasts newest-on-top', async () => {
    await renderToast()
    await emitCreated({ id: 'n1', labelText: 'First label' })
    await emitCreated({ id: 'n2', labelText: 'Second label' })

    const toasts = screen.getAllByRole('status')
    expect(toasts).toHaveLength(2)
    expect(within(toasts[0]!).getByText('Second label')).toBeInTheDocument()
    expect(within(toasts[1]!).getByText('First label')).toBeInTheDocument()
  })

  it('manual dismiss removes the toast immediately without touching read state', async () => {
    const user = userEvent.setup()
    await renderToast()
    await emitCreated({ id: 'n1' })

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(meshApi().notifications.markAllRead).not.toHaveBeenCalled()
    expect(meshApi().notifications.markRead).not.toHaveBeenCalled()
  })

  it('clicking the toast body marks the session read, jumps, and dismisses', async () => {
    const user = userEvent.setup()
    const { onJump } = await renderToast()
    await emitCreated({
      labelText: 'Agent is idle',
      encodedPath: '-Users-x-proj',
      sessionId: 'sess-1234-abcd',
      ptyId: 'pty-77'
    })

    await user.click(
      screen.getByRole('button', { name: 'Agent is idle — jump to session' })
    )

    expect(meshApi().notifications.markAllRead).toHaveBeenCalledWith({
      sessionId: 'sess-1234-abcd'
    })
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(onJump).toHaveBeenCalledWith({
      encodedPath: '-Users-x-proj',
      sessionId: 'sess-1234-abcd',
      ptyId: 'pty-77'
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not toast for rows that arrive without a created event (muted in main)', async () => {
    await renderToast()
    // A muted notification persists to SQLite and surfaces via list /
    // updated — but main suppresses `notifications:created`, which is
    // the only channel the toast renders from.
    meshApi().notifications.list.mockResolvedValue([buildNotification({ id: 'muted-row' })])
    await act(async () => {
      meshEmit().notificationsUpdated({ ids: ['muted-row'] })
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // --- v9: per-kind presentation ------------------------------------------

  it('tags the toast with its kind so kind-specific styling can apply', async () => {
    await renderToast()
    await emitCreated({ kind: 'approval', labelText: 'Approval needed' })
    expect(screen.getByRole('status')).toHaveAttribute('data-kind', 'approval')
  })

  it('keeps an approval toast sticky — no auto-dismiss even long past the idle timeout', async () => {
    await renderToast()
    vi.useFakeTimers()
    await emitCreated({ kind: 'approval', labelText: 'Approval needed' })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    // Still there — the user is blocked on it; it must not fade away.
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('auto-dismisses a complete toast (non-sticky) after the 6 s window', async () => {
    await renderToast()
    vi.useFakeTimers()
    await emitCreated({ kind: 'complete', labelText: 'Task complete' })
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears a sticky approval toast when it is marked read (the user answered)', async () => {
    await renderToast()
    await emitCreated({ id: 'appr-1', kind: 'approval', labelText: 'Approval needed' })
    expect(screen.getByRole('status')).toBeInTheDocument()
    // PTY resumed output → main auto-marks it read → notifications:updated.
    await act(async () => {
      meshEmit().notificationsUpdated({ ids: ['appr-1'] })
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
