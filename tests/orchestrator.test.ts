import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AnalysisOutput,
  AnalyzeProjectInput,
  ModelClient,
  Project,
  StoredAnalysis
} from '@shared/types'
import { AnalysisOrchestrator } from '@main/analyses/orchestrator'

const PROJECT: Project = {
  encodedPath: '-Users-rh-Desktop-Demo',
  sourcePath: '',
  name: 'Demo',
  autoSubtitle: null,
  activity: '2026-06-25T20:00:00.000Z',
  sourceMissing: false,
  hidden: false
}

function makeClient(
  output: AnalysisOutput
): { client: ModelClient; calls: AnalyzeProjectInput[] } {
  const calls: AnalyzeProjectInput[] = []
  const client: ModelClient = {
    provider: 'claude',
    model: 'claude-haiku-4-5',
    validate: async () => ({ ok: true }),
    analyzeProject: async (input) => {
      calls.push(input)
      return output
    }
  }
  return { client, calls }
}

const FIXED_OUTPUT: AnalysisOutput = {
  summaryMarkdown: 'Did stuff.',
  nextSteps: [{ text: 'Ship it.' }],
  suggestedImprovements: [{ text: 'Add tests.' }]
}

describe('AnalysisOrchestrator', () => {
  let claudeProjectsDir: string
  let sourceRoot: string
  let project: Project

  beforeEach(async () => {
    claudeProjectsDir = await mkdtemp(join(tmpdir(), 'mesh-cp-'))
    sourceRoot = await mkdtemp(join(tmpdir(), 'mesh-src-'))
    project = { ...PROJECT, sourcePath: sourceRoot }
    await mkdir(join(claudeProjectsDir, project.encodedPath), { recursive: true })
  })

  afterEach(async () => {
    await rm(claudeProjectsDir, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  })

  async function writeSession(
    sessionId: string,
    lines: Array<Record<string, unknown>>
  ): Promise<void> {
    await writeFile(
      join(claudeProjectsDir, project.encodedPath, `${sessionId}.jsonl`),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf-8'
    )
  }

  function makeOrchestrator(opts: {
    now?: Date
    priorAnalysis?: StoredAnalysis | null
    gitLog?: string[]
  } = {}): AnalysisOrchestrator {
    return new AnalysisOrchestrator({
      claudeProjectsDir,
      now: () => opts.now ?? new Date('2026-06-25T20:00:00.000Z'),
      loadPriorAnalysis: async () => opts.priorAnalysis ?? null,
      runGitLog: async () => opts.gitLog ?? []
    })
  }

  it('picks at most 5 sessions, sorted newest-first, all within the 14-day window', async () => {
    for (let i = 0; i < 7; i++) {
      const days = i
      const ts = new Date(`2026-06-25T20:00:00.000Z`)
      ts.setDate(ts.getDate() - days)
      await writeSession(`s${i}`, [
        { type: 'user', uuid: `u${i}`, timestamp: ts.toISOString(), message: { role: 'user', content: `prompt ${i}` } }
      ])
    }
    // One very old session that must be excluded by the 14-day filter.
    await writeSession('old', [
      { type: 'user', uuid: 'uold', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'ancient' } }
    ])

    const o = makeOrchestrator()
    const input = await o.buildInput(project)
    expect(input.sessions).toHaveLength(5)
    expect(input.sessions[0]!.sessionId).toBe('s0')
    expect(input.sessions[4]!.sessionId).toBe('s4')
    expect(input.sessions.find((s) => s.sessionId === 'old')).toBeUndefined()
  })

  it('uses away_summary for sessions older than 6h when available', async () => {
    await writeSession('old-with-summary', [
      { type: 'user', uuid: 'u1', timestamp: '2026-06-20T08:00:00.000Z', message: { role: 'user', content: 'whatever' } },
      {
        type: 'system',
        subtype: 'away_summary',
        content: 'Old checkpoint text.',
        timestamp: '2026-06-20T08:30:00.000Z'
      }
    ])
    const o = makeOrchestrator()
    const input = await o.buildInput(project)
    const block = input.sessions[0]!
    expect(block.compressionKind).toBe('away_summary')
    expect(block.body).toBe('Old checkpoint text.')
  })

  it('uses prose+tools digest for sessions younger than 6h regardless of away_summary presence', async () => {
    // Session ended 1h before "now" — must NOT use away_summary even
    // though one is present.
    await writeSession('fresh', [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-25T18:50:00.000Z',
        message: { role: 'user', content: 'fix the bug' }
      },
      {
        type: 'system',
        subtype: 'away_summary',
        content: 'should not appear in the digest',
        timestamp: '2026-06-25T19:00:00.000Z'
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-25T19:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }] }
      }
    ])
    const o = makeOrchestrator({ now: new Date('2026-06-25T20:00:00.000Z') })
    const input = await o.buildInput(project)
    const block = input.sessions[0]!
    expect(block.compressionKind).toBe('prose')
    expect(block.body).toContain('User: fix the bug')
    expect(block.body).toContain('Assistant: on it')
    expect(block.body).not.toContain('should not appear')
  })

  it('falls back to prose when an old session has no away_summary', async () => {
    await writeSession('old-no-summary', [
      { type: 'user', uuid: 'u1', timestamp: '2026-06-20T08:00:00.000Z', message: { role: 'user', content: 'hi' } }
    ])
    const o = makeOrchestrator()
    const input = await o.buildInput(project)
    expect(input.sessions[0]!.compressionKind).toBe('prose')
  })

  it('passes the assembled prompt to the model client', async () => {
    await writeSession('s1', [
      { type: 'user', uuid: 'u1', timestamp: '2026-06-25T18:00:00.000Z', message: { role: 'user', content: 'fix bug' } }
    ])
    const { client, calls } = makeClient(FIXED_OUTPUT)
    const o = makeOrchestrator()
    const result = await o.run(project, client)
    expect(result.output).toEqual(FIXED_OUTPUT)
    expect(result.sourceSessionCount).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.systemPrompt).toMatch(/emit_daily_summary/)
    expect(calls[0]!.userPrompt).toMatch(/Demo/)
    expect(calls[0]!.userPrompt).toMatch(/Sessions/)
  })

  it('includes CLAUDE.md, prior analysis, and git activity in the prompt when available', async () => {
    await writeFile(join(sourceRoot, 'CLAUDE.md'), '# Project guide\nDo X.', 'utf-8')
    await writeSession('s1', [
      { type: 'user', uuid: 'u1', timestamp: '2026-06-25T18:00:00.000Z', message: { role: 'user', content: 'hey' } }
    ])
    const prior: StoredAnalysis = {
      encodedPath: project.encodedPath,
      generatedAt: '2026-06-24T00:00:00.000Z',
      status: 'ok',
      errorMessage: null,
      provider: 'claude',
      model: 'claude-haiku-4-5',
      sourceSessionCount: 1,
      lastAnalyzedSha: null,
      content: {
        summaryMarkdown: 'Previous summary.',
        nextSteps: [],
        suggestedImprovements: []
      }
    }
    const o = makeOrchestrator({
      priorAnalysis: prior,
      gitLog: ['abc1234 feat: shipping it', 'def5678 fix: typo']
    })
    const input = await o.buildInput(project)
    expect(input.claudeMd).toMatch(/Do X/)
    expect(input.priorAnalysisSummary).toBe('Previous summary.')
    expect(input.gitActivity).toEqual(['abc1234 feat: shipping it', 'def5678 fix: typo'])

    const { client, calls } = makeClient(FIXED_OUTPUT)
    const result = await o.run(project, client)
    expect(result.lastAnalyzedSha).toBe('abc1234')
    expect(calls[0]!.userPrompt).toMatch(/Do X/)
    expect(calls[0]!.userPrompt).toMatch(/Previous summary/)
    expect(calls[0]!.userPrompt).toMatch(/abc1234 feat: shipping it/)
  })

  it('emits an empty sessions block (not a crash) when no sessions exist', async () => {
    const { client, calls } = makeClient(FIXED_OUTPUT)
    const o = makeOrchestrator()
    const result = await o.run(project, client)
    expect(result.sourceSessionCount).toBe(0)
    expect(calls[0]!.userPrompt).toMatch(/No sessions in the picked window/)
  })

  it('does not consult the filesystem for Source-Missing projects', async () => {
    const missing: Project = { ...project, sourceMissing: true, sourcePath: '/nope/does/not/exist' }
    const gitSpy = vi.fn(async () => ['x123 unused'])
    const o = new AnalysisOrchestrator({
      claudeProjectsDir,
      now: () => new Date('2026-06-25T20:00:00.000Z'),
      runGitLog: gitSpy
    })
    const input = await o.buildInput(missing)
    expect(input.claudeMd).toBeNull()
    expect(input.gitActivity).toEqual([])
    expect(gitSpy).not.toHaveBeenCalled()
  })
})
