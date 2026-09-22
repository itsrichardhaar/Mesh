import type { Project } from '@shared/types'
import { createNavigationStore, type NavigationStore } from '@renderer/state/navigation'

/**
 * Slice 47: the navigation store's state machine, tested framework-free
 * (ADR-0007's vanilla-store payoff — same style as the main process's
 * injectable-dependency tests). No DOM, no React: actions in, snapshots
 * out.
 */

function project(encodedPath: string): Project {
  return {
    encodedPath,
    sourcePath: `/Users/x/${encodedPath}`,
    name: encodedPath,
    autoSubtitle: null,
    activity: '2026-07-07T12:00:00.000Z',
    sourceMissing: false,
    hidden: false,
    muteNotifications: false,
    kind: 'project',
    subtype: null,
    parentEncodedPath: null,
    gate: null
  }
}

const PROJ_A = project('-proj-a')
const PROJ_B = project('-proj-b')

function makeStore(projects: Project[] = [PROJ_A, PROJ_B]): {
  store: NavigationStore
  listProjects: ReturnType<typeof vi.fn>
} {
  const listProjects = vi.fn(async () => projects)
  return { store: createNavigationStore({ listProjects }), listProjects }
}

describe('navigation store — screens', () => {
  it('starts on the Home Screen with nothing selected', () => {
    const { store } = makeStore()
    const s = store.getState()
    expect(s.screen).toBe('home')
    expect(s.workspaceProject).toBeNull()
    expect(s.homeSelection).toBeNull()
    expect(s.pendingJump).toBeNull()
  })

  it('openWorkspace shows the Workspace for that Project', () => {
    const { store } = makeStore()
    store.getState().openWorkspace(PROJ_A)
    expect(store.getState().screen).toBe('workspace')
    expect(store.getState().workspaceProject).toEqual(PROJ_A)
  })

  it('goHome returns to Home and clears the Home selection', () => {
    const { store } = makeStore()
    store.getState().selectHome('-proj-a')
    store.getState().openWorkspace(PROJ_A)

    store.getState().goHome()

    expect(store.getState().screen).toBe('home')
    expect(store.getState().homeSelection).toBeNull()
    // The open Workspace itself survives — hidden, not discarded.
    expect(store.getState().workspaceProject).toEqual(PROJ_A)
  })

  it('selectHome drives the cards-vs-detail split', () => {
    const { store } = makeStore()
    store.getState().selectHome('-proj-b')
    expect(store.getState().homeSelection).toBe('-proj-b')
    store.getState().selectHome(null)
    expect(store.getState().homeSelection).toBeNull()
  })
})

describe('navigation store — Settings round-trips', () => {
  it('closeSettings returns to the screen Settings was opened from', () => {
    const { store } = makeStore()
    store.getState().openWorkspace(PROJ_A)

    store.getState().openSettings()
    expect(store.getState().screen).toBe('settings')

    store.getState().closeSettings()
    expect(store.getState().screen).toBe('workspace')
  })

  it('openSettings while already open does not clobber previousScreen', () => {
    const { store } = makeStore()
    store.getState().openSettings() // from home
    store.getState().openSettings() // no-op — e.g. menu accelerator repeat
    store.getState().closeSettings()
    expect(store.getState().screen).toBe('home')
  })

  it('toggleSettings opens from any screen and closes back to it', () => {
    const { store } = makeStore()
    store.getState().openWorkspace(PROJ_A)

    store.getState().toggleSettings()
    expect(store.getState().screen).toBe('settings')
    store.getState().toggleSettings()
    expect(store.getState().screen).toBe('workspace')
  })

  it('closeSettings outside Settings is a harmless no-op', () => {
    const { store } = makeStore()
    store.getState().closeSettings()
    expect(store.getState().screen).toBe('home')
  })
})

describe('navigation store — jumpToSession', () => {
  const JUMP = { encodedPath: '-proj-a', sessionId: 'sess-1', ptyId: 'pty-1' }

  it('skips the Project re-fetch when the target Workspace is already open', async () => {
    const { store, listProjects } = makeStore()
    store.getState().openWorkspace(PROJ_A)

    await store.getState().jumpToSession(JUMP)

    expect(listProjects).not.toHaveBeenCalled()
    expect(store.getState().screen).toBe('workspace')
    expect(store.getState().pendingJump).toMatchObject({
      encodedPath: '-proj-a',
      sessionId: 'sess-1',
      ptyId: 'pty-1'
    })
  })

  it('resolves an unfamiliar target through the Project list', async () => {
    const { store, listProjects } = makeStore()
    store.getState().openWorkspace(PROJ_B)

    await store.getState().jumpToSession(JUMP)

    expect(listProjects).toHaveBeenCalledTimes(1)
    expect(store.getState().workspaceProject).toEqual(PROJ_A)
    expect(store.getState().screen).toBe('workspace')
  })

  it('is a no-op for a Project that no longer exists', async () => {
    const { store, listProjects } = makeStore([PROJ_B])

    await store.getState().jumpToSession(JUMP)

    expect(listProjects).toHaveBeenCalledTimes(1)
    expect(store.getState().screen).toBe('home')
    expect(store.getState().workspaceProject).toBeNull()
    expect(store.getState().pendingJump).toBeNull()
  })

  it('issues strictly-increasing keys so repeat jumps re-trigger', async () => {
    const { store } = makeStore()
    store.getState().openWorkspace(PROJ_A)

    await store.getState().jumpToSession(JUMP)
    const first = store.getState().pendingJump!.key
    store.getState().consumePendingJump()

    await store.getState().jumpToSession(JUMP)
    const second = store.getState().pendingJump!.key

    expect(second).toBeGreaterThan(first)
  })

  it('consumePendingJump clears the one-shot without touching navigation', async () => {
    const { store } = makeStore()
    store.getState().openWorkspace(PROJ_A)
    await store.getState().jumpToSession(JUMP)

    store.getState().consumePendingJump()

    expect(store.getState().pendingJump).toBeNull()
    expect(store.getState().screen).toBe('workspace')
    expect(store.getState().workspaceProject).toEqual(PROJ_A)
  })
})
