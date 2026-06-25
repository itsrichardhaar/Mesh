import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSessions, readTranscript } from '@main/sessions/session-reader'

describe('session reader', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mesh-sessions-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  describe('listSessions', () => {
    it('returns an empty list when the directory does not exist', async () => {
      const result = await listSessions(join(tmpRoot, 'nope'))
      expect(result).toEqual([])
    })

    it('returns an empty list when the directory has no .jsonl files', async () => {
      const dir = await mkProjectDir('empty')
      await writeFile(join(dir, 'memory.md'), 'notes\n', 'utf-8')
      const result = await listSessions(dir)
      expect(result).toEqual([])
    })

    it('extracts title (first ~60 chars) and 3-line preview from the first user message', async () => {
      const dir = await mkProjectDir('first-user')
      const longPrompt =
        'Could you walk me through the architecture of this app?\nIt is an Electron-based desktop tool\nand I want to understand the layering\nbefore I touch anything.'
      await writeFile(
        join(dir, 'aaaa.jsonl'),
        [
          systemLine('mode'),
          userLine(longPrompt, '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          assistantTextLine('I can help with that.', '2026-06-25T10:00:01.000Z')
        ].join('\n') + '\n',
        'utf-8'
      )

      const [s] = await listSessions(dir)
      expect(s!.sessionId).toBe('aaaa')
      expect(s!.title.length).toBeLessThanOrEqual(60)
      expect(s!.title.startsWith('Could you walk me through the architecture')).toBe(true)
      expect(s!.preview.split('\n').length).toBe(3)
      expect(s!.preview).toContain('Electron-based desktop tool')
      expect(s!.preview).not.toContain('before I touch anything')
    })

    it('truncates a long single-line title with an ellipsis at ~60 chars', async () => {
      const dir = await mkProjectDir('long-title')
      const prompt = 'a'.repeat(120)
      await writeFile(
        join(dir, 'x.jsonl'),
        userLine(prompt, '2026-06-25T10:00:00.000Z') + '\n',
        'utf-8'
      )
      const [s] = await listSessions(dir)
      expect(s!.title.length).toBeLessThanOrEqual(60)
      expect(s!.title.endsWith('…')).toBe(true)
    })

    it('sorts by newest event timestamp, most recent first; null-activity sessions go last', async () => {
      const dir = await mkProjectDir('sort')
      await writeFile(
        join(dir, 'older.jsonl'),
        userLine('hi', '2026-06-01T00:00:00.000Z') + '\n',
        'utf-8'
      )
      await writeFile(
        join(dir, 'newer.jsonl'),
        userLine('hi', '2026-06-20T00:00:00.000Z') + '\n',
        'utf-8'
      )
      await writeFile(join(dir, 'empty.jsonl'), '', 'utf-8')

      const result = await listSessions(dir)
      expect(result.map((s) => s.sessionId)).toEqual(['newer', 'older', 'empty'])
    })

    it('skips sidechain user events when picking the first user message', async () => {
      const dir = await mkProjectDir('sidechain')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('sub-agent prompt', '2026-06-25T10:00:00.000Z', { isSidechain: true }),
          userLine('Main prompt from the user', '2026-06-25T10:00:01.000Z')
        ].join('\n') + '\n',
        'utf-8'
      )
      const [s] = await listSessions(dir)
      expect(s!.title.startsWith('Main prompt')).toBe(true)
    })

    it('skips a user line whose content is an array of tool_result blocks', async () => {
      const dir = await mkProjectDir('tool-result-first-user')
      const toolResult = {
        type: 'user',
        timestamp: '2026-06-25T10:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]
        }
      }
      await writeFile(
        join(dir, 's.jsonl'),
        [
          JSON.stringify(toolResult),
          userLine('Real first prompt', '2026-06-25T10:00:01.000Z')
        ].join('\n') + '\n',
        'utf-8'
      )
      const [s] = await listSessions(dir)
      expect(s!.title.startsWith('Real first prompt')).toBe(true)
    })

    it('returns sessionCount=1 with empty title/preview and null activity for an empty .jsonl', async () => {
      const dir = await mkProjectDir('empty-jsonl')
      await writeFile(join(dir, 's.jsonl'), '', 'utf-8')
      const result = await listSessions(dir)
      expect(result).toEqual([
        { sessionId: 's', title: '', preview: '', lastActivityAt: null }
      ])
    })

    it('tolerates malformed JSON lines without aborting the file', async () => {
      const dir = await mkProjectDir('malformed')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          'not json',
          '{ broken',
          userLine('first good prompt', '2026-06-25T10:00:00.000Z'),
          'also not json'
        ].join('\n') + '\n',
        'utf-8'
      )
      const [s] = await listSessions(dir)
      expect(s!.title.startsWith('first good prompt')).toBe(true)
      expect(s!.lastActivityAt).toBe('2026-06-25T10:00:00.000Z')
    })
  })

  describe('readTranscript', () => {
    it('returns an empty array when the session file does not exist', async () => {
      const dir = await mkProjectDir('no-session')
      const result = await readTranscript(dir, 'missing')
      expect(result).toEqual([])
    })

    it('extracts user and assistant text content and skips system events', async () => {
      const dir = await mkProjectDir('basic')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          systemLine('mode'),
          systemLine('permission-mode'),
          userLine('Hello there', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          assistantTextLine('Hi! How can I help?', '2026-06-25T10:00:01.000Z', { uuid: 'a1' })
        ].join('\n') + '\n',
        'utf-8'
      )
      const result = await readTranscript(dir, 's')
      expect(result).toEqual([
        { uuid: 'u1', role: 'user', timestamp: '2026-06-25T10:00:00.000Z', markdown: 'Hello there' },
        {
          uuid: 'a1',
          role: 'assistant',
          timestamp: '2026-06-25T10:00:01.000Z',
          markdown: 'Hi! How can I help?'
        }
      ])
    })

    it('drops sidechain rows', async () => {
      const dir = await mkProjectDir('sidechain')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('main user prompt', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          assistantTextLine('sub-agent reply', '2026-06-25T10:00:01.000Z', {
            uuid: 'a1',
            isSidechain: true
          }),
          assistantTextLine('main reply', '2026-06-25T10:00:02.000Z', { uuid: 'a2' })
        ].join('\n') + '\n',
        'utf-8'
      )
      const result = await readTranscript(dir, 's')
      expect(result.map((m) => m.uuid)).toEqual(['u1', 'a2'])
    })

    it('skips assistant thinking and tool_use blocks at this fidelity', async () => {
      const dir = await mkProjectDir('mixed-blocks')
      const assistant = {
        parentUuid: null,
        isSidechain: false,
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-25T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'should not surface' },
            { type: 'text', text: 'Here is the plan:' },
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } },
            { type: 'text', text: 'I just read x.' }
          ]
        }
      }
      await writeFile(
        join(dir, 's.jsonl'),
        [userLine('go', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }), JSON.stringify(assistant)].join(
          '\n'
        ) + '\n',
        'utf-8'
      )
      const result = await readTranscript(dir, 's')
      expect(result.find((m) => m.uuid === 'a1')!.markdown).toBe(
        'Here is the plan:\n\nI just read x.'
      )
    })

    it('drops user lines whose only content is tool_result blocks (no rendered text)', async () => {
      const dir = await mkProjectDir('tool-result')
      const toolResultOnly = {
        parentUuid: 'u1',
        isSidechain: false,
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-06-25T10:00:02.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]
        }
      }
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('first prompt', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          JSON.stringify(toolResultOnly)
        ].join('\n') + '\n',
        'utf-8'
      )
      const result = await readTranscript(dir, 's')
      expect(result.map((m) => m.uuid)).toEqual(['u1'])
    })

    it('tolerates malformed JSON lines without aborting the file', async () => {
      const dir = await mkProjectDir('malformed')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          'garbage',
          userLine('good prompt', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          '{ also broken',
          assistantTextLine('reply', '2026-06-25T10:00:01.000Z', { uuid: 'a1' })
        ].join('\n') + '\n',
        'utf-8'
      )
      const result = await readTranscript(dir, 's')
      expect(result.map((m) => m.uuid)).toEqual(['u1', 'a1'])
    })
  })

  async function mkProjectDir(name: string): Promise<string> {
    const dir = join(tmpRoot, name)
    await mkdir(dir, { recursive: true })
    return dir
  }
})

function userLine(
  text: string,
  timestamp: string,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    uuid: 'u-' + Math.floor(timestamp.charCodeAt(0)),
    timestamp,
    ...extra,
    message: { role: 'user', content: text }
  })
}

function assistantTextLine(
  text: string,
  timestamp: string,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'assistant',
    uuid: 'a-' + Math.floor(timestamp.charCodeAt(0)),
    timestamp,
    ...extra,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    }
  })
}

function systemLine(type: string): string {
  return JSON.stringify({ type })
}
