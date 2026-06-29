import { exec } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  Project,
  StoredAnalysis
} from '@shared/types'
import {
  listSessions,
  readLatestAwaySummary,
  readTranscript
} from '../sessions/session-reader'
import { transcriptDigest } from './prompt'
import type { SessionSummary } from '@shared/sessions'

const SESSION_PICK_LIMIT = 5
const SESSION_WINDOW_DAYS = 14
/** Sessions newer than this prefer the live transcript over `away_summary`. */
const PROSE_PREFERENCE_AGE_HOURS = 6
const GIT_LOG_MAX_COMMITS = 50

const execAsync = promisify(exec)

/**
 * Structured input the orchestrator hands to `ClaudeClient.analyzeProject`.
 * Kept separate from the wire-level `AnalyzeProjectInput` (just two
 * strings) so tests can pin the shape independently of prompt phrasing.
 */
export interface AnalysisInputContext {
  project: { name: string; sourcePath: string }
  /** CLAUDE.md content if present at the project root. */
  claudeMd: string | null
  /** Summary text from the prior Analysis if one exists. */
  priorAnalysisSummary: string | null
  /** Newest-first commit one-liners since the prior Analysis. */
  gitActivity: string[]
  sessions: SessionInputBlock[]
}

export interface SessionInputBlock {
  sessionId: string
  /** ISO 8601 of the newest event in the Session, or null when unknown. */
  lastActivityAt: string | null
  /** First user prompt, truncated for the header. */
  title: string
  /** Either `away_summary` (older sessions) or `prose+tools` (recent / no summary). */
  compressionKind: 'away_summary' | 'prose'
  /** The compressed body itself. */
  body: string
}

export interface OrchestratorDeps {
  /** `~/.claude/projects/` — used to locate the per-Project JSONL folder. */
  claudeProjectsDir: string
  /** Override for testability; defaults to the real wall clock. */
  now?: () => Date
  /** Lets tests stand in a fake git runner. */
  runGitLog?: (cwd: string, since: string | null) => Promise<string[]>
  /** Slice 11 read path; orchestrator threads this in so it can be mocked. */
  loadPriorAnalysis?: (encodedPath: string) => Promise<StoredAnalysis | null>
}

/**
 * Builds the full Analyze input (Sessions + project context + git
 * activity), calls the LLM through whichever `ModelClient` was wired
 * in, and returns the validated three-section output. Persistence
 * lives in `analyses/repository.ts` — this orchestrator is the pure
 * "compute the request, validate the response" layer.
 */
export class AnalysisOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(project: Project, client: ModelClient): Promise<{
    output: AnalysisOutput
    sourceSessionCount: number
    lastAnalyzedSha: string | null
  }> {
    const input = await this.buildInput(project)
    const wireInput = renderWireInput(input)
    const output = await client.analyzeProject(wireInput)
    const lastAnalyzedSha = input.gitActivity[0]?.split(' ')[0] ?? null
    return {
      output,
      sourceSessionCount: input.sessions.length,
      lastAnalyzedSha
    }
  }

  /** Exposed for direct testing — produces the structured context. */
  async buildInput(project: Project): Promise<AnalysisInputContext> {
    const now = (this.deps.now ?? defaultNow)()
    const projectDir = join(this.deps.claudeProjectsDir, project.encodedPath)
    const summaries = await listSessions(projectDir)
    const picked = pickSessions(summaries, now)
    const sessions = await Promise.all(
      picked.map((s) => this.compressSession(projectDir, s, now))
    )

    const claudeMd = project.sourceMissing ? null : await readClaudeMd(project.sourcePath)
    const priorAnalysis = this.deps.loadPriorAnalysis
      ? await this.deps.loadPriorAnalysis(project.encodedPath)
      : null
    const priorAnalysisSummary = priorAnalysis?.content?.summaryMarkdown ?? null

    const gitActivity = project.sourceMissing
      ? []
      : await runGitActivity(
          this.deps.runGitLog,
          project.sourcePath,
          priorAnalysis?.generatedAt ?? null
        )

    return {
      project: { name: project.name, sourcePath: project.sourcePath },
      claudeMd,
      priorAnalysisSummary,
      gitActivity,
      sessions
    }
  }

  private async compressSession(
    projectDir: string,
    summary: SessionSummary,
    now: Date
  ): Promise<SessionInputBlock> {
    const ageHours = summary.lastActivityAt
      ? (now.getTime() - new Date(summary.lastActivityAt).getTime()) / (1000 * 60 * 60)
      : Number.POSITIVE_INFINITY
    const prefersAway = ageHours >= PROSE_PREFERENCE_AGE_HOURS
    if (prefersAway) {
      const away = await readLatestAwaySummary(projectDir, summary.sessionId)
      if (away !== null) {
        return {
          sessionId: summary.sessionId,
          lastActivityAt: summary.lastActivityAt,
          title: summary.title,
          compressionKind: 'away_summary',
          body: away
        }
      }
    }
    const entries = await readTranscript(projectDir, summary.sessionId)
    return {
      sessionId: summary.sessionId,
      lastActivityAt: summary.lastActivityAt,
      title: summary.title,
      compressionKind: 'prose',
      body: transcriptDigest(entries)
    }
  }
}

