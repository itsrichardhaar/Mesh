import type { QuotaSnapshot } from '@shared/types'
import { parseOauthUsage } from './parse'

export const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** Default cache lifetime. The endpoint is aggressively rate-limited and the windows change slowly. */
export const DEFAULT_QUOTA_TTL_MS = 5 * 60 * 1000

/** Result of one usage fetch — the network seam, so the service stays testable. */
export type QuotaFetchResult =
  | { ok: true; payload: unknown }
  | { ok: false; status: number }

export type QuotaFetch = (token: string, userAgent: string) => Promise<QuotaFetchResult>

export interface QuotaServiceDeps {
  /** Opt-in gate (ADR-0011). While false, no token read and no network happen. */
  isEnabled: () => boolean
  /** Reads the Claude Code OAuth token, or null when none is available. */
  readToken: () => string | null
  /** Performs the actual usage fetch. Tests inject a fake; prod passes `httpFetchUsage`. */
  fetchUsage: QuotaFetch
  /** `User-Agent` value (`claude-code/<version>`), resolved lazily and cached by the caller. */
  userAgent: () => string
  now: () => number
  ttlMs?: number
}

/**
 * On-demand Claude Quota with an in-process cache (ADR-0011).
 *
 * - **Opt-in gate:** disabled → returns `null` immediately, touching
 *   neither the credential nor the network.
 * - **Cache:** a successful snapshot is served for `ttlMs`; the cache
 *   timestamp is also bumped on failure so a rate-limited (`429`) or
 *   erroring endpoint is not re-hammered within the window.
 * - **429 / error / no-credential:** serves the last good snapshot if
 *   one exists, else `null` (the renderer hides the chip). A stale
 *   snapshot beats spamming an aggressively rate-limited endpoint.
 *
 * The token is used only to call `fetchUsage`; it is never stored on the
 * instance, logged, or returned.
 */
export class QuotaService {
  private cache: { at: number; snapshot: QuotaSnapshot | null } | null = null

  constructor(private readonly deps: QuotaServiceDeps) {}

  async getSnapshot(): Promise<QuotaSnapshot | null> {
    if (!this.deps.isEnabled()) return null

    const now = this.deps.now()
    const ttl = this.deps.ttlMs ?? DEFAULT_QUOTA_TTL_MS
    if (this.cache && now - this.cache.at < ttl) return this.cache.snapshot

    const token = this.deps.readToken()
    if (!token) return this.backoff(now)

    let result: QuotaFetchResult
    try {
      result = await this.deps.fetchUsage(token, this.deps.userAgent())
    } catch {
      return this.backoff(now)
    }
    if (!result.ok) return this.backoff(now)

    const snapshot = parseOauthUsage(result.payload, new Date(now).toISOString())
    this.cache = { at: now, snapshot }
    return snapshot
  }

  /**
   * Serve the last good snapshot (or null) and refresh the cache clock
   * so a failing/rate-limited endpoint isn't retried until the TTL
   * elapses.
   */
  private backoff(now: number): QuotaSnapshot | null {
    const last = this.cache?.snapshot ?? null
    this.cache = { at: now, snapshot: last }
    return last
  }
}

/**
 * Production fetch: the actual outbound call to Anthropic. Thin, and the
 * only untested part of the module (it touches the live endpoint). The
 * headers mirror what Claude Code's own `/usage` sends.
 */
export const httpFetchUsage: QuotaFetch = async (token, userAgent) => {
  const response = await fetch(OAUTH_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) return { ok: false, status: response.status }
  return { ok: true, payload: await response.json() }
}
