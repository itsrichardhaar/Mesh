import { describe, it, expect, vi } from 'vitest'
import {
  ClaudeClient,
  CLAUDE_OUTPUT_FORMAT_SUFFIX,
  humanizeAnthropicError,
  type AnthropicLike
} from '@main/models/claude-client'
import { SchemaViolationError } from '@main/models/analysis-schema'
import { LocalClient } from '@main/models/local-client'
import {
  OpenAIClient,
  OPENAI_OUTPUT_FORMAT_SUFFIX,
  humanizeOpenAIError,
  type OpenAILike
} from '@main/models/openai-client'
import { SYSTEM_PROMPT as ORCHESTRATOR_SYSTEM_PROMPT } from '@main/analyses/orchestrator'

function makeFakeAnthropic(create: AnthropicLike['messages']['create']): AnthropicLike {
  return { messages: { create } }
}

function makeFakeOpenAI(
  create: OpenAILike['chat']['completions']['create']
): OpenAILike {
  return { chat: { completions: { create } } }
}

describe('ClaudeClient', () => {
  it('exposes the provider and stored model id', () => {
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
      makeFakeAnthropic(async () => ({}))
    )
    expect(c.provider).toBe('claude')
    expect(c.model).toBe('claude-haiku-4-5')
  })

  it('refuses to construct with an empty api key', () => {
    expect(() => new ClaudeClient('claude-haiku-4-5', '')).toThrow(/apiKey is required/)
  })

  describe('analyzeProject()', () => {
    const okResponse = {
      content: [
        {
          type: 'tool_use',
          name: 'emit_daily_summary',
          input: {
            summaryMarkdown: 'It works.',
            nextSteps: [{ text: 'Ship it.' }],
            suggestedImprovements: [{ text: 'Add docs.' }]
          }
        }
      ]
    }

    it('sends tool_use + tool_choice + cache_control and returns the validated output', async () => {
      const create = vi.fn(async (_params: unknown) => okResponse)
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      const output = await c.analyzeProject({
        systemPrompt: 'sys',
        userPrompt: 'usr'
      })
      expect(output).toEqual(okResponse.content[0]!.input)

      const params = create.mock.calls[0]![0] as Record<string, unknown>
      expect(params.model).toBe('claude-haiku-4-5')
      expect(Array.isArray(params.tools)).toBe(true)
      const tool = (params.tools as Array<{ name: string }>)[0]!
      expect(tool.name).toBe('emit_daily_summary')
      expect(params.tool_choice).toEqual({ type: 'tool', name: 'emit_daily_summary' })

      // cache_control: ephemeral on system + first user content block.
      const sys = (params.system as Array<{ cache_control: unknown }>)[0]!
      expect(sys.cache_control).toEqual({ type: 'ephemeral' })
      const userBlocks = ((params.messages as Array<{ content: unknown }>)[0]!
        .content as Array<{ cache_control: unknown }>)
      expect(userBlocks[0]!.cache_control).toEqual({ type: 'ephemeral' })
    })

    it('appends the Claude output-format suffix to the system prompt before sending', async () => {
      const create = vi.fn(async (_params: unknown) => okResponse)
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      await c.analyzeProject({ systemPrompt: 'BASE', userPrompt: 'usr' })
      const params = create.mock.calls[0]![0] as { system: Array<{ text: string }> }
      expect(params.system[0]!.text).toBe(`BASE\n\n${CLAUDE_OUTPUT_FORMAT_SUFFIX}`)
    })

    it('throws when the response carries no tool_use block', async () => {
      const create = vi.fn(async (_p: unknown) => ({ content: [{ type: 'text', text: 'oops' }] }))
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toThrow(/no tool_use block/)
    })

    it('retries once when the first response fails schema validation, then returns the retry output', async () => {
      const bad = {
        content: [
          {
            type: 'tool_use',
            name: 'emit_daily_summary',
            input: { summaryMarkdown: 'ok', nextSteps: 'not-an-array' }
          }
        ]
      }
      const good = okResponse
      const create = vi
        .fn<(_p: unknown) => Promise<unknown>>()
        .mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(good)
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      const output = await c.analyzeProject({ systemPrompt: 'sys', userPrompt: 'usr' })
      expect(output).toEqual(good.content[0]!.input)
      expect(create).toHaveBeenCalledTimes(2)
      const retryParams = create.mock.calls[1]![0] as { messages: Array<{ content: Array<{ text: string }> }> }
      const retryUserText = retryParams.messages[0]!.content[0]!.text
      expect(retryUserText).toMatch(/Previous attempt failed validation/)
    })

    it('throws SchemaViolationError when both the first response and the retry fail validation', async () => {
      const bad = {
        content: [
          {
            type: 'tool_use',
            name: 'emit_daily_summary',
            input: { summaryMarkdown: 'ok', nextSteps: 'not-an-array' }
          }
        ]
      }
      const create = vi
        .fn<(_p: unknown) => Promise<unknown>>()
        .mockResolvedValue(bad)
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toBeInstanceOf(SchemaViolationError)
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('does not retry on network / non-schema errors', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const create = vi.fn(async (_p: unknown) => {
        throw err
      })
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toMatchObject({ status: 401 })
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('throws when the wrong tool was called', async () => {
      const create = vi.fn(async (_p: unknown) => ({
        content: [
          { type: 'tool_use', name: 'other_tool', input: {} }
        ]
      }))
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(create)
      )
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toThrow(/unexpected tool_use other_tool/)
    })
  })

  describe('validate()', () => {
    it('returns ok=true when the SDK call resolves', async () => {
      const create = vi.fn(async (_p: unknown) => ({ id: 'msg_x' }))
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () => makeFakeAnthropic(create))
      const result = await c.validate()
      expect(result).toEqual({ ok: true })
    })

    it('sends a 1-token request with the configured model', async () => {
      const create = vi.fn(async (_params: unknown) => ({}))
      const c = new ClaudeClient('claude-sonnet-4-6', 'sk-ant-test', () => makeFakeAnthropic(create))
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
        makeFakeAnthropic(async () => {
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
        makeFakeAnthropic(async () => {
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
        makeFakeAnthropic(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Anthropic is having trouble/)
    })

    it('returns ok=false with "Network error" on a fetch-style failure', async () => {
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(async () => {
          throw new Error('fetch failed: ECONNREFUSED')
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Network error/)
    })

    it('never throws — error paths route through the result envelope', async () => {
      const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
        makeFakeAnthropic(async () => {
          throw 'boom'
        })
      )
      await expect(c.validate()).resolves.toMatchObject({ ok: false })
    })
  })

  /**
   * Slice 34 byte-identical wire-prompt regression. The orchestrator's
   * `SYSTEM_PROMPT` no longer contains the "Emit your output by calling
   * the `emit_daily_summary` tool" line — that moved into ClaudeClient
   * as a suffix. This snapshot pins the final text the Anthropic SDK
   * sees so future SYSTEM_PROMPT edits or suffix tweaks can't silently
   * change Claude's wire payload.
   */
  it('renders byte-identical Claude system prompt against the orchestrator SYSTEM_PROMPT (Slice 34 regression)', async () => {
    const create = vi.fn(async (_p: unknown) => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_daily_summary',
          input: {
            summaryMarkdown: 'noop',
            nextSteps: [],
            suggestedImprovements: []
          }
        }
      ]
    }))
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test', () =>
      makeFakeAnthropic(create)
    )
    await c.analyzeProject({ systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT, userPrompt: 'usr' })
    const params = create.mock.calls[0]![0] as { system: Array<{ text: string }> }
    expect(params.system[0]!.text).toMatchInlineSnapshot(`
      "You are Mesh's daily-summary assistant.

      You receive a digest of one Project's recent Claude Code Sessions and produce a three-section briefing. Stay grounded in the digest — do not invent activity that isn't reflected in it. Be concrete about file paths, libraries, and decisions; avoid generic phrasing.

      Sections:
      1. Summary of Recent Sessions — one or two paragraphs (markdown) covering what was done, what's working, and what's been deferred.
      2. Next Steps — concrete, ordered actions the user could take next. Each item should be actionable and specific.
      3. Suggested Improvements — observations about the code, workflow, or planning that would compound over time. Each item should call out a specific opportunity, not abstract advice.

      Emit your output by calling the \`emit_daily_summary\` tool. Do not respond with prose outside the tool call."
    `)
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

describe('OpenAIClient', () => {
  it('exposes the provider and stored model id', () => {
    const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () =>
      makeFakeOpenAI(async () => ({}))
    )
    expect(c.provider).toBe('openai')
    expect(c.model).toBe('gpt-4o-mini')
  })

  it('refuses to construct with an empty api key', () => {
    expect(() => new OpenAIClient('gpt-4o-mini', '')).toThrow(/apiKey is required/)
  })

  describe('analyzeProject()', () => {
    const okPayload = {
      summaryMarkdown: 'It works.',
      nextSteps: [{ text: 'Ship it.' }],
      suggestedImprovements: [{ text: 'Add docs.' }]
    }
    const okResponse = {
      choices: [{ message: { content: JSON.stringify(okPayload) } }]
    }

    it('sends response_format json_schema strict and returns the validated output', async () => {
      const create = vi.fn(async (_params: unknown) => okResponse)
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      const output = await c.analyzeProject({ systemPrompt: 'sys', userPrompt: 'usr' })
      expect(output).toEqual(okPayload)

      const params = create.mock.calls[0]![0] as Record<string, unknown>
      expect(params.model).toBe('gpt-4o-mini')
      const rf = params.response_format as {
        type: string
        json_schema: { name: string; strict: boolean; schema: { additionalProperties: boolean } }
      }
      expect(rf.type).toBe('json_schema')
      expect(rf.json_schema.name).toBe('emit_daily_summary')
      expect(rf.json_schema.strict).toBe(true)
      expect(rf.json_schema.schema.additionalProperties).toBe(false)
    })

    it('appends the OpenAI output-format suffix to the system message', async () => {
      const create = vi.fn(async (_p: unknown) => okResponse)
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      await c.analyzeProject({ systemPrompt: 'BASE', userPrompt: 'usr' })
      const params = create.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>
      }
      const sys = params.messages.find((m) => m.role === 'system')!
      expect(sys.content).toBe(`BASE\n\n${OPENAI_OUTPUT_FORMAT_SUFFIX}`)
    })

    it('throws when the response carries no message content', async () => {
      const create = vi.fn(async (_p: unknown) => ({ choices: [{ message: {} }] }))
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toThrow(/no message content/)
    })

    it('treats unparseable JSON as a SchemaViolationError and retries once', async () => {
      const bad = { choices: [{ message: { content: 'not json{' } }] }
      const good = okResponse
      const create = vi
        .fn<(_p: unknown) => Promise<unknown>>()
        .mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(good)
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      const output = await c.analyzeProject({ systemPrompt: 'sys', userPrompt: 'usr' })
      expect(output).toEqual(okPayload)
      expect(create).toHaveBeenCalledTimes(2)
      const retry = create.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> }
      const retryUser = retry.messages.find((m) => m.role === 'user')!
      expect(retryUser.content).toMatch(/Previous attempt failed validation/)
    })

    it('retries once when the decoded payload fails schema validation, then returns the retry output', async () => {
      const bad = {
        choices: [
          {
            message: {
              content: JSON.stringify({ summaryMarkdown: 'ok', nextSteps: 'not-an-array' })
            }
          }
        ]
      }
      const create = vi
        .fn<(_p: unknown) => Promise<unknown>>()
        .mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(okResponse)
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      const output = await c.analyzeProject({ systemPrompt: 'sys', userPrompt: 'usr' })
      expect(output).toEqual(okPayload)
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('throws SchemaViolationError when both the first response and the retry fail validation', async () => {
      const bad = {
        choices: [
          {
            message: {
              content: JSON.stringify({ summaryMarkdown: 'ok', nextSteps: 'not-an-array' })
            }
          }
        ]
      }
      const create = vi.fn<(_p: unknown) => Promise<unknown>>().mockResolvedValue(bad)
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toBeInstanceOf(SchemaViolationError)
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('does not retry on transport / non-schema errors', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const create = vi.fn(async (_p: unknown) => {
        throw err
      })
      const c = new OpenAIClient('gpt-4o-mini', 'sk-bad', () => makeFakeOpenAI(create))
      await expect(
        c.analyzeProject({ systemPrompt: '', userPrompt: '' })
      ).rejects.toMatchObject({ status: 401 })
      expect(create).toHaveBeenCalledTimes(1)
    })
  })

  describe('validate()', () => {
    it('returns ok=true when the SDK call resolves', async () => {
      const create = vi.fn(async (_p: unknown) => ({ id: 'chatcmpl-x' }))
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () => makeFakeOpenAI(create))
      const result = await c.validate()
      expect(result).toEqual({ ok: true })
    })

    it('sends a 1-token request with the configured model', async () => {
      const create = vi.fn(async (_params: unknown) => ({}))
      const c = new OpenAIClient('gpt-4o', 'sk-test', () => makeFakeOpenAI(create))
      await c.validate()
      const params = create.mock.calls[0]![0] as Record<string, unknown>
      expect(params.model).toBe('gpt-4o')
      expect(params.max_tokens).toBe(1)
      expect(Array.isArray(params.messages)).toBe(true)
    })

    it('returns ok=false with "Invalid API key" on 401', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const c = new OpenAIClient('gpt-4o-mini', 'sk-bad', () =>
        makeFakeOpenAI(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Invalid API key')
    })

    it('returns ok=false with "Rate limited" on 429', async () => {
      const err = Object.assign(new Error('Too Many Requests'), { status: 429 })
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () =>
        makeFakeOpenAI(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Rate limited/)
    })

    it('returns ok=false with a friendly 5xx message', async () => {
      const err = Object.assign(new Error('Internal error'), { status: 503 })
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () =>
        makeFakeOpenAI(async () => {
          throw err
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/OpenAI is having trouble/)
    })

    it('returns ok=false with "Network error" on a fetch-style failure', async () => {
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () =>
        makeFakeOpenAI(async () => {
          throw new Error('fetch failed: ECONNREFUSED')
        })
      )
      const result = await c.validate()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Network error/)
    })

    it('never throws — error paths route through the result envelope', async () => {
      const c = new OpenAIClient('gpt-4o-mini', 'sk-test', () =>
        makeFakeOpenAI(async () => {
          throw 'boom'
        })
      )
      await expect(c.validate()).resolves.toMatchObject({ ok: false })
    })
  })
})

describe('humanizeOpenAIError', () => {
  it('handles the SDK message when no status maps to a canned response', () => {
    const err = Object.assign(new Error('quota_exceeded'), { status: 402 })
    expect(humanizeOpenAIError(err)).toBe('quota_exceeded')
  })

  it('falls back to a generic string for entirely unknown errors', () => {
    expect(humanizeOpenAIError({})).toBe('Network error or unknown failure')
  })
})

describe('LocalClient stub', () => {
  const make = (): LocalClient => new LocalClient('llama3.1:8b')

  it('validate() throws "not implemented"', async () => {
    await expect(make().validate()).rejects.toThrow(/not implemented/)
  })

  it('analyzeProject() throws "not implemented"', async () => {
    await expect(
      make().analyzeProject({ systemPrompt: '', userPrompt: '' })
    ).rejects.toThrow(/not implemented/)
  })
})
