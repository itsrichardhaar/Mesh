import { useCallback, useEffect } from 'react'
import { NotificationToast } from './components/NotificationToast'
import { PtyHost } from './components/PtyHost'
import { TopBar } from './components/TopBar'
import { useFileTreeCollapsed } from './hooks/useFileTreeCollapsed'
import { LiveSessionsProvider } from './hooks/useLiveSessions'
import { useNavigation } from './hooks/useNavigation'
import { NotificationsProvider } from './hooks/useNotifications'
import { useProjectsSidebarCollapsed } from './hooks/useProjectsSidebarCollapsed'
import { QuotaProvider } from './hooks/useQuota'
import { UsageProvider } from './hooks/useUsage'
import { HomeScreen } from './screens/HomeScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import { ThemeProvider } from './theme/ThemeProvider'
import { UiModeProvider } from './theme/UiModeProvider'

/**
 * Composition root. Navigation state (screen, open Workspace,
 * Home selection, one-shot Jump-to-session) lives in the Zustand
 * navigation store (Slice 47 / v6, ADR-0007) — App wires screens,
 * providers, and menu accelerators to it.
 */
export function App(): JSX.Element {
  const screen = useNavigation((s) => s.screen)
  const workspaceProject = useNavigation((s) => s.workspaceProject)
  const homeSelection = useNavigation((s) => s.homeSelection)
  const pendingJump = useNavigation((s) => s.pendingJump)
  const openSettings = useNavigation((s) => s.openSettings)
  const closeSettings = useNavigation((s) => s.closeSettings)
  const toggleSettings = useNavigation((s) => s.toggleSettings)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const goHome = useNavigation((s) => s.goHome)
  const selectHome = useNavigation((s) => s.selectHome)
  const jumpToSession = useNavigation((s) => s.jumpToSession)
  const consumePendingJump = useNavigation((s) => s.consumePendingJump)

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
            <QuotaProvider>
            <UsageProvider>
            <div className="app-shell">
              <TopBar
                onToggleSettings={toggleSettings}
                settingsOpen={screen === 'settings'}
                onToggleSidebar={onToggleSidebar}
                sidebarState={sidebarToggleState}
                onJumpToSession={jumpToSession}
              />
              <NotificationToast onJumpToSession={jumpToSession} />
              {/* Slice 49: owns every live PtyView for the renderer's
                  lifetime; the visible Workspace's PTY pane borrows the
                  active one via the pty-host store. */}
              <PtyHost />
              <div className="app-screens">
                <div hidden={screen !== 'home'}>
                  <HomeScreen
                    onOpenWorkspace={openWorkspace}
                    onOpenSettings={openSettings}
                    selectedEncodedPath={homeSelection}
                    onSelect={selectHome}
                    sidebarCollapsed={projects.collapsed}
                    onJumpToSession={jumpToSession}
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
                    onPendingJumpConsumed={consumePendingJump}
                  />
                )}
                {screen === 'settings' && <SettingsScreen onClose={closeSettings} />}
              </div>
            </div>
            </UsageProvider>
            </QuotaProvider>
          </NotificationsProvider>
        </LiveSessionsProvider>
      </UiModeProvider>
    </ThemeProvider>
  )
}
