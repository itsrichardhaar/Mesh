import Anthropic from '@anthropic-ai/sdk'
import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  ValidationResult
} from '@shared/types'
import type { ModelId } from '@shared/models'

/**
 * Narrow SDK seam so tests can inject a fake without pulling in the
 * real Anthropic client. We only need `messages.create` for v1 — both
 * `validate` (1-token probe, Slice 8) and `analyzeProject` (tool-use
 * call, Slice 10) route through it.
 */
export interface AnthropicLike {
  messages: {
    create(params: unknown): Promise<unknown>
  }
}

export type AnthropicFactory = (apiKey: string) => AnthropicLike

const defaultFactory: AnthropicFactory = (apiKey) => new Anthropic({ apiKey })

/**
 * `ClaudeClient` is the functional v1 implementation of `ModelClient`.
 * Slice 9 shipped the shape; Slice 8 fills in `validate()` with a
 * 1-token messages call; Slice 10 fills in `analyzeProject()` using
 * `tool_use` + `tool_choice` + `cache_control` per ADR-0003 / PRD.
 */
export class ClaudeClient implements ModelClient {
  readonly provider = 'claude' as const
  private readonly client: AnthropicLike

  constructor(
    public readonly model: ModelId,
    apiKey: string,
    factory: AnthropicFactory = defaultFactory
  ) {
    if (apiKey.length === 0) {
      throw new Error('ClaudeClient: apiKey is required')
    }
    this.client = factory(apiKey)
  }

  /**
   * 1-token probe to confirm the stored API key works. Returns
   * `{ ok: true }` on a successful response; otherwise returns
   * `{ ok: false, message }` with a short, human-readable reason so
   * Settings can surface it inline. The probe never throws — error
   * paths route through the result envelope so the UI doesn't have
   * to catch.
   */
  async validate(): Promise<ValidationResult> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: humanizeAnthropicError(err) }
    }
  }

  async analyzeProject(_input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    throw new Error('ClaudeClient.analyzeProject: implementation lands in Slice 10')
  }
}

/**
 * Anthropic SDK errors carry a `status` (HTTP code) and `message`.
 * We map common cases to a tight, actionable string; everything else
 * falls back to the SDK's own message. Network-layer failures arrive
 * as plain `Error`s with no status — surface a generic banner.
 */
export function humanizeAnthropicError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; message?: string }
    if (e.status === 401) return 'Invalid API key'
    if (e.status === 403) return 'Forbidden — check your key permissions'
    if (e.status === 429) return 'Rate limited — try again in a moment'
    if (typeof e.status === 'number' && e.status >= 500) {
      return 'Anthropic is having trouble — try again later'
    }
    if (typeof e.status === 'number' && e.status >= 400 && e.message) {
      return e.message
    }
    if (typeof e.message === 'string' && e.message.length > 0) {
      return /network|fetch/i.test(e.message)
        ? 'Network error — check your connection'
        : e.message
    }
  }
  return 'Network error or unknown failure'
}
