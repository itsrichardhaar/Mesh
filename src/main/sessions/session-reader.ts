import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type {
  SessionSummary,
  TranscriptEntry,
  TranscriptMessage,
  TranscriptToolEvent
} from '@shared/sessions'

const TITLE_MAX_CHARS = 60
const PREVIEW_MAX_LINES = 3

/**
 * Hard cap on a single `tool_result.content` payload before we drop
 * it. Read tool calls (`Read`, large `Bash` stdout) routinely cross
 * tens of KB; the transcript renderer doesn't show that body at this
 * fidelity, so we never need to retain it past parse time.
 */
const TOOL_RESULT_MAX_CHARS = 4096

/** Hard cap on the formatted one-liner key arg (e.g. shell command). */
const KEY_ARG_MAX_CHARS = 80

/** Hard cap on the formatted result-summary trailer. */
const RESULT_SUMMARY_MAX_CHARS = 60

/**
 * List every `<uuid>.jsonl` Session in `projectDir`, sorted by newest
 * event timestamp descending. Each summary's title/preview comes from
 * the first non-sidechain user message whose content is a non-empty
 * string — tool-result follow-ups (`message.content` arrays of
 * `tool_result` blocks) are not user prompts and are skipped.
 *
 * Sessions with no timestamps sort to the end. The reader is tolerant
 * of malformed JSON and unreadable files — bad lines are skipped, bad
 * files are excluded without aborting the listing.
 */
export async function listSessions(projectDir: string): Promise<SessionSummary[]> {
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return []
  }

  const summaries: SessionSummary[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue
    const full = join(projectDir, entry)
    try {
      const s = await stat(full)
      if (!s.isFile()) continue
    } catch {
      continue
    }
    const sessionId = basename(entry, '.jsonl')
    const summary = await summarizeSession(full, sessionId)
    summaries.push(summary)
  }

  summaries.sort(byNewestActivity)
  return summaries
}

/**
 * Stream a Session's JSONL and return the latest `away_summary`
 * payload (Claude Code emits these as `type:'system', subtype:
 * 'away_summary'` rows whenever the user pauses and asks Claude for
 * a checkpoint). When a session has been idle for a while these
 * digest the work-so-far into a paragraph; the analyzer prefers them
 * over the raw transcript for older sessions to keep the prompt
 * tight. Returns `null` if no row carries an away_summary.
 */
export async function readLatestAwaySummary(
  projectDir: string,
  sessionId: string
): Promise<string | null> {
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`)
  try {
    const s = await stat(jsonlPath)
    if (!s.isFile()) return null
  } catch {
    return null
  }

  let latest: string | null = null
  let latestAt = ''
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const obj = parseLine(line)
      if (!obj) continue
      if (obj['type'] !== 'system') continue
      if (obj['subtype'] !== 'away_summary') continue
      const content = obj['content']
      if (typeof content !== 'string' || content.length === 0) continue
      const ts = typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : ''
      if (ts >= latestAt) {
        latest = content
        latestAt = ts
      }
    }
  } finally {
    rl.close()
    stream.close()
  }
  return latest
}

/**
 * Stream a single Session's JSONL and return the renderable transcript
 * entries in file order. Message entries hold user/assistant text;
 * tool entries hold one-liner descriptions of `tool_use` events
 * (annotated with a concise summary of their matching `tool_result`
 * when small enough to be useful); sidechain entries collapse runs of
 * `isSidechain: true` events into a single `↳ sub-agent (N messages)`
 * indicator. System events (`mode`, `permission-mode`,
 * `file-history-snapshot`, etc.) are dropped.
 *
 * `tool_result.content` larger than `TOOL_RESULT_MAX_CHARS` is dropped
 * at parse time so the renderer never carries the bytes — Read-tool
 * results and verbose Bash stdouts would otherwise dominate memory.
 */
export async function readTranscript(
  projectDir: string,
  sessionId: string
): Promise<TranscriptEntry[]> {
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`)
  try {
    const s = await stat(jsonlPath)
    if (!s.isFile()) return []
  } catch {
    return []
  }

  const entries: TranscriptEntry[] = []
  const toolResultByUseId = new Map<string, string>()
  // Two-pass approach: collect raw shaped lines in file order, build
  // the lookup of tool_use_id → trimmed result, then emit entries with
  // the result summary already attached. The cap keeps each retained
  // result under 4 KB; we never need the full result body.
  const buffered = await streamSession(jsonlPath, toolResultByUseId)

  let sidechainRun = 0
  let sidechainCounter = 0

  for (const line of buffered) {
    if (line.isSidechain) {
      sidechainRun += 1
      continue
    }
    if (sidechainRun > 0) {
      entries.push({
        kind: 'sidechain',
        id: `sc-${sidechainCounter++}`,
        messageCount: sidechainRun
      })
      sidechainRun = 0
    }

    if (line.role === 'user') {
      const markdown = userTextOf(line.content)
      if (markdown.length > 0) {
        entries.push(messageEntry(line.uuid, 'user', line.timestamp, markdown))
      }
      continue
    }

    // Assistant: walk content blocks in order so tool calls slot
    // between the text bubbles that surround them.
    let textBuffer: string[] = []
    let textIndex = 0
    const flushText = (): void => {
      if (textBuffer.length === 0) return
      const md = textBuffer.join('\n\n').trim()
      textBuffer = []
      if (md.length === 0) return
      entries.push(
        messageEntry(
          line.uuid + (textIndex > 0 ? `-t${textIndex}` : ''),
          'assistant',
          line.timestamp,
          md
        )
      )
      textIndex += 1
    }
    for (const block of asArray(line.content)) {
      if (!isObject(block)) continue
      const type = block['type']
      if (type === 'text') {
        const text = block['text']
        if (typeof text === 'string' && text.length > 0) textBuffer.push(text)
      } else if (type === 'tool_use') {
        flushText()
        const entry = toolEntry(block, line.timestamp, toolResultByUseId)
        if (entry) entries.push(entry)
      }
      // thinking and any other block types: skipped at this fidelity.
    }
    flushText()
  }

  if (sidechainRun > 0) {
    entries.push({
      kind: 'sidechain',
      id: `sc-${sidechainCounter++}`,
      messageCount: sidechainRun
    })
  }

  return entries
}

