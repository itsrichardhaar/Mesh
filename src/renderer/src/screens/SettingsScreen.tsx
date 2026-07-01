import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ProviderId,
  StoredValidation,
  ThemePreference,
  UiModePreference,
  ValidationResult
} from '@shared/types'
import {
  PROVIDERS,
  getRecommendedModel,
  isModelId,
  selectedModelSettingKey,
  type ModelDescriptor,
  type ModelId
} from '@shared/models'
import { PROVIDER_IDS } from '@shared/types'
import { useNotifications } from '../hooks/useNotifications'
import { useTheme } from '../theme/ThemeProvider'
import { useUiMode } from '../theme/UiModeProvider'
import { relativeTime } from '../util/relativeTime'

/**
 * Per-Provider input rules and onboarding pointers. Slice 35 adds OpenAI;
 * Local is unavailable so it doesn't appear here.
 */
const PROVIDER_KEY_CONFIG: Record<'claude' | 'openai', {
  keyLabel: string
  placeholder: string
  consoleUrl: string
  /** Auto-save trigger — pastes that match are saved on type so the user doesn't have to hit Enter. */
  looksLikeKey: (value: string) => boolean
  /** Tooltip shown on the pill when this Provider is `available` but no key is stored yet. */
  noKeyTooltip: string
}> = {
  claude: {
    keyLabel: 'Anthropic API key',
    placeholder: 'Paste your sk-ant-… key',
    consoleUrl: 'https://console.anthropic.com',
    looksLikeKey: (v) => v.startsWith('sk-ant-') && v.length >= 20,
    noKeyTooltip: 'Add an Anthropic API key in Settings → Model'
  },
  openai: {
    keyLabel: 'OpenAI API key',
    placeholder: 'Paste your sk-… key',
    consoleUrl: 'https://platform.openai.com/api-keys',
    // OpenAI keys start with `sk-` or `sk-proj-`. Disambiguate from
    // Anthropic's `sk-ant-` so a pasted Claude key doesn't auto-save
    // into the OpenAI slot.
    looksLikeKey: (v) =>
      v.startsWith('sk-') && !v.startsWith('sk-ant-') && v.length >= 20,
    noKeyTooltip: 'Add an OpenAI API key in Settings → Model'
  }
}

function isKeyedProvider(id: ProviderId): id is 'claude' | 'openai' {
  return id === 'claude' || id === 'openai'
}

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
      </header>

      <div className="settings-body">
        <AppearanceSection />
        <ModelSection />
        <NotificationsSection />
      </div>
    </div>
  )
}

function NotificationsSection(): JSX.Element {
  const { globalMute, setGlobalMute } = useNotifications()
  return (
    <section
      className="settings-section settings-section-notifications"
      aria-label="Notifications"
    >
      <h2>Notifications</h2>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={globalMute}
          onChange={(e) => void setGlobalMute(e.target.checked)}
        />
        <span>
          <span className="settings-toggle-label">Pause notifications</span>
          <span className="settings-toggle-help">
            New notifications still appear in the dropdown while paused — only
            top-right toasts are suppressed.
          </span>
        </span>
      </label>
    </section>
  )
}

