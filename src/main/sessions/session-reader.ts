import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { SessionSummary, TranscriptMessage } from '@shared/sessions'

const TITLE_MAX_CHARS = 60
const PREVIEW_MAX_LINES = 3

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
 * Stream a single Session's JSONL and return the user/assistant text
 * messages in file order. System events (`mode`, `permission-mode`,
 * `file-history-snapshot`, etc.) and sidechain events are dropped.
 * For user messages we accept either a string content or an array of
 * content blocks (taking only `text` blocks; `tool_result` blocks are
 * skipped — they land in Slice 15). Assistant messages contribute the
 * concatenation of their `text` blocks; `thinking` and `tool_use` are
 * skipped at this fidelity. Messages with empty text after extraction
 * are dropped so the renderer never has to render blank rows.
 */
export async function readTranscript(
  projectDir: string,
  sessionId: string
): Promise<TranscriptMessage[]> {
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`)
  let s
  try {
    s = await stat(jsonlPath)
    if (!s.isFile()) return []
  } catch {
    return []
  }

  const messages: TranscriptMessage[] = []
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const obj = parseLine(line)
      if (!obj) continue
      if (obj['isSidechain'] === true) continue
      const type = obj['type']
      if (type !== 'user' && type !== 'assistant') continue

      const uuid = typeof obj['uuid'] === 'string' ? (obj['uuid'] as string) : ''
      const timestamp = typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : null
      const markdown = extractText(obj)
      if (!markdown) continue

      messages.push({
        uuid,
        role: type,
        timestamp,
        markdown
      })
    }
  } finally {
    rl.close()
    stream.close()
  }
  return messages
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

/**
 * Pull a usable user-prompt string out of one line. Returns `null`
 * unless the line is a non-sidechain user message whose extracted text
 * is non-empty.
 */
function extractFirstUserText(obj: Record<string, unknown>): string | null {
  if (obj['isSidechain'] === true) return null
  if (obj['type'] !== 'user') return null
  const text = extractText(obj)
  return text.length > 0 ? text : null
}

/** Concatenate the text-bearing blocks of a user/assistant message. */
function extractText(obj: Record<string, unknown>): string {
  const message = obj['message']
  if (!isObject(message)) return ''
  const content = (message as Record<string, unknown>)['content']
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!isObject(item)) continue
    const block = item as Record<string, unknown>
    if (block['type'] !== 'text') continue
    const text = block['text']
    if (typeof text === 'string' && text.length > 0) parts.push(text)
  }
  return parts.join('\n\n').trim()
}

function titleOf(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? ''
  const collapsed = firstLine.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= TITLE_MAX_CHARS) return collapsed
  return collapsed.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + '…'
}

function previewOf(raw: string): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd())
  // Drop fully-blank leading lines so the preview always carries signal.
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
