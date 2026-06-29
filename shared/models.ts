// The Provider/Model catalog Mesh exposes in Settings → Model and uses
// to label historical Analyses. Both renderer and main read this file —
// keep it Electron-free.

import type { ProviderId } from './types'

/**
 * Stable per-Model identifier. Persisted in `settings` (e.g.
 * `settings.value` under key `model:claude`) and on each Analysis row
 * so we can attribute prior Analyses even when the user later picks a
 * different default.
 */
export type ModelId =
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'gpt-4o-mini'
  | 'gpt-4o'
  | 'gpt-4-turbo'

export interface ModelDescriptor {
  id: ModelId
  /** Short display name, e.g. `Haiku 4.5`. */
  label: string
  /** One-line tagline, e.g. `fast & cheap`. */
  subtitle: string
  /** True for the provider's recommended default. Exactly one per Provider. */
  recommended?: boolean
  /**
   * Order-of-magnitude estimate for a typical Mesh Analysis (5 sessions
   * over the 14-day window, prompt caching enabled). Shown in the
   * Settings dropdown so users can size up before picking Opus.
   */
  approxCostPerAnalysisUSD: number
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  /** True when v1 ships with this Provider functional. */
  available: boolean
  /** Tooltip text rendered on the pill when `available` is false. */
  comingSoonNote?: string
  models: readonly ModelDescriptor[]
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderDescriptor>> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    available: true,
    models: [
      {
        id: 'claude-haiku-4-5',
        label: 'Haiku 4.5',
        subtitle: 'fast & cheap',
        recommended: true,
        approxCostPerAnalysisUSD: 0.003
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Sonnet 4.6',
        subtitle: 'balanced',
        approxCostPerAnalysisUSD: 0.015
      },
      {
        id: 'claude-opus-4-7',
        label: 'Opus 4.7',
        subtitle: 'most capable, most $$',
        approxCostPerAnalysisUSD: 0.075
      }
    ]
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    available: true,
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        subtitle: 'fast & cheap',
        recommended: true,
        approxCostPerAnalysisUSD: 0.002
      },
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        subtitle: 'balanced',
        approxCostPerAnalysisUSD: 0.025
      },
      {
        id: 'gpt-4-turbo',
        label: 'GPT-4 Turbo',
        subtitle: 'most capable, most $$',
        approxCostPerAnalysisUSD: 0.08
      }
    ]
  },
  local: {
    id: 'local',
    label: 'Local',
    available: false,
    comingSoonNote: 'Coming soon',
    models: []
  }
}

export function getRecommendedModel(provider: ProviderId): ModelDescriptor | null {
  return PROVIDERS[provider].models.find((m) => m.recommended) ?? null
}

export function findModel(modelId: string): ModelDescriptor | null {
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) {
      if (model.id === modelId) return model
    }
  }
  return null
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && findModel(value) !== null
}

/** SQLite key shape for the user's selected Model per Provider. */
export function selectedModelSettingKey(provider: ProviderId): string {
  return `model:${provider}`
}
