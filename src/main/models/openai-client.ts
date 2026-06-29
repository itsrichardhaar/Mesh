import OpenAI from 'openai'
import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  ValidationResult
} from '@shared/types'
import {
  ANALYZE_TOOL_NAME,
  analysisOutputSchema,
  SchemaViolationError
} from './analysis-schema'

/**
 * Output-format directive appended to the system prompt before the
 * OpenAI call. Mirrors `CLAUDE_OUTPUT_FORMAT_SUFFIX` in shape but
 * speaks "Native Structured Outputs" — the schema is enforced by
 * OpenAI at decode time via `response_format`, so the suffix only
 * needs to remind the model to follow the schema.
 */
export const OPENAI_OUTPUT_FORMAT_SUFFIX =
  'Return JSON conforming to the schema below.'

/**
 * JSON Schema-shaped object handed to the OpenAI Chat Completions API
 * in `response_format.json_schema.schema`. Diverges from Claude's
 * `ANALYZE_TOOL_INPUT_SCHEMA` only where OpenAI's strict mode requires:
 * `additionalProperties: false` on every object, and every property
 * listed in `required`. Both clients enforce the same `analysisOutputSchema`
 * shape on the decoded payload; only the wire-level JSON Schema differs.
 */
export const ANALYZE_JSON_SCHEMA_STRICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summaryMarkdown: { type: 'string' },
    nextSteps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    },
    suggestedImprovements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  },
  required: ['summaryMarkdown', 'nextSteps', 'suggestedImprovements']
} as const

/**
 * Narrow SDK seam mirroring `AnthropicLike` so tests can inject a fake
 * without pulling in the real OpenAI client. v4 only uses
 * `chat.completions.create` — both `validate` (minimal probe) and
 * `analyzeProject` (Native Structured Outputs) route through it.
 */
export interface OpenAILike {
  chat: {
    completions: {
      create(params: unknown): Promise<unknown>
    }
  }
}

export type OpenAIFactory = (apiKey: string) => OpenAILike

const defaultFactory: OpenAIFactory = (apiKey) => new OpenAI({ apiKey })

/**
 * `OpenAIClient` is v4's second functional `ModelClient`, lighting up
 * the abstraction ADR-0003 introduced. Uses OpenAI's Native Structured
 * Outputs (`response_format: { type: 'json_schema', strict: true }`)
 * rather than function calling — the `ModelClient` interface already
 * abstracts the wire-level mechanism, so mirroring Claude's `tool_use`
 * one-to-one is unnecessary and halves the surface area.
 */
export class OpenAIClient implements ModelClient {
  readonly provider = 'openai' as const
  private readonly client: OpenAILike

  constructor(
    public readonly model: string,
    apiKey: string,
    factory: OpenAIFactory = defaultFactory
  ) {
    if (apiKey.length === 0) {
      throw new Error('OpenAIClient: apiKey is required')
    }
    this.client = factory(apiKey)
  }

  /**
   * Minimal `chat.completions` probe to confirm the stored API key works.
   * Returns `{ ok: true }` on success; `{ ok: false, message }` otherwise.
   * Never throws — error paths route through the result envelope.
   */
  async validate(): Promise<ValidationResult> {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: humanizeOpenAIError(err) }
    }
  }

  async analyzeProject(input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    try {
      return await this.tryAnalyze(input)
    } catch (err) {
      if (err instanceof SchemaViolationError) {
        return await this.tryAnalyze({
          systemPrompt: input.systemPrompt,
          userPrompt:
            input.userPrompt +
            '\n\n## Previous attempt failed validation\n' +
            err.message +
            '\nReturn output that exactly matches the json_schema response_format.'
        })
      }
      throw err
    }
  }

  private async tryAnalyze(input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    const response = (await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content: `${input.systemPrompt}\n\n${OPENAI_OUTPUT_FORMAT_SUFFIX}`
        },
        {
          role: 'user',
          content: input.userPrompt
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: ANALYZE_TOOL_NAME,
          schema: ANALYZE_JSON_SCHEMA_STRICT,
          strict: true
        }
      }
    })) as ChatCompletionResponse

    const content = response.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error(
        'OpenAIClient.analyzeProject: response carried no message content'
      )
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(content)
    } catch (parseErr) {
      throw new SchemaViolationError(
        `Response was not valid JSON: ${(parseErr as Error).message}`
      )
    }

    const parsed = analysisOutputSchema.safeParse(decoded)
    if (!parsed.success) {
      throw new SchemaViolationError(parsed.error.message)
    }
    return parsed.data
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/**
 * OpenAI SDK errors carry a `status` (HTTP code) and `message`. Maps
 * common cases to a tight, actionable string; everything else falls
 * back to the SDK's own message. Network-layer failures arrive as
 * plain `Error`s with no status — surface a generic banner. Symmetric
 * with `humanizeAnthropicError`.
 */
export function humanizeOpenAIError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; message?: string }
    if (e.status === 401) return 'Invalid API key'
    if (e.status === 403) return 'Forbidden — check your key permissions'
    if (e.status === 429) return 'Rate limited — try again in a moment'
    if (typeof e.status === 'number' && e.status >= 500) {
      return 'OpenAI is having trouble — try again later'
    }
    if (typeof e.status === 'number' && e.status >= 400 && e.message) {
      return e.message
    }
    if (typeof e.message === 'string' && e.message.length > 0) {
      return /network|fetch|ECONN/i.test(e.message)
        ? 'Network error — check your connection'
        : e.message
    }
  }
  return 'Network error or unknown failure'
}
