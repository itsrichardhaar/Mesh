import { act, render, screen } from '@testing-library/react'
import { NotificationsProvider, useNotifications } from '@renderer/hooks/useNotifications'
import { buildNotification, meshApi, meshEmit } from './test-utils'

/**
 * Slice 46: the notifications cache stays in sync with main across the
 * event channels. The renderer is a cache over main's authoritative
 * SQLite — every lifecycle event triggers a re-fetch rather than an
 * optimistic local update, so these tests always change the `list`
 * mock BEFORE emitting the event that should pick it up.
 */

function Probe(): JSX.Element {
  const { notifications, unreadCount, globalMute } = useNotifications()
  return (
    <output aria-label="notifications state">
      {`total:${notifications.length} unread:${unreadCount} mute:${String(globalMute)}`}
    </output>
  )
}

function renderProbe(): void {
  render(
    <NotificationsProvider>
      <Probe />
    </NotificationsProvider>
  )
}

const state = (): HTMLElement => screen.getByLabelText('notifications state')

describe('useNotifications cache sync', () => {
  it('loads the list and global mute from main on mount', async () => {
    meshApi().notifications.list.mockResolvedValue([
      buildNotification({ id: 'n1', readAt: null }),
      buildNotification({ id: 'n2', readAt: '2026-07-07T12:01:00.000Z' })
    ])
    meshApi().notifications.getGlobalMute.mockResolvedValue(true)

    renderProbe()

    expect(await screen.findByText('total:2 unread:1 mute:true')).toBeInTheDocument()
  })

  it('re-fetches on notifications:created', async () => {
    renderProbe()
    expect(await screen.findByText('total:0 unread:0 mute:false')).toBeInTheDocument()

    meshApi().notifications.list.mockResolvedValue([buildNotification({ id: 'n1' })])
    await act(async () => {
      meshEmit().notificationCreated(buildNotification({ id: 'n1' }))
    })

    expect(state()).toHaveTextContent('total:1 unread:1')
  })

  it('re-fetches on notifications:updated', async () => {
    meshApi().notifications.list.mockResolvedValue([buildNotification({ id: 'n1', readAt: null })])
    renderProbe()
    expect(await screen.findByText('total:1 unread:1 mute:false')).toBeInTheDocument()

    meshApi().notifications.list.mockResolvedValue([
      buildNotification({ id: 'n1', readAt: '2026-07-07T12:02:00.000Z' })
    ])
    await act(async () => {
      meshEmit().notificationsUpdated({ ids: ['n1'] })
    })

    expect(state()).toHaveTextContent('total:1 unread:0')
  })

  it('re-fetches on notifications:cleared', async () => {
    meshApi().notifications.list.mockResolvedValue([buildNotification({ id: 'n1' })])
    renderProbe()
    expect(await screen.findByText('total:1 unread:1 mute:false')).toBeInTheDocument()

    meshApi().notifications.list.mockResolvedValue([])
    await act(async () => {
      meshEmit().notificationsCleared({ encodedPath: null })
    })

    expect(state()).toHaveTextContent('total:0 unread:0')
  })

  it('tracks global mute via notifications:mute-changed without a re-fetch', async () => {
    renderProbe()
    expect(await screen.findByText('total:0 unread:0 mute:false')).toBeInTheDocument()

    await act(async () => {
      meshEmit().muteChanged({ scope: 'global', value: true })
    })
    expect(state()).toHaveTextContent('mute:true')

    // Per-Project mute changes are carried on Project objects, not here.
    await act(async () => {
      meshEmit().muteChanged({ scope: 'project', encodedPath: '-x', value: true })
    })
    expect(state()).toHaveTextContent('mute:true')
  })

  it('setGlobalMute writes through the IPC; state follows the echo event', async () => {
    function MuteToggle(): JSX.Element {
      const { globalMute, setGlobalMute } = useNotifications()
      return (
        <button type="button" onClick={() => void setGlobalMute(!globalMute)}>
          toggle mute
        </button>
      )
    }
    render(
      <NotificationsProvider>
        <Probe />
        <MuteToggle />
      </NotificationsProvider>
    )
    expect(await screen.findByText('total:0 unread:0 mute:false')).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'toggle mute' }).click()
    })
    expect(meshApi().notifications.setGlobalMute).toHaveBeenCalledWith(true)
    // No optimistic flip — state waits for main's echo.
    expect(state()).toHaveTextContent('mute:false')

    await act(async () => {
      meshEmit().muteChanged({ scope: 'global', value: true })
    })
    expect(state()).toHaveTextContent('mute:true')
  })
})
