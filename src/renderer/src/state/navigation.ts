import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Project } from '@shared/types'
import type { JumpToSessionInput } from '../components/NotificationsBell'
import type { PendingJump } from '../screens/WorkspaceScreen'

export type Screen = 'home' | 'settings' | 'workspace'
export type NonSettingsScreen = Exclude<Screen, 'settings'>

/**
 * App-level navigation state (Slice 47 / v6, ADR-0007). Everything
 * `App.tsx` used to hold as component-local state: which screen is
 * active, which Project's Workspace is open, the Home Screen
 * selection, where Esc/⌘W returns from Settings, and the one-shot
 * Jump-to-session instruction.
 *
 * Vanilla store — framework-free and unit-testable without a DOM,
 * matching the main process's injectable-dependency convention. The
 * React binding lives in `hooks/useNavigation.ts`.
 */
export interface NavigationState {
  screen: Screen
  workspaceProject: Project | null
  /**
   * Selected Project on the Home Screen. `null` means "show cards
   * view"; a value means "show that project's Analysis detail."
   */
  homeSelection: string | null
  /**
   * Whatever non-Settings screen was active when Settings opened —
   * that's where Esc / ⌘W / gear-toggle returns to.
   */
  previousScreen: NonSettingsScreen
  /**
   * v5 / Slice 42: one-shot "land on this session's tab" instruction
   * from a notification's Jump button. WorkspaceScreen consumes it via
   * an effect keyed by `key` so consecutive jumps to the same session
   * still trigger.
   */
  pendingJump: PendingJump | null

  openSettings: () => void
  closeSettings: () => void
  /**
   * Gear icon in the top bar — opens Settings from any other screen,
   * or closes Settings if it's already open.
   */
  toggleSettings: () => void
  openWorkspace: (project: Project) => void
  goHome: () => void
  selectHome: (encodedPath: string | null) => void
  /**
   * Resolve a notification's Project, open its Workspace, and set the
   * one-shot pendingJump. Resolution is async — the notification only
   * stores `encodedPath`, so an unfamiliar target re-fetches the
   * Project list. Unknown targets are a no-op.
   */
  jumpToSession: (input: JumpToSessionInput) => Promise<void>
  consumePendingJump: () => void
}

export interface NavigationDeps {
  /** Production: `() => window.api.projects.list()`. Tests inject a fake. */
  listProjects: () => Promise<Project[]>
}

export type NavigationStore = StoreApi<NavigationState>

export function createNavigationStore(deps: NavigationDeps): NavigationStore {
  // Monotonic pendingJump key so duplicate jumps to the same session
  // still re-fire the consuming effect.
  let nextJumpKey = 0

  return createStore<NavigationState>()((set, get) => ({
    screen: 'home',
    workspaceProject: null,
    homeSelection: null,
    previousScreen: 'home',
    pendingJump: null,

    openSettings: () => {
      set((s) =>
        s.screen === 'settings'
          ? s
          : { screen: 'settings', previousScreen: s.screen as NonSettingsScreen }
      )
    },

    closeSettings: () => {
      set((s) => (s.screen === 'settings' ? { screen: s.previousScreen } : s))
    },

    toggleSettings: () => {
      set((s) =>
        s.screen === 'settings'
          ? { screen: s.previousScreen }
          : { screen: 'settings', previousScreen: s.screen as NonSettingsScreen }
      )
    },

    openWorkspace: (project) => {
      set({ workspaceProject: project, screen: 'workspace' })
    },

    goHome: () => {
      set({ screen: 'home', homeSelection: null })
    },

    selectHome: (encodedPath) => {
      set({ homeSelection: encodedPath })
    },

    jumpToSession: async (input) => {
      const current = get().workspaceProject
      let project: Project | null =
        current?.encodedPath === input.encodedPath ? current : null
      if (!project) {
        const all = await deps.listProjects()
        project = all.find((p) => p.encodedPath === input.encodedPath) ?? null
      }
      if (!project) return
      nextJumpKey += 1
      set({
        workspaceProject: project,
        screen: 'workspace',
        pendingJump: {
          sessionId: input.sessionId,
          ptyId: input.ptyId,
          encodedPath: input.encodedPath,
          key: nextJumpKey
        }
      })
    },

    consumePendingJump: () => {
      set({ pendingJump: null })
    }
  }))
}
