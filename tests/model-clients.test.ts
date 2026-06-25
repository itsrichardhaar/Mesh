import { describe, it, expect } from 'vitest'
import { ClaudeClient } from '@main/models/claude-client'
import { LocalClient } from '@main/models/local-client'
import { OpenAIClient } from '@main/models/openai-client'

/**
 * Slice 9 lands the contract; the bodies of validate/analyzeProject
 * land in Slices 8 and 10. These tests pin the behavior that does
 * exist today: constructors store the right fields, stubs throw the
 * documented error, and the ClaudeClient throws a different (slice-
 * specific) marker so a future agent can find the right hook.
 */
describe('ClaudeClient', () => {
  it('exposes the provider and stored model id', () => {
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test')
    expect(c.provider).toBe('claude')
    expect(c.model).toBe('claude-haiku-4-5')
  })

  it('refuses to construct with an empty api key', () => {
    expect(() => new ClaudeClient('claude-haiku-4-5', '')).toThrow(/apiKey is required/)
  })

  it('validate() throws a Slice-8 marker', async () => {
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test')
    await expect(c.validate()).rejects.toThrow(/Slice 8/)
  })

  it('analyzeProject() throws a Slice-10 marker', async () => {
    const c = new ClaudeClient('claude-haiku-4-5', 'sk-ant-test')
    await expect(
      c.analyzeProject({ systemPrompt: '', userPrompt: '' })
    ).rejects.toThrow(/Slice 10/)
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