function AppearanceSection(): JSX.Element {
  const { preference, setPreference, ready } = useTheme()
  const { mode, setMode, ready: uiModeReady } = useUiMode()

  return (
    <section
      className="settings-section settings-section-appearance"
      aria-label="Appearance"
    >
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

      <fieldset className="theme-options ui-mode-options" disabled={!uiModeReady}>
        <legend className="settings-fieldset-legend">UI Mode</legend>
        <UiModeOption
          value="sans"
          label="Sans"
          description="Proportional Inter font, softer document feel."
          checked={mode === 'sans'}
          onChange={setMode}
        />
        <UiModeOption
          value="mono"
          label="Mono"
          description="Monospace JetBrains Mono, tighter CLI / code-editor feel."
          checked={mode === 'mono'}
          onChange={setMode}
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

function UiModeOption({
  value,
  label,
  description,
  checked,
  onChange
}: {
  value: UiModePreference
  label: string
  description: string
  checked: boolean
  onChange: (next: UiModePreference) => void
}): JSX.Element {
  return (
    <label className={`theme-option${checked ? ' theme-option-checked' : ''}`}>
      <input
        type="radio"
        name="ui-mode"
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
  // Slice 36: Active Provider is now a real setting (`active_provider`)
  // driven by pill clicks. Defaults to `'claude'` when no row exists
  // (backward-compatible with v0.3.x installs). Subscribes to the live
  // change event so other surfaces (Analyze button subtitle) and this
  // pill row stay in sync.
  const [activeProvider, setActiveProviderState] = useState<ProviderId>('claude')

  useEffect(() => {
    let cancelled = false
    void window.api.settings.getActiveProvider().then((p) => {
      if (!cancelled) setActiveProviderState(p)
    })
    const unsub = window.api.settings.onActiveProviderChanged((p) => {
      setActiveProviderState(p)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  // Lifted state — pill enabled/disabled depends on whether a key is
  // stored for that Provider, and the disabled tooltip text differs by
  // reason (no key vs unavailable). ApiKeyField calls `onKeyChange`
  // when it saves or clears a key so the pill row stays in sync.
  const [keyedProviders, setKeyedProviders] = useState<Set<ProviderId>>(new Set())

  const refreshKeyed = useCallback(async (): Promise<void> => {
    const next = new Set<ProviderId>()
    for (const id of PROVIDER_IDS) {
      try {
        const mask = await window.api.secrets.getMask(id)
        if (mask) next.add(id)
      } catch {
        // Encryption unavailable / IPC error: leave this Provider as
        // not-keyed. The ApiKeyField surfaces a more detailed error.
      }
    }
    setKeyedProviders(next)
  }, [])

  useEffect(() => {
    void refreshKeyed()
  }, [refreshKeyed])

  return (
    <section className="settings-section settings-section-model" aria-label="Model">
      <h2>Model</h2>

      <div className="provider-pills" role="tablist" aria-label="Provider">
        {PROVIDER_IDS.map((id) => (
          <ProviderPill
            key={id}
            provider={id}
            active={id === activeProvider}
            hasKey={keyedProviders.has(id)}
            onActivate={() => void window.api.settings.setActiveProvider(id)}
          />
        ))}
      </div>

      {PROVIDER_IDS.filter((id) => PROVIDERS[id].available && isKeyedProvider(id)).map((id) => (
        <ProviderKeySection
          key={id}
          provider={id as 'claude' | 'openai'}
          onKeyChange={() => void refreshKeyed()}
        />
      ))}

      <ModelSelect provider={activeProvider} />
    </section>
  )
}

function ProviderKeySection({
  provider,
  onKeyChange
}: {
  provider: 'claude' | 'openai'
  onKeyChange: () => void
}): JSX.Element {
  const config = PROVIDER_KEY_CONFIG[provider]
  return (
    <>
      <ApiKeyField
        provider={provider}
        label={config.keyLabel}
        placeholder={config.placeholder}
        looksLikeKey={config.looksLikeKey}
        onKeyChange={onKeyChange}
      />

      <p className="settings-helper-link">
        <a
          href={config.consoleUrl}
          onClick={(e) => {
            e.preventDefault()
            void window.api.shell.openExternal(config.consoleUrl)
          }}
        >
          Get a key →
        </a>
      </p>
    </>
  )
}

function ProviderPill({
  provider,
  active,
  hasKey,
  onActivate
}: {
  provider: ProviderId
  active: boolean
  hasKey: boolean
  onActivate: () => void
}): JSX.Element {
  const descriptor = PROVIDERS[provider]
  // Pill is enabled iff the Provider is available AND a key is stored.
  // Clicking the currently-active pill is a no-op; clicking an enabled
  // non-active pill switches Active Provider via the IPC. UI updates
  // from the live `onActiveProviderChanged` event (not optimistically)
  // so the highlight always matches persisted state.
  const disabled = !descriptor.available || !hasKey
  const tooltip = !descriptor.available
    ? descriptor.comingSoonNote
    : !hasKey && isKeyedProvider(provider)
      ? PROVIDER_KEY_CONFIG[provider].noKeyTooltip
      : undefined

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
      title={tooltip}
      onClick={() => {
        if (disabled || active) return
        onActivate()
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

type ValidationState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'cached'; record: StoredValidation }
  | { status: 'fresh'; at: string; result: ValidationResult }

function ApiKeyField({
  provider,
  label,
  placeholder,
  looksLikeKey,
  onKeyChange
}: {
  provider: ProviderId
  label: string
  placeholder: string
  /** Auto-save trigger — typed value matching this predicate is saved without a Submit. */
  looksLikeKey: (value: string) => boolean
  /** Called whenever a key is saved or cleared so the parent's pill state stays in sync. */
  onKeyChange?: () => void
}): JSX.Element {
  const [state, setState] = useState<ApiKeyState>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' })

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
        if (mask) {
          const cached = await window.api.secrets.getLastValidation(provider)
          if (cancelled) return
          if (cached) setValidation({ status: 'cached', record: cached })
        }
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

  const runValidation = async (): Promise<void> => {
    setValidation({ status: 'checking' })
    try {
      const result = await window.api.secrets.validate(provider)
      setValidation({ status: 'fresh', at: new Date().toISOString(), result })
    } catch (err) {
      setValidation({
        status: 'fresh',
        at: new Date().toISOString(),
        result: { ok: false, message: err instanceof Error ? err.message : String(err) }
      })
    }
  }

  const save = async (plaintext: string): Promise<void> => {
    const previous: ApiKeyView =
      state.status === 'saved' ? { status: 'saved', mask: state.mask } : { status: 'empty' }
    setState({ status: 'saving' })
    try {
      await window.api.secrets.set(provider, plaintext)
      const mask = await window.api.secrets.getMask(provider)
      setState(mask ? { status: 'saved', mask } : { status: 'empty' })
      setDraft('')
      if (mask) {
        void runValidation()
        onKeyChange?.()
      }
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
      setValidation({ status: 'idle' })
      onKeyChange?.()
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
          if (looksLikeKey(next)) {
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

      {showSavedMask && (
        <ValidationStatusBanner
          validation={validation}
          onRetry={() => void runValidation()}
        />
      )}
    </div>
  )
}

function ValidationStatusBanner({
  validation,
  onRetry
}: {
  validation: ValidationState
  onRetry: () => void
}): JSX.Element | null {
  if (validation.status === 'idle') return null
  if (validation.status === 'checking') {
    return (
      <p className="api-key-validation api-key-validation-checking">Checking…</p>
    )
  }

  const result =
    validation.status === 'fresh'
      ? validation.result
      : { ok: validation.record.ok, message: validation.record.message }
  const at = validation.status === 'fresh' ? validation.at : validation.record.at
  const verifiedLine = `last verified ${relativeTime(at)}`

  if (result.ok) {
    return (
      <p className="api-key-validation api-key-validation-ok">
        <span aria-hidden="true">✓</span> Connected · {verifiedLine}
      </p>
    )
  }
  return (
    <p className="api-key-validation api-key-validation-bad" role="alert">
      <span aria-hidden="true">✗</span> Invalid key
      {result.message ? <> — {result.message}</> : null} · {verifiedLine}
      <button type="button" className="api-key-validation-retry" onClick={onRetry}>
        Retry
      </button>
    </p>
  )
}

