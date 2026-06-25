import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  insertAnalysis,
  latestForProject,
  type AnalysisInsert
} from '@main/analyses/repository'

describe('analyses repository', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('returns null when no Analysis has ever been written for a Project', () => {
    expect(latestForProject(db, '-no-analyses')).toBeNull()
  })

  it('round-trips a successful Analysis (write → read → parsed lists)', () => {
    const insert: AnalysisInsert = {
      encodedPath: '-Users-test-Mesh',
      generatedAt: '2026-06-25T10:00:00.000Z',
      status: 'ok',
      provider: 'claude',
      model: 'claude-haiku-4-5',
      sourceSessionCount: 3,
      lastAnalyzedSha: 'deadbeef',
      content: {
        summaryMarkdown: '# What changed\nWe shipped the migration.',
        nextSteps: [{ text: 'Wire the orchestrator' }, { text: 'Render the result' }],
        suggestedImprovements: [{ text: 'Add markdown rendering in Slice 15' }]
      }
    }
    insertAnalysis(db, insert)

    const got = latestForProject(db, '-Users-test-Mesh')
    expect(got).not.toBeNull()
    expect(got?.status).toBe('ok')
    expect(got?.provider).toBe('claude')
    expect(got?.model).toBe('claude-haiku-4-5')
    expect(got?.sourceSessionCount).toBe(3)
    expect(got?.lastAnalyzedSha).toBe('deadbeef')
    expect(got?.errorMessage).toBeNull()
    expect(got?.content?.summaryMarkdown).toBe('# What changed\nWe shipped the migration.')
    expect(got?.content?.nextSteps).toEqual([
      { text: 'Wire the orchestrator' },
      { text: 'Render the result' }
    ])
    expect(got?.content?.suggestedImprovements).toEqual([
      { text: 'Add markdown rendering in Slice 15' }
    ])
  })

  it('returns the newest row when history accumulates', () => {
    insertAnalysis(db, base('2026-06-25T10:00:00.000Z'))
    insertAnalysis(db, {
      ...base('2026-06-25T12:00:00.000Z'),
      content: {
        summaryMarkdown: 'newer',
        nextSteps: [],
        suggestedImprovements: []
      }
    })
    insertAnalysis(db, {
      ...base('2026-06-25T11:00:00.000Z'),
      content: {
        summaryMarkdown: 'middle',
        nextSteps: [],
        suggestedImprovements: []
      }
    })

    const got = latestForProject(db, '-history')
    expect(got?.generatedAt).toBe('2026-06-25T12:00:00.000Z')
    expect(got?.content?.summaryMarkdown).toBe('newer')
  })

  it('keeps older rows after a new write (history retained)', () => {
    insertAnalysis(db, base('2026-06-25T10:00:00.000Z'))
    insertAnalysis(db, base('2026-06-25T11:00:00.000Z'))
    insertAnalysis(db, base('2026-06-25T12:00:00.000Z'))
    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM analyses WHERE encoded_path = ?')
      .get('-history') as { n: number }
    expect(n).toBe(3)
  })

  it('persists a failed Analysis with status=failed and content=null', () => {
    insertAnalysis(db, {
      encodedPath: '-failed',
      generatedAt: '2026-06-25T13:00:00.000Z',
      status: 'failed',
      errorMessage: '401 invalid api key',
      provider: 'claude',
      model: 'claude-haiku-4-5'
    })
    const got = latestForProject(db, '-failed')
    expect(got?.status).toBe('failed')
    expect(got?.errorMessage).toBe('401 invalid api key')
    expect(got?.content).toBeNull()
  })

  it('throws on a primary-key collision rather than silently overwriting', () => {
    insertAnalysis(db, base('2026-06-25T10:00:00.000Z'))
    expect(() => insertAnalysis(db, base('2026-06-25T10:00:00.000Z'))).toThrow()
  })

  it('isolates Analyses by encodedPath', () => {
    insertAnalysis(db, { ...base('2026-06-25T10:00:00.000Z'), encodedPath: '-alpha' })
    insertAnalysis(db, { ...base('2026-06-25T11:00:00.000Z'), encodedPath: '-beta' })
    expect(latestForProject(db, '-alpha')?.generatedAt).toBe('2026-06-25T10:00:00.000Z')
    expect(latestForProject(db, '-beta')?.generatedAt).toBe('2026-06-25T11:00:00.000Z')
  })

  it('content lists default to [] when JSON is unexpectedly malformed', () => {
    // Insert a row directly so we can stuff in garbage JSON the repository
    // would normally never write.
    db.prepare(
      `INSERT INTO analyses (
         encoded_path, generated_at, status, error_message,
         provider, model,
         source_session_count, last_analyzed_sha,
         summary_md, next_steps_json, suggested_improvements_json
       ) VALUES (?, ?, 'ok', NULL, 'claude', 'claude-haiku-4-5', NULL, NULL, 'summary', 'not json', 'also not json')`
    ).run('-malformed', '2026-06-25T10:00:00.000Z')
    const got = latestForProject(db, '-malformed')
    expect(got?.content?.nextSteps).toEqual([])
    expect(got?.content?.suggestedImprovements).toEqual([])
  })
})

function base(generatedAt: string): AnalysisInsert {
  return {
    encodedPath: '-history',
    generatedAt,
    status: 'ok',
    provider: 'claude',
    model: 'claude-haiku-4-5',
    content: {
      summaryMarkdown: 'snapshot',
      nextSteps: [],
      suggestedImprovements: []
    }
  }
}
