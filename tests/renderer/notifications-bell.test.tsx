import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Notification } from '@shared/types'
import { notificationKindToastKey } from '@shared/types'
import { NotificationsBell } from '@renderer/components/NotificationsBell'
import { NotificationsProvider } from '@renderer/hooks/useNotifications'
import { buildNotification, meshApi, meshEmit } from './test-utils'

/**
 * Slice 46: bell icon + dropdown. Seeds the provider's cache through
 * the `list` mock (the renderer paints the repository's ordering — it
 * never re-sorts), then drives everything through accessible queries.
 */

function seedList(rows: Notification[]): void {
  meshApi().notifications.list.mockResolvedValue(rows)
}

async function renderBell(onJump = vi.fn()): Promise<{
  onJump: ReturnType<typeof vi.fn>
  user: ReturnType<typeof userEvent.setup>
}> {
  const user = userEvent.setup()
  render(
    <NotificationsProvider>
      <NotificationsBell onJumpToSession={onJump} />
    </NotificationsProvider>
  )
  // The provider's initial fetch is async — settle before interacting.
  await act(async () => {})
  return { onJump, user }
}

describe('NotificationsBell — unread badge', () => {
  it('labels the bell with the unread count when unread rows exist', async () => {
    seedList([
      buildNotification({ id: 'n1', readAt: null }),
      buildNotification({ id: 'n2', readAt: null }),
      buildNotification({ id: 'n3', readAt: '2026-07-07T12:01:00.000Z' })
    ])
    await renderBell()

    expect(screen.getByRole('button', { name: '2 unread notifications' })).toBeInTheDocument()
  })

  it('drops the badge when everything is read', async () => {
    seedList([buildNotification({ id: 'n1', readAt: '2026-07-07T12:01:00.000Z' })])
    await renderBell()

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })
})

describe('NotificationsBell — dropdown', () => {
  it('opens on click, painting rows with label, session, and Jump action', async () => {
    seedList([
      buildNotification({ id: 'n1', labelText: 'Agent is idle', sessionId: 'abcd1234-ffff' })
    ])
    const { user } = await renderBell()

    await user.click(screen.getByRole('button', { name: '1 unread notifications' }))

    const dropdown = screen.getByRole('dialog', { name: 'Notifications' })
    expect(within(dropdown).getByText('Agent is idle')).toBeInTheDocument()
    expect(within(dropdown).getByText('Session abcd1234')).toBeInTheDocument()
    expect(within(dropdown).getByRole('button', { name: 'Jump to session' })).toBeInTheDocument()
  })

  it('tags each dropdown row with its kind for kind-specific icon/styling (v9)', async () => {
    seedList([
      buildNotification({ id: 'a1', kind: 'approval', labelText: 'Approval needed' }),
      buildNotification({ id: 'c1', kind: 'complete', labelText: 'Task complete' })
    ])
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: '2 unread notifications' }))

    const dropdown = screen.getByRole('dialog', { name: 'Notifications' })
    const rows = within(dropdown).getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('data-kind', 'approval')
    expect(rows[1]).toHaveAttribute('data-kind', 'complete')
    // Recency ordering is unchanged — rows paint in list (repository) order.
    expect(within(rows[0]!).getByText('Approval needed')).toBeInTheDocument()
  })

  it('shows the empty state when no notifications exist', async () => {
    const { user } = await renderBell()

    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
  })
})