// --- Streaming pass -------------------------------------------------------

interface BufferedLine {
  uuid: string
  role: 'user' | 'assistant'
  isSidechain: boolean
  timestamp: string | null
  /** Either a string (user with plain prompt) or the JSONL content array. */
  content: unknown
}

async function streamSession(
  jsonlPath: string,
  toolResultByUseId: Map<string, string>
): Promise<BufferedLine[]> {
  const lines: BufferedLine[] = []
  let syntheticId = 0
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const raw of rl) {
      const obj = parseLine(raw)
      if (!obj) continue
      const type = obj['type']
      if (type !== 'user' && type !== 'assistant') continue

      const message = obj['message']
      const content = isObject(message)
        ? (message as Record<string, unknown>)['content']
        : undefined

      // Harvest tool_result lookups; cap or drop oversized.
      if (type === 'user' && Array.isArray(content)) {
        for (const block of content) {
          if (!isObject(block)) continue
          if (block['type'] !== 'tool_result') continue
          const id = block['tool_use_id']
          if (typeof id !== 'string') continue
          const text = stringifyToolResult(block['content'])
          if (text !== null) toolResultByUseId.set(id, text)
        }
      }

      const uuid =
        typeof obj['uuid'] === 'string' && (obj['uuid'] as string).length > 0
          ? (obj['uuid'] as string)
          : `synthetic-${syntheticId++}`
      const timestamp = typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : null
      const isSidechain = obj['isSidechain'] === true

      lines.push({ uuid, role: type, isSidechain, timestamp, content })
    }
  } finally {
    rl.close()
    stream.close()
  }
  return lines
}

/**
 * Coerce a `tool_result.content` field to a single string, dropping
 * results that exceed the cap entirely so the bytes never leave this
 * function. The content field can be:
 *   - a string (most tools)
 *   - an array of `{type:'text', text:string}` blocks (some tools)
 * Returns `null` when the content was oversized, empty, or unparseable.
 */
function stringifyToolResult(content: unknown): string | null {
  let raw: string
  if (typeof content === 'string') {
    raw = content
  } else if (Array.isArray(content)) {
    const parts: string[] = []
    let used = 0
    for (const item of content) {
      if (!isObject(item)) continue
      if (item['type'] !== 'text') continue
      const text = item['text']
      if (typeof text !== 'string') continue
      used += text.length
      if (used > TOOL_RESULT_MAX_CHARS) return null
      parts.push(text)
    }
    raw = parts.join('\n')
  } else {
    return null
  }
  if (raw.length === 0) return null
  if (raw.length > TOOL_RESULT_MAX_CHARS) return null
  return raw
}

// --- Entry construction ---------------------------------------------------

function messageEntry(
  uuid: string,
  role: 'user' | 'assistant',
  timestamp: string | null,
  markdown: string
): TranscriptMessage {
  return { kind: 'message', uuid, role, timestamp, markdown }
}

