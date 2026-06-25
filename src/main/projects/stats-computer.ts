import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * Deterministic Project counters displayed in the Stats Row above an
 * Analysis. None of these involve the LLM — they're computed from
 * the on-disk JSONL session files.
 *
 * `lastActivityAt` is the most recent `timestamp` field observed
 * across all session lines, or `null` if no line carried one.
 */
export interface ProjectStats {
  sessionCount: number
  filesTouchedCount: number
  lastActivityAt: string | null
}

const FILE_TOOL_NAMES: ReadonlySet<string> = new Set(['Edit', 'Write', 'Read'])

/**
 * Walk every `.jsonl` in `projectDir` (one per Session), count Sessions,
 * collect the unique set of file paths that Edit/Write/Read tool calls
 * touched, and find the newest event timestamp.
 *
 * The reader is line-oriented and tolerant of malformed JSON — bad
 * lines are skipped without aborting the file. Files that can't be
 * opened or stat'd are skipped without aborting the Project.
 */
export async function compute(projectDir: string): Promise<ProjectStats> {
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return { sessionCount: 0, filesTouchedCount: 0, lastActivityAt: null }
  }

  const jsonlFiles: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue
    const full = join(projectDir, entry)
    try {
      const s = await stat(full)
      if (s.isFile()) jsonlFiles.push(full)
    } catch {
      // skip unreadable
    }
  }

  const filesTouched = new Set<string>()
  let lastActivityAt: string | null = null

  for (const file of jsonlFiles) {
    const result = await scanSession(file)
    for (const path of result.filesTouched) filesTouched.add(path)
    if (result.lastTimestamp && (!lastActivityAt || result.lastTimestamp > lastActivityAt)) {
      lastActivityAt = result.lastTimestamp
    }
  }

  return {
    sessionCount: jsonlFiles.length,
    filesTouchedCount: filesTouched.size,
    lastActivityAt
  }
}

interface SessionScanResult {
  filesTouched: Set<string>
  lastTimestamp: string | null
}

async function scanSession(jsonlPath: string): Promise<SessionScanResult> {
  const filesTouched = new Set<string>()
  let lastTimestamp: string | null = null

  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue
      }

      const ts = obj['timestamp']
      if (typeof ts === 'string' && (!lastTimestamp || ts > lastTimestamp)) {
        lastTimestamp = ts
      }

      collectToolUseFiles(obj, filesTouched)
    }
  } finally {
    rl.close()
    stream.close()
  }

  return { filesTouched, lastTimestamp }
}

function collectToolUseFiles(line: Record<string, unknown>, into: Set<string>): void {
  const message = line['message']
  if (!isObject(message)) return
  const content = (message as Record<string, unknown>)['content']
  if (!Array.isArray(content)) return
  for (const item of content) {
    if (!isObject(item)) continue
    const block = item as Record<string, unknown>
    if (block['type'] !== 'tool_use') continue
    const name = block['name']
    if (typeof name !== 'string' || !FILE_TOOL_NAMES.has(name)) continue
    const input = block['input']
    if (!isObject(input)) continue
    const filePath = (input as Record<string, unknown>)['file_path']
    if (typeof filePath === 'string' && filePath.length > 0) {
      into.add(filePath)
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