describe('NotificationsBell — per-kind toast toggles (v9)', () => {
  it('renders a toggle per kind, all enabled by default', async () => {
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    const group = screen.getByRole('group', { name: 'Toast for' })
    const toggles = within(group).getAllByRole('button')
    expect(toggles).toHaveLength(3)
    for (const toggle of toggles) {
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('persists a kind toggle through the generic setting IPC', async () => {
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    const group = screen.getByRole('group', { name: 'Toast for' })
    await user.click(within(group).getByRole('button', { name: /Complete/ }))

    expect(meshApi().settings.set).toHaveBeenCalledWith(notificationKindToastKey('complete'), '0')
  })

  it('reflects a stored disabled kind as off', async () => {
    meshApi().settings.get.mockImplementation(async (key: string) =>
      key === notificationKindToastKey('idle') ? '0' : null
    )
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    const group = screen.getByRole('group', { name: 'Toast for' })
    expect(within(group).getByRole('button', { name: /Idle/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})

describe('NotificationsBell — header actions', () => {
  it('Mark all read is disabled at zero unread and calls the unscoped IPC otherwise', async () => {
    seedList([buildNotification({ id: 'n1', readAt: null })])
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: '1 unread notifications' }))

    const markAll = screen.getByRole('button', { name: 'Mark all read' })
    expect(markAll).toBeEnabled()
    await user.click(markAll)
    expect(meshApi().notifications.markAllRead).toHaveBeenCalledWith(undefined)
  })

  it('Mark all read and Clear all are disabled when there is nothing to act on', async () => {
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
  })

  it('Clear all calls the unscoped IPC when rows exist', async () => {
    seedList([buildNotification({ id: 'n1', readAt: '2026-07-07T12:01:00.000Z' })])
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(meshApi().notifications.clearAll).toHaveBeenCalledWith(undefined)
  })
})

describe('NotificationsBell — row actions', () => {
  it('unread rows carry a Mark-as-read action wired to markRead(id); read rows do not', async () => {
    seedList([
      buildNotification({ id: 'unread-1', readAt: null }),
      buildNotification({ id: 'read-1', readAt: '2026-07-07T12:01:00.000Z' })
    ])
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: '1 unread notifications' }))

    const dismissButtons = screen.getAllByRole('button', { name: 'Mark as read' })
    expect(dismissButtons).toHaveLength(1)

    await user.click(dismissButtons[0]!)
    expect(meshApi().notifications.markRead).toHaveBeenCalledWith('unread-1')
  })

  it('Jump marks the session read, forwards the payload, and closes the dropdown', async () => {
    seedList([
      buildNotification({
        id: 'n1',
        encodedPath: '-Users-x-proj',
        sessionId: 'sess-1234-abcd',
        ptyId: 'pty-9'
      })
    ])
    const { onJump, user } = await renderBell()
    await user.click(screen.getByRole('button', { name: '1 unread notifications' }))

    await user.click(screen.getByRole('button', { name: 'Jump to session' }))

    expect(meshApi().notifications.markAllRead).toHaveBeenCalledWith({
      sessionId: 'sess-1234-abcd'
    })
    expect(onJump).toHaveBeenCalledWith({
      encodedPath: '-Users-x-proj',
      sessionId: 'sess-1234-abcd',
      ptyId: 'pty-9'
    })
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
  })
})

describe('NotificationsBell — mute', () => {
  it('reflects muted state: title, banner, and an aria-pressed Resume action', async () => {
    meshApi().notifications.getGlobalMute.mockResolvedValue(true)
    const { user } = await renderBell()

    expect(screen.getByTitle('Notifications (muted)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(
      screen.getByText('Notifications are paused. New rows still appear here while muted.')
    ).toBeInTheDocument()

    const resume = screen.getByRole('button', { name: 'Resume' })
    expect(resume).toHaveAttribute('aria-pressed', 'true')

    await user.click(resume)
    expect(meshApi().notifications.setGlobalMute).toHaveBeenCalledWith(false)
  })

  it('Pause quick-action follows the mute-changed echo from main', async () => {
    const { user } = await renderBell()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(meshApi().notifications.setGlobalMute).toHaveBeenCalledWith(true)

    await act(async () => {
      meshEmit().muteChanged({ scope: 'global', value: true })
    })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('still shows the unread badge while muted so missed rows are discoverable', async () => {
    meshApi().notifications.getGlobalMute.mockResolvedValue(true)
    seedList([buildNotification({ id: 'n1', readAt: null })])
    await renderBell()

    expect(screen.getByRole('button', { name: '1 unread notifications' })).toBeInTheDocument()
    expect(screen.getByTitle('Notifications (muted)')).toBeInTheDocument()
  })
})
