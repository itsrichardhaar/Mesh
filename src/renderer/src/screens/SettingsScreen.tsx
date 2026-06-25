import { useEffect, useMemo, useState } from 'react'
import type { ProviderId, ThemePreference } from '@shared/types'
import {
  PROVIDERS,
  getRecommendedModel,
  isModelId,
  selectedModelSettingKey,
  type ModelDescriptor,
  type ModelId
} from '@shared/models'
import { PROVIDER_IDS } from '@shared/types'
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
  // v1 locks the Active Provider to Claude — the pills exist so the
  // multi-Provider future is telegraphed, but only Claude is selectable.
  const activeProvider: ProviderId = 'claude'

  return (
    <section className="settings-section" aria-label="Model">
      <h2>Model</h2>

      <div className="provider-pills" role="tablist" aria-label="Provider">
        {PROVIDER_IDS.map((id) => (
          <ProviderPill
            key={id}
            provider={id}
            active={id === activeProvider}
          />
        ))}
      </div>

      <ApiKeyField provider={activeProvider} label="Anthropic API key" placeholder="Paste your sk-ant-… key" />

      <ModelSelect provider={activeProvider} />
    </section>
  )
}

function ProviderPill({
  provider,
  active
}: {
  provider: ProviderId
  active: boolean
}): JSX.Element {
  const descriptor = PROVIDERS[provider]
  const disabled = !descriptor.available
  const classes = ['provider-pill']
  if (active) classes.push('provider-pill-active')
  if (disabled) classes.push('provider-pill-disabled')

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      className={classes.join(' ')}
      title={disabled ? descriptor.comingSoonNote : undefined}
      onClick={() => {
        /* v1: pills are presentational. Active Provider is locked to Claude. */
      }}
    >
      {descriptor.label}
    </button>
  )
}

function ModelSelect({ provider }: { provider: ProviderId }): JSX.Element {
  const descriptor = PROVIDERS[provider]
  const fallback = useMemo(() => getRecommendedModel(provider), [provider])
  const [selected, setSelected] = useState<ModelId | null>(null)
  const [ready, setReady] = useState(false)

  // Hydrate from settings; fall back to the recommended model when no
  // preference is stored. We persist the recommendation on first run so
  // future sessions see a stable choice the user can change.
  useEffect(() => {
    let cancelled = false
    const key = selectedModelSettingKey(provider)
    ;(async () => {
      try {
        const stored = await window.api.settings.get(key)
        if (cancelled) return
        if (isModelId(stored)) {
          setSelected(stored)
        } else if (fallback) {
          setSelected(fallback.id)
          void window.api.settings.set(key, fallback.id)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, fallback])

  const handleChange = (next: ModelId): void => {
    setSelected(next)
    void window.api.settings.set(selectedModelSettingKey(provider), next)
  }

  if (descriptor.models.length === 0) return <></>

  return (
    <div className="model-select">
      <label className="form-label" htmlFor={`model-${provider}`}>
        Model
      </label>
      <select
        id={`model-${provider}`}
        className="model-select-input"
        value={selected ?? ''}
        disabled={!ready}
        onChange={(e) => {
          const value = e.target.value
          if (isModelId(value)) handleChange(value)
        }}
      >
        {descriptor.models.map((model) => (
          <option key={model.id} value={model.id}>
            {formatModelOption(model)}
          </option>
        ))}
      </select>

      {selected &&
        (() => {
          const model = descriptor.models.find((m) => m.id === selected)
          if (!model) return null
          return (
            <p className="model-select-note">
              {model.recommended && (
                <span className="model-recommended-tag">Recommended</span>
              )}{' '}
              ~{formatCost(model.approxCostPerAnalysisUSD)} per analysis
            </p>
          )
        })()}
    </div>
  )
}

function formatModelOption(model: ModelDescriptor): string {
  const base = `${model.label} — ${model.subtitle}`
  const rec = model.recommended ? ' (Recommended)' : ''
  return `${base}${rec} · ~${formatCost(model.approxCostPerAnalysisUSD)} per analysis`
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
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