function toolEntry(
  block: Record<string, unknown>,
  timestamp: string | null,
  toolResultByUseId: Map<string, string>
): TranscriptToolEvent | null {
  const id = block['id']
  const name = block['name']
  if (typeof name !== 'string' || name.length === 0) return null
  const input = isObject(block['input']) ? (block['input'] as Record<string, unknown>) : {}
  const keyArg = keyArgFor(name, input)
  const resultRaw =
    typeof id === 'string' ? toolResultByUseId.get(id) ?? null : null
  const resultSummary = resultRaw !== null ? summarizeResult(name, resultRaw) : null

  return {
    kind: 'tool',
    uuid: typeof id === 'string' && id.length > 0 ? id : `tool-${name}-${timestamp ?? ''}`,
    timestamp,
    tool: name,
    keyArg,
    resultSummary
  }
}

function keyArgFor(tool: string, input: Record<string, unknown>): string {
  let raw: unknown
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      raw = input['file_path'] ?? input['notebook_path']
      break
    case 'Bash':
      raw = input['command']
      break
    case 'Glob':
    case 'Grep':
      raw = input['pattern']
      break
    case 'WebFetch':
      raw = input['url']
      break
    case 'WebSearch':
      raw = input['query']
      break
    default:
      raw = ''
  }
  if (typeof raw !== 'string') return ''
  const collapsed = raw.split(/\r?\n/, 1)[0]!.trim()
  if (collapsed.length <= KEY_ARG_MAX_CHARS) return collapsed
  return collapsed.slice(0, KEY_ARG_MAX_CHARS - 1).trimEnd() + '…'
}

function summarizeResult(tool: string, raw: string): string | null {
  if (raw.length === 0) return null
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      // Tool already says exactly what it did; the result body is
      // either the file contents (huge) or a confirmation we already
      // imply with the verb.
      return null
    case 'Glob':
    case 'Grep': {
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length === 0) return 'no matches'
      // Glob results are typically a list of paths; if the first line
      // looks like one, give a match count.
      const looksLikeList = lines.length > 1 || /[\/.]/.test(lines[0]!)
      if (looksLikeList) return `${lines.length} match${lines.length === 1 ? '' : 'es'}`
      return truncateForSummary(lines[0]!)
    }
    case 'Bash': {
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
      if (lines.length === 0) return 'no output'
      return truncateForSummary(lines[0]!)
    }
    default: {
      const firstLine = raw.split(/\r?\n/, 1)[0]!.trim()
      if (firstLine.length === 0) return null
      return truncateForSummary(firstLine)
    }
  }
}

function truncateForSummary(s: string): string {
  if (s.length <= RESULT_SUMMARY_MAX_CHARS) return s
  return s.slice(0, RESULT_SUMMARY_MAX_CHARS - 1).trimEnd() + '…'
}

// --- Helpers --------------------------------------------------------------

function userTextOf(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!isObject(item)) continue
    if ((item as Record<string, unknown>)['type'] !== 'text') continue
    const text = (item as Record<string, unknown>)['text']
    if (typeof text === 'string' && text.length > 0) parts.push(text)
  }
  return parts.join('\n\n').trim()
}

function asArray(content: unknown): unknown[] {
  if (Array.isArray(content)) return content
  return []
}

async function summarizeSession(jsonlPath: string, sessionId: string): Promise<SessionSummary> {
  let title = ''
  let preview = ''
  let lastActivityAt: string | null = null

  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const obj = parseLine(line)
      if (!obj) continue

      const ts = obj['timestamp']
      if (typeof ts === 'string' && (!lastActivityAt || ts > lastActivityAt)) {
        lastActivityAt = ts
      }

      if (!title) {
        const firstUser = extractFirstUserText(obj)
        if (firstUser) {
          title = titleOf(firstUser)
          preview = previewOf(firstUser)
        }
      }
    }
  } finally {
    rl.close()
    stream.close()
  }

  return { sessionId, title, preview, lastActivityAt }
}

function extractFirstUserText(obj: Record<string, unknown>): string | null {
  if (obj['isSidechain'] === true) return null
  if (obj['type'] !== 'user') return null
  const message = obj['message']
  if (!isObject(message)) return null
  const text = userTextOf((message as Record<string, unknown>)['content'])
  return text.length > 0 ? text : null
}

function titleOf(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? ''
  const collapsed = firstLine.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= TITLE_MAX_CHARS) return collapsed
  return collapsed.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + '…'
}

function previewOf(raw: string): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd())
  while (lines.length > 0 && lines[0]!.length === 0) lines.shift()
  return lines.slice(0, PREVIEW_MAX_LINES).join('\n')
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as unknown
    if (!isObject(obj)) return null
    return obj
  } catch {
    return null
  }
}

function byNewestActivity(a: SessionSummary, b: SessionSummary): number {
  if (a.lastActivityAt === b.lastActivityAt) return 0
  if (a.lastActivityAt === null) return 1
  if (b.lastActivityAt === null) return -1
  return a.lastActivityAt < b.lastActivityAt ? 1 : -1
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