function defaultNow(): Date {
  return new Date()
}

function pickSessions(summaries: SessionSummary[], now: Date): SessionSummary[] {
  const cutoff = new Date(now.getTime() - SESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const cutoffIso = cutoff.toISOString()
  return summaries
    .filter((s) => s.lastActivityAt !== null && s.lastActivityAt >= cutoffIso)
    .slice(0, SESSION_PICK_LIMIT)
}

async function readClaudeMd(sourcePath: string): Promise<string | null> {
  const candidate = join(sourcePath, 'CLAUDE.md')
  try {
    const s = await stat(candidate)
    if (!s.isFile()) return null
    return await readFile(candidate, 'utf-8')
  } catch {
    return null
  }
}

async function runGitActivity(
  override: OrchestratorDeps['runGitLog'],
  sourcePath: string,
  sinceIso: string | null
): Promise<string[]> {
  if (override) return override(sourcePath, sinceIso)
  try {
    const sinceArg = sinceIso ? `--since='${sinceIso}'` : `-n ${GIT_LOG_MAX_COMMITS}`
    const { stdout } = await execAsync(
      `git log --pretty=format:'%h %s' ${sinceArg}`,
      { cwd: sourcePath, maxBuffer: 256 * 1024, timeout: 5000 }
    )
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, GIT_LOG_MAX_COMMITS)
  } catch {
    // Not a git repo, git unavailable, or sandboxed — silently skip.
    return []
  }
}

// --- Wire-level prompt rendering -----------------------------------------

/**
 * Provider-agnostic instructions describing the task and the desired
 * three-section output. Each `ModelClient` appends its own output-format
 * directive before sending — Claude's `CLAUDE_OUTPUT_FORMAT_SUFFIX`
 * speaks "tool_use", OpenAI's `OPENAI_OUTPUT_FORMAT_SUFFIX` speaks
 * "Native Structured Outputs". Exported for snapshot tests that pin
 * the rendered wire prompts per provider.
 */
export const SYSTEM_PROMPT = `You are Mesh's daily-summary assistant.

You receive a digest of one Project's recent Claude Code Sessions and produce a three-section briefing. Stay grounded in the digest — do not invent activity that isn't reflected in it. Be concrete about file paths, libraries, and decisions; avoid generic phrasing.

Sections:
1. Summary of Recent Sessions — one or two paragraphs (markdown) covering what was done, what's working, and what's been deferred.
2. Next Steps — concrete, ordered actions the user could take next. Each item should be actionable and specific.
3. Suggested Improvements — observations about the code, workflow, or planning that would compound over time. Each item should call out a specific opportunity, not abstract advice.`

function renderWireInput(input: AnalysisInputContext): AnalyzeProjectInput {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: renderUserPrompt(input)
  }
}

function renderUserPrompt(input: AnalysisInputContext): string {
  const parts: string[] = []
  parts.push(`# Project: ${input.project.name}`)
  parts.push(`Source: ${input.project.sourcePath}`)
  if (input.claudeMd) {
    parts.push('\n## CLAUDE.md')
    parts.push(input.claudeMd.length > 8000 ? input.claudeMd.slice(0, 8000) + '\n…(truncated)' : input.claudeMd)
  }
  if (input.priorAnalysisSummary) {
    parts.push('\n## Prior Analysis Summary')
    parts.push(input.priorAnalysisSummary)
  }
  if (input.gitActivity.length > 0) {
    parts.push('\n## Recent Commits (since prior analysis)')
    parts.push(input.gitActivity.map((l) => `- ${l}`).join('\n'))
  }
  parts.push('\n## Sessions')
  if (input.sessions.length === 0) {
    parts.push('_No sessions in the picked window._')
  } else {
    for (const s of input.sessions) {
      parts.push(`\n### Session ${s.sessionId} — ${s.title || '(untitled)'}`)
      if (s.lastActivityAt) parts.push(`Last activity: ${s.lastActivityAt}`)
      parts.push(`Compression: ${s.compressionKind}`)
      parts.push('')
      parts.push(s.body)
    }
  }
  return parts.join('\n')
}
