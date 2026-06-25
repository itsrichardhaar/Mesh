import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  ValidationResult
} from '@shared/types'
import type { ModelId } from '@shared/models'

/**
 * `ClaudeClient` is the functional v1 implementation of `ModelClient`.
 * Slice 9 ships the shape and constructor (model id + api key); Slice 8
 * fills in `validate()` against the Anthropic SDK ping, and Slice 10
 * fills in `analyzeProject()` using `tool_use` + `tool_choice` for
 * structured output with prompt caching (per ADR-0003 / PRD).
 */
export class ClaudeClient implements ModelClient {
  readonly provider = 'claude' as const

  constructor(
    public readonly model: ModelId,
    private readonly apiKey: string
  ) {
    if (apiKey.length === 0) {
      throw new Error('ClaudeClient: apiKey is required')
    }
  }

  async validate(): Promise<ValidationResult> {
    throw new Error('ClaudeClient.validate: implementation lands in Slice 8')
  }

  async analyzeProject(_input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    throw new Error('ClaudeClient.analyzeProject: implementation lands in Slice 10')
  }
}
