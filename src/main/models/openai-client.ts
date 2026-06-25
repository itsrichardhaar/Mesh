import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  ValidationResult
} from '@shared/types'

/**
 * Stub Provider implementation. `OpenAIClient` exists so the `ModelClient`
 * abstraction is honest from day one (ADR-0003), but every method throws
 * — OpenAI support is a v1.1 task. The Settings UI disables the pill
 * accordingly.
 */
export class OpenAIClient implements ModelClient {
  readonly provider = 'openai' as const

  constructor(public readonly model: string) {}

  async validate(): Promise<ValidationResult> {
    throw new Error('OpenAIClient: not implemented in v1')
  }

  async analyzeProject(_input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    throw new Error('OpenAIClient: not implemented in v1')
  }
}
