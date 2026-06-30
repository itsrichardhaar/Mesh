import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import type { JumpToSessionInput } from './components/NotificationsBell'
import { NotificationToast } from './components/NotificationToast'
import { TopBar } from './components/TopBar'
import { useFileTreeCollapsed } from './hooks/useFileTreeCollapsed'
import { LiveSessionsProvider } from './hooks/useLiveSessions'
import { NotificationsProvider } from './hooks/useNotifications'
import { useProjectsSidebarCollapsed } from './hooks/useProjectsSidebarCollapsed'
import { HomeScreen } from './screens/HomeScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { WorkspaceScreen, type PendingJump } from './screens/WorkspaceScreen'
import { ThemeProvider } from './theme/ThemeProvider'
import { UiModeProvider } from './theme/UiModeProvider'

type Screen = 'home' | 'settings' | 'workspace'
type NonSettingsScreen = Exclude<Screen, 'settings'>

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  const [workspaceProject, setWorkspaceProject] = useState<Project | null>(null)
  // Selected Project on the Home Screen. `null` means "show cards view";
  // a value means "show that project's Analysis detail." Lifted from
  // HomeScreen so `goHome` can clear it when invoked from the top bar.
  const [homeSelection, setHomeSelection] = useState<string | null>(null)
  // `previousScreen` is whatever non-Settings screen was active when
  // Settings opened — that's where Esc / ⌘W returns us to.
  const previousScreen = useRef<NonSettingsScreen>('home')

  // v5 / Slice 42: one-shot "land on this session's tab" instruction
  // sent from a notification's Jump button. WorkspaceScreen consumes
  // it via an effect keyed by `key` so consecutive jumps to the same
  // session still trigger reactivation.
  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null)

  // Sidebar collapse state — lifted here so the top-bar sidebar-toggle
  // button can target whichever sidebar belongs to the active screen.
  // Home Screen's projects sidebar and Workspace's files sidebar each
  // persist their state under their own settings key.
  const projects = useProjectsSidebarCollapsed()
  const files = useFileTreeCollapsed()
  const onToggleSidebar = useCallback(() => {
    if (screen === 'workspace') {
      files.toggle()
    } else if (screen === 'home') {
      projects.toggle()
    }
    // Settings has no sidebar; the toggle is hidden in that state.
  }, [screen, files, projects])

  const openSettings = useCallback(() => {
    setScreen((current) => {
      if (current !== 'settings') previousScreen.current = current as NonSettingsScreen
      return 'settings'
    })
  }, [])

  const closeSettings = useCallback(() => {
    setScreen(previousScreen.current)
  }, [])

  /**
   * Gear icon in the top bar — opens Settings from any other screen,
   * or closes Settings if it's already open. Single affordance, two
   * directions; replaces the in-Settings "Close" button.
   */
  const toggleSettings = useCallback(() => {
    setScreen((current) => {
      if (current === 'settings') return previousScreen.current
      previousScreen.current = current as NonSettingsScreen
      return 'settings'
    })
  }, [])

  const openWorkspace = useCallback((project: Project) => {
    setWorkspaceProject(project)
    setScreen('workspace')
  }, [])

  const goHome = useCallback(() => {
    setScreen('home')
    setHomeSelection(null)
  }, [])

  // v5 / Slice 42: Jump-to-session resolves the notification's Project,
  // opens its Workspace, and sets a one-shot pendingJump so the
  // WorkspaceScreen activates the matching Pty Tab (or selects the
  // Session row when the PTY no longer exists). Resolution is async —
  // we re-fetch the Project list because the notification only stores
  // `encodedPath`, not the full Project shape.
  const jumpToSession = useCallback(async (input: JumpToSessionInput): Promise<void> => {
    let project: Project | null = workspaceProject?.encodedPath === input.encodedPath ? workspaceProject : null
    if (!project) {
      const all = await window.api.projects.list()
      project = all.find((p) => p.encodedPath === input.encodedPath) ?? null
    }
    if (!project) return
    setWorkspaceProject(project)
    setScreen('workspace')
    setPendingJump({
      sessionId: input.sessionId,
      ptyId: input.ptyId,
      encodedPath: input.encodedPath,
      key: Date.now()
    })
  }, [workspaceProject])

  const onPendingJumpConsumed = useCallback(() => {
    setPendingJump(null)
  }, [])

  useEffect(() => {
    const offOpen = window.api.menu.onOpenSettings(() => openSettings())
    return offOpen
  }, [openSettings])

  useEffect(() => {
    const offClose = window.api.menu.onCloseRequested(() => {
      if (screen === 'settings') {
        closeSettings()
      } else {
        window.api.window.close()
      }
    })
    return offClose
  }, [screen, closeSettings])

  // ⌘[ "Back" is overloaded: from Settings, close it; from Workspace,
  // return to Home; otherwise no-op so the accelerator is harmless.
  useEffect(() => {
    const offBack = window.api.menu.onBack(() => {
      if (screen === 'settings') {
        closeSettings()
      } else if (screen === 'workspace') {
        goHome()
      }
    })
    return offBack
  }, [screen, closeSettings, goHome])

  const sidebarToggleState: 'open' | 'closed' | null =
    screen === 'home'
      ? projects.collapsed
        ? 'closed'
        : 'open'
      : screen === 'workspace'
        ? files.collapsed
          ? 'closed'
          : 'open'
        : null

  return (
    <ThemeProvider>
      <UiModeProvider>
        <LiveSessionsProvider>
          <NotificationsProvider>
            <div className="app-shell">
              <TopBar
                onToggleSettings={toggleSettings}
                settingsOpen={screen === 'settings'}
                onToggleSidebar={onToggleSidebar}
                sidebarState={sidebarToggleState}
                onJumpToSession={jumpToSession}
              />
              <NotificationToast onJumpToSession={jumpToSession} />
              <div className="app-screens">
                <div hidden={screen !== 'home'}>
                  <HomeScreen
                    onOpenWorkspace={openWorkspace}
                    onOpenSettings={openSettings}
                    selectedEncodedPath={homeSelection}
                    onSelect={setHomeSelection}
                    sidebarCollapsed={projects.collapsed}
                  />
                </div>
                {workspaceProject && (
                  <WorkspaceScreen
                    key={workspaceProject.encodedPath}
                    project={workspaceProject}
                    visible={screen === 'workspace'}
                    onBack={goHome}
                    treeCollapsed={files.collapsed}
                    pendingJump={
                      pendingJump && pendingJump.encodedPath === workspaceProject.encodedPath
                        ? pendingJump
                        : null
                    }
                    onPendingJumpConsumed={onPendingJumpConsumed}
                  />
                )}
                {screen === 'settings' && <SettingsScreen onClose={closeSettings} />}
              </div>
            </div>
          </NotificationsProvider>
        </LiveSessionsProvider>
      </UiModeProvider>
    </ThemeProvider>
  )
}
