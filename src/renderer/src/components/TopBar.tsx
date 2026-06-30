import { Moon, PanelLeft, Settings, Sun } from 'lucide-react'
import type { JumpToSessionInput } from './NotificationsBell'
import { NotificationsBell } from './NotificationsBell'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  /** Gear button — opens Settings from any other screen; closes Settings when already open. */
  onToggleSettings: () => void
  settingsOpen: boolean
  /** Toggle the active screen's sidebar (Home → projects; Workspace → files). */
  onToggleSidebar: () => void
  /**
   * Current sidebar state for the active screen. `null` when no sidebar
   * applies (Settings) — the toggle button is hidden in that case.
   */
  sidebarState: 'open' | 'closed' | null
  /** v5 / Slice 42: passed through to `<NotificationsBell>` for "Jump to session" rows. */
  onJumpToSession: (input: JumpToSessionInput) => Promise<void> | void
}

/**
 * App-wide top chrome (Slice 21). Single drag region across the window;
 * interactive children opt out via `-webkit-app-region: no-drag`. Replaces
 * the v1 floating Settings gear and per-screen drag strips.
 *
 * The traffic-light spacer reserves room for macOS's hiddenInset window
 * controls. On other platforms the spacer is empty and harmless.
 *
 * The left-most action is a sidebar toggle targeting whichever sidebar
 * belongs to the active screen (projects on Home, files on Workspace,
 * hidden in Settings). Back-to-Home navigation lives on the in-view
 * `‹ Home` buttons in `ProjectDetail` and `WorkspaceScreen`.
 *
 * The gear button toggles Settings in both directions — open from any
 * other screen, close when Settings is already open. Replaces the
 * in-Settings "Close" button.
 */
export function TopBar({
  onToggleSettings,
  settingsOpen,
  onToggleSidebar,
  sidebarState,
  onJumpToSession
}: Props): JSX.Element {
  const { effective, setPreference } = useTheme()
  const toggleTheme = (): void => {
    // Binary flip — top-bar toggle always pins to an explicit value.
    // System remains selectable from Settings (the tri-state lives there).
    setPreference(effective === 'dark' ? 'light' : 'dark')
  }

  const sidebarOpen = sidebarState === 'open'
  const sidebarLabel = sidebarOpen ? 'Hide sidebar' : 'Show sidebar'
  const settingsLabel = settingsOpen ? 'Close Settings' : 'Open Settings'

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
          <PanelLeft size={16} />
        </button>
      )}
      <div className="top-bar-spacer" />
      <NotificationsBell onJumpToSession={onJumpToSession} />
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
        className={`top-bar-action${settingsOpen ? ' top-bar-action-active' : ''}`}
        onClick={onToggleSettings}
        aria-label={settingsLabel}
        aria-pressed={settingsOpen}
        title={`Settings (⌘,)`}
      >
        <Settings size={16} />
      </button>
    </header>
  )
}
