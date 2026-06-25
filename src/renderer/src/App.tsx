import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { HomeScreen } from './screens/HomeScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import { ThemeProvider } from './theme/ThemeProvider'

type Screen = 'home' | 'settings' | 'workspace'
type NonSettingsScreen = Exclude<Screen, 'settings'>

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  const [workspaceProject, setWorkspaceProject] = useState<Project | null>(null)
  // `previousScreen` is whatever non-Settings screen was active when
  // Settings opened — that's where Esc / ⌘W returns us to.
  const previousScreen = useRef<NonSettingsScreen>('home')

  const openSettings = useCallback(() => {
    setScreen((current) => {
      if (current !== 'settings') previousScreen.current = current as NonSettingsScreen
      return 'settings'
    })
  }, [])

  const closeSettings = useCallback(() => {
    setScreen(previousScreen.current)
  }, [])

  const openWorkspace = useCallback((project: Project) => {
    setWorkspaceProject(project)
    setScreen('workspace')
  }, [])

  const goHome = useCallback(() => {
    setScreen('home')
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

  return (
    <ThemeProvider>
      <div hidden={screen !== 'home'}>
        <HomeScreen onOpenWorkspace={openWorkspace} onOpenSettings={openSettings} />
      </div>
      {workspaceProject && (
        <WorkspaceScreen
          key={workspaceProject.encodedPath}
          project={workspaceProject}
          visible={screen === 'workspace'}
          onBack={goHome}
        />
      )}
      {screen === 'settings' && <SettingsScreen onClose={closeSettings} />}
    </ThemeProvider>
  )
}
