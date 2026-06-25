import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

/**
 * Slice 5 establishes Settings as a screen with the navigation contract
 * (open with ⌘,, close with Esc or ⌘W, returns to the previous screen)
 * but no controls yet — the Appearance and Model sections are
 * placeholders that later slices populate.
 *
 * Esc is handled here at the screen level because it's not a menu
 * accelerator. ⌘W comes in over IPC via `menu:close-requested` and
 * is handled by `App` so the same handler can also close the window
 * when Settings isn't open.
 */
export function SettingsScreen({ onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-screen" role="dialog" aria-label="Settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <button
          type="button"
          className="settings-close"
          onClick={onClose}
          aria-label="Close settings"
        >
          Close
        </button>
      </header>

      <div className="settings-body">
        <SettingsSection title="Appearance" />
        <SettingsSection title="Model" />
      </div>
    </div>
  )
}

function SettingsSection({ title }: { title: string }): JSX.Element {
  return (
    <section className="settings-section" aria-label={title}>
      <h2>{title}</h2>
      <p className="settings-section-placeholder">Coming soon.</p>
    </section>
  )
}
