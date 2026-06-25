import { useCallback, useEffect, useRef, useState } from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { SettingsScreen } from './screens/SettingsScreen'

/**
 * Top-level screens. Settings is a *screen*, not a modal — the previous
 * screen stays mounted underneath so its state (selected Project, scroll
 * position, future Pty Tabs) survives a Settings round-trip.
 */
type Screen = 'home' | 'settings'
type NonSettingsScreen = Exclude<Screen, 'settings'>

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  // `previousScreen` is whatever non-Settings screen was active when
  // Settings opened — that's where Esc / ⌘W returns us to.
  const previousScreen = useRef<NonSettingsScreen>('home')

  const openSettings = useCallback(() => {
    setScreen((current) => {
      if (current !== 'settings') previousScreen.current = current
      return 'settings'
    })
  }, [])

  const closeSettings = useCallback(() => {
    setScreen(previousScreen.current)
  }, [])

  useEffect(() => {
    const offOpen = window.api.menu.onOpenSettings(() => openSettings())
    return offOpen
  }, [openSettings])

  // ⌘W is overloaded: close Settings if it's open, otherwise hand off
  // to main so the window hides like the red-X does.
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

  return (
    <>
      <div hidden={screen !== 'home'}>
        <HomeScreen />
      </div>
      {screen === 'settings' && <SettingsScreen onClose={closeSettings} />}
    </>
  )
}
