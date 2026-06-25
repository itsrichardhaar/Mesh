import { describe, it, expect, vi } from 'vitest'
import {
  ClaudeClient,
  humanizeAnthropicError,
  type AnthropicLike
} from '@main/models/claude-client'
import { LocalClient } from '@main/models/local-client'
import { OpenAIClient } from '@main/models/openai-client'

function makeFake(create: AnthropicLike['messages']['create']): AnthropicLike {
  return { messages: { create } }
}

describe('ClaudeClient', () => {
  it('exposes the provider and stored model id', () => {
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
      makeFake(async () => ({}))
    )
    expect(c.provider).toBe('claude')
    expect(c.model).toBe('claude-haiku-4-5')
  })

  it('refuses to construct with an empty api key', () => {
    expect(() => new ClaudeClient('claude-haiku-4-5', '')).toThrow(/apiKey is required/)
  })

  it('analyzeProject() throws a Slice-10 marker', async () => {
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
      makeFake(async () => ({}))
    )
    await expect(
      c.analyzeProject({ systemPrompt: '', userPrompt: '' })
    ).rejects.toThrow(/Slice 10/)
  })

  describe('validate()', () => {
    it('returns ok=true when the SDK call resolves', async () => {
      const create = vi.fn(async () => ({ id: 'msg_x' }))
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () => makeFake(create))
      const result = await c.validate()
      expect(result).toEqual({ ok: true })
    })

    it('sends a 1-token request with the configured model', async () => {
      const create = vi.fn(async (_params: unknown) => ({}))
      const c = new ClaudeClient('claude-sonnet-4-6', 'sk-ant-test', () => makeFake(create))
      await c.validate()
      expect(create).toHaveBeenCalledTimes(1)
      const params = create.mock.calls[0]![0] as Record<string, unknown>
      expect(params.model).toBe('claude-sonnet-4-6')
      expect(params.max_tokens).toBe(1)
      expect(Array.isArray(params.messages)).toBe(true)
    })

    it('returns ok=false with "Invalid API key" on 401', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-bad', () =>
        makeFake(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Invalid API key')
    })

    it('returns ok=false with "Rate limited" on 429', async () => {
      const err = Object.assign(new Error('Too Many Requests'), { status: 429 })
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFake(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Rate limited/)
    })

    it('returns ok=false with a friendly 5xx message', async () => {
      const err = Object.assign(new Error('Internal error'), { status: 503 })
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFake(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Anthropic is having trouble/)
    })

    it('returns ok=false with "Network error" on a fetch-style failure', async () => {
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFake(async () => {
          throw new Error('fetch failed: ECONNREFUSED')
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Network error/)
    })

    it('never throws — error paths route through the result envelope', async () => {
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFake(async () => {
          throw 'boom'
        })
      )
      await expect(c.validate()).resolves.toMatchObject({ ok: false })
    })
  })
})

describe('humanizeAnthropicError', () => {
  it('handles the SDK message when no status maps to a canned response', () => {
    const err = Object.assign(new Error('quota_exceeded'), { status: 402 })
    expect(humanizeAnthropicError(err)).toBe('quota_exceeded')
  })

  it('falls back to a generic string for entirely unknown errors', () => {
    expect(humanizeAnthropicError({})).toBe('Network error or unknown failure')
  })
})

describe.each([
  ['OpenAIClient', (): OpenAIClient => new OpenAIClient('gpt-4o-mini')],
  ['LocalClient', (): LocalClient => new LocalClient('llama3.1:8b')]
])('%s stub', (_name, make) => {
  it('validate() throws "not implemented in v1"', async () => {
    await expect(make().validate()).rejects.toThrow(/not implemented in v1/)
  })

  it('analyzeProject() throws "not implemented in v1"', async () => {
    await expect(
      make().analyzeProject({ systemPrompt: '', userPrompt: '' })
    ).rejects.toThrow(/not implemented in v1/)
  })
})
