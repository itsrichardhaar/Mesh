import { z } from 'zod'

/**
 * Three-section schema Mesh expects back from any `ModelClient` —
 * Summary of Recent Sessions, Next Steps, Suggested Improvements.
 * Shared by `ClaudeClient` (via tool_use input_schema) and `OpenAIClient`
 * (via Native Structured Outputs response_format). Validation runs
 * after the structured-output decode regardless of which provider
 * produced the payload.
 */
export const analysisOutputSchema = z.object({
  summaryMarkdown: z.string().min(1),
  nextSteps: z.array(z.object({ text: z.string().min(1) })),
  suggestedImprovements: z.array(z.object({ text: z.string().min(1) }))
})

export const ANALYZE_TOOL_NAME = 'emit_daily_summary' as const

/**
 * Thrown when a `ModelClient`'s structured-output response fails Zod
 * validation. The retry-once path in each client catches this once and
 * re-prompts with the validation message appended; if the retry also
 * fails, the error is re-thrown and the IPC layer writes a
 * `status: 'failed'` row per Slice 12's recovery flow.
 */
export class SchemaViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaViolationError'
  }
}
