import { Moon, PanelLeft, PanelLeftClose, Settings, Sun } from 'lucide-react'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  onOpenSettings: () => void
  /** Toggle the active screen's sidebar (Home → projects; Workspace → files). */
  onToggleSidebar: () => void
  /**
   * Current sidebar state for the active screen. `null` when no sidebar
   * applies (Settings) — the toggle button is hidden in that case.
   */
  sidebarState: 'open' | 'closed' | null
}

/**
 * App-wide top chrome (Slice 21). Single drag region across the window;
 * interactive children opt out via `-webkit-app-region: no-drag`. Replaces
 * the v1 floating Settings gear and per-screen drag strips.
 *
 * The traffic-light spacer reserves room for macOS's hiddenInset window
 * controls. On other platforms the spacer is empty and harmless.
 *
 * The left-most action — formerly a Mesh wordmark + "go home" button —
 * is now a sidebar toggle. It targets the active screen's sidebar
 * (projects on Home, files on Workspace) and is hidden in Settings.
 * Back-to-home navigation lives on the in-view "‹ Home" buttons in
 * ProjectDetail and WorkspaceScreen.
 */
export function TopBar({ onOpenSettings, onToggleSidebar, sidebarState }: Props): JSX.Element {
  const { effective, setPreference } = useTheme()
  const toggleTheme = (): void => {
    // Binary flip — top-bar toggle always pins to an explicit value.
    // System remains selectable from Settings (the tri-state lives there).
    setPreference(effective === 'dark' ? 'light' : 'dark')
  }

  const sidebarOpen = sidebarState === 'open'
  const SidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeft
  const sidebarLabel = sidebarOpen ? 'Hide sidebar' : 'Show sidebar'

  return (
    <header className="top-bar" aria-label="App chrome">
      <div className="top-bar-traffic-lights" aria-hidden="true" />
      {sidebarState !== null && (
        <button
          type="button"
          className="top-bar-action"
          onClick={onToggleSidebar}
          aria-label={sidebarLabel}
          aria-pressed={sidebarOpen}
          title={sidebarLabel}
        >
          <SidebarIcon size={16} />
        </button>
      )}
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
