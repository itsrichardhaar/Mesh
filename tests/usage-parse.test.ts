import { describe, it, expect } from 'vitest'
import { parseUsageLine, type UsageLineContext } from '@main/usage/parse'

const CTX: UsageLineContext = {
  encodedPath: '-Users-rh-Desktop-Mesh',
  sessionId: 'file-stem-session',
  sourceFile: '/x/-Users-rh-Desktop-Mesh/abc.jsonl',
  lineNumber: 7
}

function assistantLine(overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: 'evt-1',
    sessionId: 'sess-abc',
    timestamp: '2026-07-13T12:00:00.000Z',
    cwd: '/Users/rh/Desktop/Mesh',
    gitBranch: 'main',
    message: {
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 6,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 37340,
        output_tokens: 140,
        service_tier: 'standard',
        ...usage
      }
    },
    ...overrides
  })
}

describe('parseUsageLine', () => {
  it('maps a usage-bearing assistant turn to a Usage Event', () => {
    const event = parseUsageLine(assistantLine(), CTX)
    expect(event).toEqual({
      eventId: 'evt-1',
      encodedPath: '-Users-rh-Desktop-Mesh',
      sessionId: 'sess-abc',
      timestamp: '2026-07-13T12:00:00.000Z',
      model: 'claude-opus-4-8',
      inputTokens: 6,
      cacheReadTokens: 10,
      cacheWriteTokens: 37340,
      outputTokens: 140,
      serviceTier: 'standard',
      gitBranch: 'main',
      cwd: '/Users/rh/Desktop/Mesh',
      sourceFile: CTX.sourceFile,
      sourceLine: 7
    })
  })

  it('falls back to the file-stem sessionId when the line omits sessionId', () => {
    const line = assistantLine({ sessionId: undefined })
    expect(parseUsageLine(line, CTX)!.sessionId).toBe('file-stem-session')
  })

  it('defaults absent token fields to 0 and null-able fields to null', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'evt-2',
      timestamp: '2026-07-13T12:00:00.000Z',
      message: { usage: { output_tokens: 5 } }
    })
    const event = parseUsageLine(line, CTX)!
    expect(event).toMatchObject({
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      model: null,
      serviceTier: null,
      gitBranch: null,
      cwd: null
    })
  })

  it('returns null for non-assistant lines', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'user', uuid: 'u1' }), CTX)).toBeNull()
    expect(parseUsageLine(JSON.stringify({ type: 'summary' }), CTX)).toBeNull()
  })

  it('returns null for an assistant line without a usage block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'evt-3',
      timestamp: '2026-07-13T12:00:00.000Z',
      message: { model: 'x' }
    })
    expect(parseUsageLine(line, CTX)).toBeNull()
  })

  it('returns null when uuid or timestamp is missing', () => {
    expect(parseUsageLine(assistantLine({ uuid: undefined }), CTX)).toBeNull()
    expect(parseUsageLine(assistantLine({ timestamp: undefined }), CTX)).toBeNull()
  })

  it('returns null for blank or malformed lines', () => {
    expect(parseUsageLine('', CTX)).toBeNull()
    expect(parseUsageLine('   ', CTX)).toBeNull()
    expect(parseUsageLine('{not json', CTX)).toBeNull()
  })
})
