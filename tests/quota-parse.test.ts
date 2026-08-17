import { describe, it, expect } from 'vitest'
import { parseOauthUsage } from '@main/quota/parse'

const FETCHED_AT = '2026-07-13T12:00:00.000Z'

// Shape mirrors the live `GET /api/oauth/usage` payload (the
// token-usage-analytics fixture is the reference).
const FULL_PAYLOAD = {
  five_hour: { utilization: 15, resets_at: '2026-07-13T19:19:59.836706+00:00' },
  seven_day: { utilization: 41, resets_at: '2026-07-15T23:59:59.836728+00:00' },
  seven_day_opus: null
}

describe('parseOauthUsage', () => {
  it('builds the 5-hour and weekly windows from a full payload', () => {
    const snapshot = parseOauthUsage(FULL_PAYLOAD, FETCHED_AT)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.provider).toBe('claude')
    expect(snapshot!.fetchedAt).toBe(FETCHED_AT)

    const byKind = Object.fromEntries(snapshot!.windows.map((w) => [w.kind, w]))
    expect(byKind.five_hour).toMatchObject({
      label: '5-hour window',
      percentUsed: 15,
      resetsAt: '2026-07-13T19:19:59.836706+00:00'
    })
    expect(byKind.seven_day).toMatchObject({
      label: 'Weekly window',
      percentUsed: 41
    })
  })

  it('keeps an idle window (utilization 0, resets_at null) rather than dropping it', () => {
    // Real shape from GET /api/oauth/usage when nothing has been consumed
    // in the current 5-hour window (captured live 2026-08-17). Dropping it
    // was the "only the 7d bar shows on app open" bug.
    const snapshot = parseOauthUsage(
      {
        five_hour: { utilization: 0, resets_at: null, limit_dollars: null },
        seven_day: { utilization: 12, resets_at: '2026-08-20T00:00:00.491312+00:00' }
      },
      FETCHED_AT
    )
    expect(snapshot!.windows.map((w) => w.kind)).toEqual(['five_hour', 'seven_day'])
    expect(snapshot!.windows[0]).toMatchObject({
      kind: 'five_hour',
      percentUsed: 0,
      resetsAt: null
    })
  })

  it('normalizes an absent resets_at to null (still kept)', () => {
    const snapshot = parseOauthUsage(
      {
        five_hour: { utilization: 5 }, // no resets_at → idle, resetsAt null
        seven_day: { utilization: 41, resets_at: '2026-07-15T23:59:59Z' }
      },
      FETCHED_AT
    )
    expect(snapshot!.windows).toHaveLength(2)
    expect(snapshot!.windows[0]).toMatchObject({ kind: 'five_hour', resetsAt: null })
  })

  it('defaults a missing/non-numeric utilization to 0 percent', () => {
    const snapshot = parseOauthUsage(
      { five_hour: { resets_at: '2026-07-13T19:19:59Z' } },
      FETCHED_AT
    )
    expect(snapshot!.windows[0]!.percentUsed).toBe(0)
  })

  it('returns null only when neither primary window is a present object', () => {
    expect(parseOauthUsage({}, FETCHED_AT)).toBeNull()
    expect(parseOauthUsage({ five_hour: null, seven_day: null }, FETCHED_AT)).toBeNull()
    expect(parseOauthUsage({ five_hour: 'nope' }, FETCHED_AT)).toBeNull()
  })

  it('returns null for a malformed (non-object) payload', () => {
    expect(parseOauthUsage(null, FETCHED_AT)).toBeNull()
    expect(parseOauthUsage('nope', FETCHED_AT)).toBeNull()
    expect(parseOauthUsage(42, FETCHED_AT)).toBeNull()
  })
})
