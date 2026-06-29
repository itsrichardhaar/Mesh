import { useEffect, useState } from 'react'
import type { ProviderId } from '@shared/types'
import {
  findModel,
  getRecommendedModel,
  isModelId,
  PROVIDERS,
  selectedModelSettingKey
} from '@shared/models'

export interface ActiveProviderModel {
  /** Display label of the current Active Provider, e.g. `Claude` / `OpenAI`. */
  providerLabel: string
  /** Display label of the selected model for that Provider, e.g. `Haiku 4.5` / `GPT-4o mini`. */
  modelLabel: string
}

/**
 * Live-updating hook returning the current Active Provider + selected
 * Model display labels for that Provider. Subscribes to both
 * `onActiveProviderChanged` (pill click in Settings) and `onModelChanged`
 * (Model dropdown change in Settings) so the consumer's UI stays in sync
 * without polling.
 *
 * Returns `null` until the first IPC round-trip resolves — callers should
 * fall back to a placeholder (e.g. omit the subtitle) during that window
 * so they don't flash with stale defaults.
 *
 * Falls back to each Provider's recommended Model when no per-Provider
 * `model:{provider}` setting is stored yet. v4 Slice 36.
 */
export function useActiveProviderModel(): ActiveProviderModel | null {
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [modelId, setModelId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.settings.getActiveProvider().then((p) => {
      if (!cancelled) setProvider(p)
    })
    const unsub = window.api.settings.onActiveProviderChanged((p) => {
      setProvider(p)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  useEffect(() => {
    if (!provider) return
    let cancelled = false
    const key = selectedModelSettingKey(provider)
    const refresh = (): void => {
      void window.api.settings.get(key).then((m) => {
        if (!cancelled) setModelId(m)
      })
    }
    refresh()
    const unsub = window.api.settings.onModelChanged((changedKey) => {
      if (changedKey === key) refresh()
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [provider])

  if (!provider) return null

  const descriptor = PROVIDERS[provider]
  const resolved =
    (modelId && isModelId(modelId) ? findModel(modelId) : null) ??
    getRecommendedModel(provider)
  // When a Provider's catalog is empty (e.g. `local` while it's still a
  // stub), surface the Provider label alone — the caller decides whether
  // to render the trailing `· Model`.
  return {
    providerLabel: descriptor.label,
    modelLabel: resolved?.label ?? ''
  }
}
