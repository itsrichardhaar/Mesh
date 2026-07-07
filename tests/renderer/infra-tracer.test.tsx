import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { ModeTabs } from '@renderer/components/ModeTabs'
import { buildNotification, meshApi, meshEmit } from './test-utils'

/**
 * Slice 45 tracer bullet: proves the full renderer test stack — jsdom
 * rendering, accessible queries, user-event interaction, and the typed
 * `window.api` fake with its event-channel emitters. Deliberately small;
 * Slice 46 is the real proving ground.
 */

describe('renderer harness: component rendering + user events', () => {
  it('renders ModeTabs with accessible tab semantics', () => {
    render(<ModeTabs mode="sessions" onChange={() => undefined} />)

    expect(screen.getByRole('tablist', { name: 'Workspace mode' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'File Editor' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('reports a Mode Tab change when the user clicks the inactive tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModeTabs mode="sessions" onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: 'File Editor' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('editor')
  })
})

/** Minimal consumer of a `window.api` event channel, for harness self-tests. */
function LatestNotificationProbe(): JSX.Element {
  const [label, setLabel] = useState('none yet')
  useEffect(() => window.api.notifications.onCreated((n) => setLabel(n.labelText)), [])
  return <output aria-label="latest notification">{label}</output>
}

describe('renderer harness: window.api fake', () => {
  it('delivers emitted events to subscribed components', () => {
    render(<LatestNotificationProbe />)
    expect(screen.getByLabelText('latest notification')).toHaveTextContent('none yet')

    act(() => {
      meshEmit().notificationCreated(buildNotification({ labelText: 'Agent is idle' }))
    })

    expect(screen.getByLabelText('latest notification')).toHaveTextContent('Agent is idle')
  })

  it('subscriptions return working unsubscribers', () => {
    const cb = vi.fn()
    const off = window.api.notifications.onCreated(cb)

    meshEmit().notificationCreated(buildNotification())
    expect(cb).toHaveBeenCalledTimes(1)

    off()
    meshEmit().notificationCreated(buildNotification())
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('api methods are per-test overridable vi.fn mocks', async () => {
    meshApi().notifications.getGlobalMute.mockResolvedValue(true)
    await expect(window.api.notifications.getGlobalMute()).resolves.toBe(true)
  })

  it('installs a fresh fake per test — the previous override does not leak', async () => {
    await expect(window.api.notifications.getGlobalMute()).resolves.toBe(false)
  })

  it('unstubbed rich methods reject with a message naming the override to write', async () => {
    await expect(window.api.pty.create({} as never)).rejects.toThrow(
      /window\.api\.pty\.create is not stubbed/
    )
  })
})
