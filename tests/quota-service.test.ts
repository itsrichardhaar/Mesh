import { describe, it, expect, vi } from 'vitest'
import { QuotaService, type QuotaFetch, type QuotaFetchResult } from '@main/quota/service'

const PAYLOAD = {
  five_hour: { utilization: 15, resets_at: '2026-07-13T19:19:59Z' },
  seven_day: { utilization: 41, resets_at: '2026-07-15T23:59:59Z' }
}

interface Harness {
  service: QuotaService
  fetchUsage: ReturnType<typeof vi.fn>
  readToken: ReturnType<typeof vi.fn>
  setNow: (ms: number) => void
  setEnabled: (v: boolean) => void
}

function harness(opts?: {
  enabled?: boolean
  token?: string | null
  fetchImpl?: QuotaFetch
  ttlMs?: number
}): Harness {
  let now = 0
  let enabled = opts?.enabled ?? true
  const readToken = vi.fn(() => (opts?.token === undefined ? 'tok-abc' : opts.token))
  const defaultFetch: QuotaFetch = async () => ({ ok: true, payload: PAYLOAD })
  const fetchUsage = vi.fn(opts?.fetchImpl ?? defaultFetch)
  const service = new QuotaService({
    isEnabled: () => enabled,
    readToken,
    fetchUsage,
    userAgent: () => 'claude-code/9.9.9',
    now: () => now,
    ttlMs: opts?.ttlMs ?? 5 * 60 * 1000
  })
  return {
    service,
    fetchUsage,
    readToken,
    setNow: (ms) => {
      now = ms
    },
    setEnabled: (v) => {
      enabled = v
    }
  }
}

describe('QuotaService', () => {
  it('returns null and touches neither credential nor network while disabled', async () => {
    const h = harness({ enabled: false })
    expect(await h.service.getSnapshot()).toBeNull()
    expect(h.readToken).not.toHaveBeenCalled()
    expect(h.fetchUsage).not.toHaveBeenCalled()
  })

  it('fetches, parses, and returns a snapshot when enabled with a token', async () => {
    const h = harness()
    const snap = await h.service.getSnapshot()
    expect(snap!.windows).toHaveLength(2)
    expect(h.fetchUsage).toHaveBeenCalledOnce()
    expect(h.fetchUsage).toHaveBeenCalledWith('tok-abc', 'claude-code/9.9.9')
  })

  it('serves the cached snapshot within the TTL without re-fetching', async () => {
    const h = harness({ ttlMs: 1000 })
    await h.service.getSnapshot()
    h.setNow(500)
    await h.service.getSnapshot()
    expect(h.fetchUsage).toHaveBeenCalledOnce()
  })

  it('re-fetches once the TTL has elapsed', async () => {
    const h = harness({ ttlMs: 1000 })
    await h.service.getSnapshot()
    h.setNow(1001)
    await h.service.getSnapshot()
    expect(h.fetchUsage).toHaveBeenCalledTimes(2)
  })

  it('serves the last good snapshot on a 429 rather than re-hammering', async () => {
    let result: QuotaFetchResult = { ok: true, payload: PAYLOAD }
    const h = harness({ ttlMs: 1000, fetchImpl: async () => result })
    const first = await h.service.getSnapshot()
    expect(first!.windows).toHaveLength(2)

    result = { ok: false, status: 429 }
    h.setNow(2000) // past TTL, so it will attempt a fetch
    const second = await h.service.getSnapshot()
    expect(second).toEqual(first) // stale-but-present, not null

    // And it backs off: the 429 refreshed the cache clock, so a call
    // within the new TTL does not fetch again.
    h.setNow(2500)
    await h.service.getSnapshot()
    expect(h.fetchUsage).toHaveBeenCalledTimes(2)
  })

  it('returns null when enabled but no credential is present', async () => {
    const h = harness({ token: null })
    expect(await h.service.getSnapshot()).toBeNull()
    expect(h.fetchUsage).not.toHaveBeenCalled()
  })

  it('returns null (hidden) when the very first fetch fails with no prior snapshot', async () => {
    const h = harness({ fetchImpl: async () => ({ ok: false, status: 500 }) })
    expect(await h.service.getSnapshot()).toBeNull()
  })

  it('serves the last snapshot when a later fetch throws', async () => {
    let throwNow = false
    const h = harness({
      ttlMs: 1000,
      fetchImpl: async () => {
        if (throwNow) throw new Error('network down')
        return { ok: true, payload: PAYLOAD }
      }
    })
    const first = await h.service.getSnapshot()
    throwNow = true
    h.setNow(2000)
    expect(await h.service.getSnapshot()).toEqual(first)
  })
})
