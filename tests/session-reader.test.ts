import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listSessions,
  readLatestAwaySummary,
  readSessionSummary,
  readTranscript
} from '@main/sessions/session-reader'

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

  describe('readTranscript — entry kinds', () => {
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
        {
          kind: 'message',
          uuid: 'u1',
          role: 'user',
          timestamp: '2026-06-25T10:00:00.000Z',
          markdown: 'Hello there'
        },
        {
          kind: 'message',
          uuid: 'a1',
          role: 'assistant',
          timestamp: '2026-06-25T10:00:01.000Z',
          markdown: 'Hi! How can I help?'
        }
      ])
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
      expect(result.map((m) => 'uuid' in m && m.uuid)).toEqual(['u1', 'a1'])
    })
  })

  describe('readTranscript — fixture snapshots', () => {
    it('renders tool calls as one-liner entries with concise result summaries', async () => {
      const dir = await mkProjectDir('tool-calls')
      const assistantToolCall = assistantBlocksLine(
        '2026-06-25T10:00:01.000Z',
        'a1',
        [
          { type: 'text', text: 'Looking at the file.' },
          { type: 'tool_use', id: 'toolu_read1', name: 'Read', input: { file_path: '/repo/a.ts' } },
          {
            type: 'tool_use',
            id: 'toolu_bash1',
            name: 'Bash',
            input: { command: 'pnpm test --silent' }
          },
          {
            type: 'tool_use',
            id: 'toolu_glob1',
            name: 'Glob',
            input: { pattern: 'src/**/*.tsx' }
          }
        ]
      )
      const toolResults = toolResultsLine('2026-06-25T10:00:02.000Z', 'u2', [
        { tool_use_id: 'toolu_read1', content: 'file body line 1\nfile body line 2\n' },
        {
          tool_use_id: 'toolu_bash1',
          content: 'PASS  tests/example.test.ts (1.2s)\n'
        },
        {
          tool_use_id: 'toolu_glob1',
          content: 'src/foo.tsx\nsrc/bar.tsx\nsrc/baz.tsx\n'
        }
      ])
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('Run the tests and check src.', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          assistantToolCall,
          toolResults,
          assistantTextLine('All green.', '2026-06-25T10:00:03.000Z', { uuid: 'a2' })
        ].join('\n') + '\n',
        'utf-8'
      )

      const result = await readTranscript(dir, 's')
      expect(result).toMatchInlineSnapshot(`
        [
          {
            "kind": "message",
            "markdown": "Run the tests and check src.",
            "role": "user",
            "timestamp": "2026-06-25T10:00:00.000Z",
            "uuid": "u1",
          },
          {
            "kind": "message",
            "markdown": "Looking at the file.",
            "role": "assistant",
            "timestamp": "2026-06-25T10:00:01.000Z",
            "uuid": "a1",
          },
          {
            "keyArg": "/repo/a.ts",
            "kind": "tool",
            "resultSummary": null,
            "timestamp": "2026-06-25T10:00:01.000Z",
            "tool": "Read",
            "uuid": "toolu_read1",
          },
          {
            "keyArg": "pnpm test --silent",
            "kind": "tool",
            "resultSummary": "PASS  tests/example.test.ts (1.2s)",
            "timestamp": "2026-06-25T10:00:01.000Z",
            "tool": "Bash",
            "uuid": "toolu_bash1",
          },
          {
            "keyArg": "src/**/*.tsx",
            "kind": "tool",
            "resultSummary": "3 matches",
            "timestamp": "2026-06-25T10:00:01.000Z",
            "tool": "Glob",
            "uuid": "toolu_glob1",
          },
          {
            "kind": "message",
            "markdown": "All green.",
            "role": "assistant",
            "timestamp": "2026-06-25T10:00:03.000Z",
            "uuid": "a2",
          },
        ]
      `)
    })

    it('skips oversized tool_result content at parse time (no result summary surfaces)', async () => {
      const dir = await mkProjectDir('oversized')
      const big = 'x'.repeat(10_000)
      const assistantCall = assistantBlocksLine('2026-06-25T10:00:01.000Z', 'a1', [
        {
          type: 'tool_use',
          id: 'toolu_read_big',
          name: 'Read',
          input: { file_path: '/repo/huge.txt' }
        },
        {
          type: 'tool_use',
          id: 'toolu_bash_big',
          name: 'Bash',
          input: { command: 'cat huge.txt' }
        }
      ])
      const bigResults = toolResultsLine('2026-06-25T10:00:02.000Z', 'u2', [
        { tool_use_id: 'toolu_read_big', content: big },
        // array-form content that also exceeds the cap when accumulated
        {
          tool_use_id: 'toolu_bash_big',
          content: [
            { type: 'text', text: big.slice(0, 5000) },
            { type: 'text', text: big.slice(0, 5000) }
          ]
        }
      ])
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('read it', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          assistantCall,
          bigResults
        ].join('\n') + '\n',
        'utf-8'
      )

      const result = await readTranscript(dir, 's')
      // Both tool entries are present, but neither carries a result
      // summary — the oversized payload never makes it past the cap.
      const tools = result.filter((e) => e.kind === 'tool')
      expect(tools).toHaveLength(2)
      for (const t of tools) {
        expect(t.kind === 'tool' && t.resultSummary).toBeNull()
      }
    })

    it('collapses sidechain runs into a single ↳ sub-agent indicator', async () => {
      const dir = await mkProjectDir('sidechain-group')
      const sub1 = userLine('sub thought 1', '2026-06-25T10:00:01.000Z', {
        uuid: 'sc1',
        isSidechain: true
      })
      const sub2 = assistantTextLine('sub reply 1', '2026-06-25T10:00:02.000Z', {
        uuid: 'sc2',
        isSidechain: true
      })
      const sub3 = userLine('sub thought 2', '2026-06-25T10:00:03.000Z', {
        uuid: 'sc3',
        isSidechain: true
      })
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('main user', '2026-06-25T10:00:00.000Z', { uuid: 'u1' }),
          sub1,
          sub2,
          sub3,
          assistantTextLine('back in main', '2026-06-25T10:00:04.000Z', { uuid: 'a1' })
        ].join('\n') + '\n',
        'utf-8'
      )
      const result = await readTranscript(dir, 's')
      expect(result).toEqual([
        {
          kind: 'message',
          uuid: 'u1',
          role: 'user',
          timestamp: '2026-06-25T10:00:00.000Z',
          markdown: 'main user'
        },
        { kind: 'sidechain', id: 'sc-0', messageCount: 3 },
        {
          kind: 'message',
          uuid: 'a1',
          role: 'assistant',
          timestamp: '2026-06-25T10:00:04.000Z',
          markdown: 'back in main'
        }
      ])
    })
  })

  describe('readLatestAwaySummary', () => {
    it('returns null when the session file does not exist', async () => {
      const dir = await mkProjectDir('no-session')
      const result = await readLatestAwaySummary(dir, 'missing')
      expect(result).toBeNull()
    })

    it('returns null when no away_summary row is present', async () => {
      const dir = await mkProjectDir('no-summary')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          systemLine('mode'),
          userLine('Hello', '2026-06-25T10:00:00.000Z', { uuid: 'u1' })
        ].join('\n') + '\n',
        'utf-8'
      )
      expect(await readLatestAwaySummary(dir, 's')).toBeNull()
    })

    it('returns the latest away_summary content when multiple are present', async () => {
      const dir = await mkProjectDir('away')
      const earlier = JSON.stringify({
        type: 'system',
        subtype: 'away_summary',
        content: 'Earlier checkpoint.',
        timestamp: '2026-06-25T10:00:00.000Z'
      })
      const later = JSON.stringify({
        type: 'system',
        subtype: 'away_summary',
        content: 'Latest checkpoint — picked up RAG work.',
        timestamp: '2026-06-25T18:00:00.000Z'
      })
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('hi', '2026-06-25T09:59:00.000Z'),
          earlier,
          assistantTextLine('ok', '2026-06-25T15:00:00.000Z'),
          later
        ].join('\n') + '\n',
        'utf-8'
      )
      const result = await readLatestAwaySummary(dir, 's')
      expect(result).toBe('Latest checkpoint — picked up RAG work.')
    })
  })

  describe('readSessionSummary', () => {
    it('returns null when the session file does not exist', async () => {
      const dir = await mkProjectDir('sum-missing')
      expect(await readSessionSummary(dir, 'nope')).toBeNull()
    })

    it('prefers the latest away_summary when present', async () => {
      const dir = await mkProjectDir('sum-away')
      const away = JSON.stringify({
        type: 'system',
        subtype: 'away_summary',
        content: 'Checkpoint: finished the migration.',
        timestamp: '2026-06-25T18:00:00.000Z'
      })
      await writeFile(
        join(dir, 's.jsonl'),
        [userLine('Do the migration', '2026-06-25T10:00:00.000Z'), away].join('\n') + '\n',
        'utf-8'
      )
      expect(await readSessionSummary(dir, 's')).toBe('Checkpoint: finished the migration.')
    })

    it('falls back to the first user message when there is no away_summary', async () => {
      const dir = await mkProjectDir('sum-first')
      await writeFile(
        join(dir, 's.jsonl'),
        [
          userLine('Help me refactor the auth module', '2026-06-25T10:00:00.000Z'),
          assistantTextLine('sure', '2026-06-25T10:01:00.000Z'),
          userLine('and then add tests', '2026-06-25T10:02:00.000Z')
        ].join('\n') + '\n',
        'utf-8'
      )
      expect(await readSessionSummary(dir, 's')).toBe('Help me refactor the auth module')
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

function assistantBlocksLine(
  timestamp: string,
  uuid: string,
  content: unknown[]
): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'assistant',
    uuid,
    timestamp,
    message: { role: 'assistant', content }
  })
}

function toolResultsLine(
  timestamp: string,
  uuid: string,
  results: Array<{ tool_use_id: string; content: unknown }>
): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    uuid,
    timestamp,
    message: {
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content
      }))
    }
  })
}

function systemLine(type: string): string {
  return JSON.stringify({ type })
}
