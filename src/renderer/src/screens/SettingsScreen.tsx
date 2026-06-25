import { useEffect } from 'react'
import type { ThemePreference } from '@shared/types'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  onClose: () => void
}

/**
 * Slice 5 established Settings as a screen with the navigation contract;
 * Slice 6 fills in the Appearance section with three radio options that
 * drive `ThemeProvider`. Model placeholders stay until a later slice.
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
        <AppearanceSection />
        <PlaceholderSection title="Model" />
      </div>
    </div>
  )
}

function AppearanceSection(): JSX.Element {
  const { preference, setPreference, ready } = useTheme()

  return (
    <section className="settings-section" aria-label="Appearance">
      <h2>Appearance</h2>
      <fieldset className="theme-options" disabled={!ready}>
        <legend className="visually-hidden">Theme</legend>
        <ThemeOption
          value="system"
          label="Follow system"
          description="Match macOS Light or Dark mode automatically."
          checked={preference === 'system'}
          onChange={setPreference}
        />
        <ThemeOption
          value="light"
          label="Light"
          description="Always use the light palette."
          checked={preference === 'light'}
          onChange={setPreference}
        />
        <ThemeOption
          value="dark"
          label="Dark"
          description="Always use the dark palette."
          checked={preference === 'dark'}
          onChange={setPreference}
        />
      </fieldset>
    </section>
  )
}

function ThemeOption({
  value,
  label,
  description,
  checked,
  onChange
}: {
  value: ThemePreference
  label: string
  description: string
  checked: boolean
  onChange: (next: ThemePreference) => void
}): JSX.Element {
  return (
    <label className={`theme-option${checked ? ' theme-option-checked' : ''}`}>
      <input
        type="radio"
        name="theme"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className="theme-option-text">
        <span className="theme-option-label">{label}</span>
        <span className="theme-option-description">{description}</span>
      </span>
    </label>
  )
}

function PlaceholderSection({ title }: { title: string }): JSX.Element {
  return (
    <section className="settings-section" aria-label={title}>
      <h2>{title}</h2>
      <p className="settings-section-placeholder">Coming soon.</p>
    </section>
  )
}
