import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  ValidationResult
} from '@shared/types'
import type { ModelId } from '@shared/models'

/**
 * Three-section schema Mesh expects back from the LLM, validated with
 * Zod before we hand the result downstream. Lives next to the client
 * because the tool's `input_schema` (the request side) mirrors it.
 */
const analysisOutputSchema = z.object({
  summaryMarkdown: z.string().min(1),
  nextSteps: z.array(z.object({ text: z.string().min(1) })),
  suggestedImprovements: z.array(z.object({ text: z.string().min(1) }))
})

export const ANALYZE_TOOL_NAME = 'emit_daily_summary' as const

/**
 * JSON Schema-shaped object handed to the Anthropic Messages API in
 * `tools[].input_schema`. Kept in lock-step with `analysisOutputSchema`
 * so the response can't pass the LLM-side schema check but fail Zod
 * (modulo bugs Zod catches that JSON Schema misses).
 */
/**
 * Thrown when the LLM's tool-use response fails Zod validation.
 * The retry path in `analyzeProject` catches this once and re-prompts
 * with the validation message appended; if the retry also fails, the
 * error is re-thrown and the IPC layer writes a `status: 'failed'`
 * row per Slice 12's recovery flow.
 */
export class SchemaViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaViolationError'
  }
}

export const ANALYZE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    summaryMarkdown: { type: 'string' },
    nextSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    },
    suggestedImprovements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  },
  required: ['summaryMarkdown', 'nextSteps', 'suggestedImprovements']
} as const

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

  async analyzeProject(input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    try {
      return await this.tryAnalyze(input)
    } catch (err) {
      if (err instanceof SchemaViolationError) {
        // One auto-retry with the validation error appended to the
        // prompt — gives the model a concrete signal about which
        // field went wrong without escalating to a `status: 'failed'`
        // row on every transient mismatch.
        return await this.tryAnalyze({
          systemPrompt: input.systemPrompt,
          userPrompt:
            input.userPrompt +
            '\n\n## Previous attempt failed validation\n' +
            err.message +
            '\nReturn output that exactly matches the emit_daily_summary input_schema.'
        })
      }
      throw err
    }
  }

  private async tryAnalyze(input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    const response = (await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      tools: [
        {
          name: ANALYZE_TOOL_NAME,
          description:
            "Emit Mesh's three-section daily summary as structured output.",
          input_schema: ANALYZE_TOOL_INPUT_SCHEMA
        }
      ],
      tool_choice: { type: 'tool', name: ANALYZE_TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: input.userPrompt,
              cache_control: { type: 'ephemeral' }
            }
          ]
        }
      ]
    })) as MessagesResponse

    const toolUse = response.content.find(isToolUseBlock)
    if (!toolUse) {
      throw new Error('ClaudeClient.analyzeProject: response carried no tool_use block')
    }
    if (toolUse.name !== ANALYZE_TOOL_NAME) {
      throw new Error(
        `ClaudeClient.analyzeProject: unexpected tool_use ${toolUse.name}`
      )
    }
    const parsed = analysisOutputSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      throw new SchemaViolationError(parsed.error.message)
    }
    return parsed.data
  }
}

interface MessagesResponse {
  content: Array<ContentBlock>
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: string }

function isToolUseBlock(
  block: ContentBlock
): block is { type: 'tool_use'; name: string; input: unknown } {
  return block.type === 'tool_use'
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
