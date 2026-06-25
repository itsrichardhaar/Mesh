import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  ValidationResult
} from '@shared/types'

/**
 * Stub Provider implementation. `LocalClient` targets self-hosted
 * OpenAI-compatible servers (Ollama, etc.) and lands in v1.1. Settings
 * disables the pill until then; every method throws.
 */
export class LocalClient implements ModelClient {
  readonly provider = 'local' as const

  constructor(
    public readonly model: string,
    public readonly baseUrl: string = 'http://localhost:11434/v1'
  ) {}

  async validate(): Promise<ValidationResult> {
    throw new Error('LocalClient: not implemented in v1')
  }

  async analyzeProject(_input: AnalyzeProjectInput): Promise<AnalysisOutput> {
    throw new Error('LocalClient: not implemented in v1')
  }
}
