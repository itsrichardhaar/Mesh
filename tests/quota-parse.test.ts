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

  it('skips a window missing resets_at, keeping the valid one', () => {
    const snapshot = parseOauthUsage(
      {
        five_hour: { utilization: 5 }, // no resets_at → dropped
        seven_day: { utilization: 41, resets_at: '2026-07-15T23:59:59Z' }
      },
      FETCHED_AT
    )
    expect(snapshot!.windows).toHaveLength(1)
    expect(snapshot!.windows[0]!.kind).toBe('seven_day')
  })

  it('defaults a missing/non-numeric utilization to 0 percent', () => {
    const snapshot = parseOauthUsage(
      { five_hour: { resets_at: '2026-07-13T19:19:59Z' } },
      FETCHED_AT
    )
    expect(snapshot!.windows[0]!.percentUsed).toBe(0)
  })

  it('returns null when no window is usable', () => {
    expect(parseOauthUsage({}, FETCHED_AT)).toBeNull()
    expect(parseOauthUsage({ five_hour: { utilization: 5 } }, FETCHED_AT)).toBeNull()
  })

  it('returns null for a malformed (non-object) payload', () => {
    expect(parseOauthUsage(null, FETCHED_AT)).toBeNull()
    expect(parseOauthUsage('nope', FETCHED_AT)).toBeNull()
    expect(parseOauthUsage(42, FETCHED_AT)).toBeNull()
  })
})
