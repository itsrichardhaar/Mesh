import type { UsageEvent } from '@shared/types'

/** Context a single JSONL line needs to become an attributed Usage Event. */
export interface UsageLineContext {
  /** Containing folder's Encoded Path — the Project attribution key. */
  encodedPath: string
  /** Session id fallback (the JSONL file stem) when the line omits `sessionId`. */
  sessionId: string
  /** Absolute source file path (provenance). */
  sourceFile: string
  /** 1-based line number within the source file (provenance). */
  lineNumber: number
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
}

/**
 * Derive a Usage Event from one JSONL line, or `null` when the line
 * isn't a usage-bearing assistant turn (user lines, summaries, sidechain
 * metadata, assistant turns without a `usage` block, or malformed JSON).
 *
 * Pure — no I/O, no clock. Every field maps directly from the line, so
 * this is the whole of the "JSONL is the source of truth" contract for
 * Usage (ADR-0009). Sidechain (sub-agent) turns are included: their
 * tokens are real consumption.
 */
export function parseUsageLine(line: string, ctx: UsageLineContext): UsageEvent | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  if (obj['type'] !== 'assistant') return null

  const eventId = asString(obj['uuid'])
  if (!eventId) return null

  const message = obj['message']
  if (typeof message !== 'object' || message === null) return null
  const msg = message as Record<string, unknown>

  const usage = msg['usage']
  if (typeof usage !== 'object' || usage === null) return null
  const u = usage as Record<string, unknown>

  const timestamp = asString(obj['timestamp'])
  if (!timestamp) return null

  return {
    eventId,
    encodedPath: ctx.encodedPath,
    sessionId: asString(obj['sessionId']) ?? ctx.sessionId,
    timestamp,
    model: asString(msg['model']),
    inputTokens: asInt(u['input_tokens']),
    cacheReadTokens: asInt(u['cache_read_input_tokens']),
    cacheWriteTokens: asInt(u['cache_creation_input_tokens']),
    outputTokens: asInt(u['output_tokens']),
    serviceTier: asString(u['service_tier']),
    gitBranch: asString(obj['gitBranch']),
    cwd: asString(obj['cwd']),
    sourceFile: ctx.sourceFile,
    sourceLine: ctx.lineNumber
  }
}
