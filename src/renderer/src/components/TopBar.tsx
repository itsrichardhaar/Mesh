import { Moon, Settings, Sun } from 'lucide-react'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  onGoHome: () => void
  onOpenSettings: () => void
}

/**
 * App-wide top chrome (Slice 21). Single drag region across the window;
 * interactive children opt out via `-webkit-app-region: no-drag`. Replaces
 * the v1 floating Settings gear and per-screen drag strips.
 *
 * The traffic-light spacer reserves room for macOS's hiddenInset window
 * controls. On other platforms the spacer is empty and harmless.
 */
export function TopBar({ onGoHome, onOpenSettings }: Props): JSX.Element {
  const { effective, setPreference } = useTheme()
  const toggleTheme = (): void => {
    // Binary flip — top-bar toggle always pins to an explicit value.
    // System remains selectable from Settings (the tri-state lives there).
    setPreference(effective === 'dark' ? 'light' : 'dark')
  }

  return (
    <header className="top-bar" aria-label="App chrome">
      <div className="top-bar-traffic-lights" aria-hidden="true" />
      <button
        type="button"
        className="top-bar-home"
        onClick={onGoHome}
        aria-label="Mesh — go to home"
        title="Home"
      >
        <img className="top-bar-icon" src="/icon.png" alt="" width={20} height={20} />
        <span className="top-bar-wordmark">Mesh</span>
      </button>
      <div className="top-bar-spacer" />
      <button
        type="button"
        className="top-bar-action"
        onClick={toggleTheme}
        aria-label={effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={effective === 'dark' ? 'Switch to light' : 'Switch to dark'}
      >
        {effective === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button
        type="button"
        className="top-bar-action"
        onClick={onOpenSettings}
        aria-label="Open Settings"
        title="Settings (⌘,)"
      >
        <Settings size={16} />
      </button>
    </header>
  )
}
