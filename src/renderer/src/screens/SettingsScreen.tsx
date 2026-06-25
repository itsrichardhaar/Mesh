import { useEffect, useState } from 'react'
import type { ProviderId, ThemePreference } from '@shared/types'
import { useTheme } from '../theme/ThemeProvider'

interface Props {
  onClose: () => void
}

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
        <ModelSection />
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

function ModelSection(): JSX.Element {
  return (
    <section className="settings-section" aria-label="Model">
      <h2>Model</h2>
      <ApiKeyField provider="claude" label="Anthropic API key" placeholder="Paste your sk-ant-… key" />
    </section>
  )
}

type ApiKeyState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'empty' }
  | { status: 'saved'; mask: string }
  | { status: 'saving' }
  | { status: 'error'; message: string; previous: ApiKeyView }

interface ApiKeyView {
  status: 'empty' | 'saved'
  mask?: string
}

function ApiKeyField({
  provider,
  label,
  placeholder
}: {
  provider: ProviderId
  label: string
  placeholder: string
}): JSX.Element {
  const [state, setState] = useState<ApiKeyState>({ status: 'loading' })
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const available = await window.api.secrets.available()
        if (!available) {
          if (!cancelled) {
            setState({
              status: 'unavailable',
              message:
                'macOS Keychain encryption isn’t available on this system; saving API keys is disabled.'
            })
          }
          return
        }
        const mask = await window.api.secrets.getMask(provider)
        if (cancelled) return
        setState(mask ? { status: 'saved', mask } : { status: 'empty' })
      } catch (err) {
        if (cancelled) return
        setState({
          status: 'unavailable',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider])

  const save = async (plaintext: string): Promise<void> => {
    const previous: ApiKeyView =
      state.status === 'saved' ? { status: 'saved', mask: state.mask } : { status: 'empty' }
    setState({ status: 'saving' })
    try {
      await window.api.secrets.set(provider, plaintext)
      const mask = await window.api.secrets.getMask(provider)
      setState(mask ? { status: 'saved', mask } : { status: 'empty' })
      setDraft('')
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        previous
      })
    }
  }

  const clear = async (): Promise<void> => {
    setState({ status: 'saving' })
    try {
      await window.api.secrets.clear(provider)
      setState({ status: 'empty' })
      setDraft('')
    } catch (err) {
      const previous: ApiKeyView =
        state.status === 'saved' ? { status: 'saved', mask: state.mask } : { status: 'empty' }
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        previous
      })
    }
  }

  if (state.status === 'loading') {
    return <p className="settings-section-placeholder">Loading…</p>
  }

  if (state.status === 'unavailable') {
    return (
      <div className="api-key-field">
        <div className="form-label">{label}</div>
        <p className="api-key-unavailable" role="alert">
          {state.message}
        </p>
      </div>
    )
  }

  const showSavedMask =
    state.status === 'saved' || (state.status === 'error' && state.previous.status === 'saved')

  const savedMask =
    state.status === 'saved'
      ? state.mask
      : state.status === 'error' && state.previous.status === 'saved'
        ? state.previous.mask
        : undefined

  return (
    <div className="api-key-field">
      <label className="form-label" htmlFor={`secret-${provider}`}>
        {label}
      </label>

      {showSavedMask && savedMask && (
        <div className="api-key-saved-row">
          <code className="api-key-saved-mask">{savedMask}</code>
          <button type="button" className="api-key-clear" onClick={() => void clear()}>
            Clear
          </button>
        </div>
      )}

      <input
        id={`secret-${provider}`}
        className="api-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={showSavedMask ? 'Paste a new key to replace' : placeholder}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          // Auto-save on what looks like a pasted Anthropic key. We don't
          // want to fire on every keystroke as a user types — only when
          // the value arrives whole (paste sets `next` in one shot to
          // a string that already passes the predicate).
          if (looksLikeAnthropicKey(next)) {
            void save(next)
          }
        }}
        disabled={state.status === 'saving'}
      />

      {state.status === 'error' && (
        <p className="api-key-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}

function looksLikeAnthropicKey(value: string): boolean {
  return value.startsWith('sk-ant-') && value.length >= 20
}
