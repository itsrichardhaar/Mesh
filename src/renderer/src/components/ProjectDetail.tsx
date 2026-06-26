import { useEffect, useState } from 'react'
import type { Project, ProjectStats, StoredAnalysis } from '@shared/types'
import { findModel } from '@shared/models'
import { relativeTime } from '../util/relativeTime'

type StatsState =
  | { status: 'loading' }
  | { status: 'ok'; stats: ProjectStats }
  | { status: 'error'; message: string }

type AnalysisState =
  | { status: 'loading' }
  | { status: 'ok'; analysis: StoredAnalysis | null }
  | { status: 'error'; message: string }

/**
 * Three distinct error sources for the Analyze action:
 *  - `preflight`: the click never reached the LLM (no key, project
 *    can't be enumerated, etc.). Renderer shows the message; latest
 *    stored row is untouched.
 *  - `persisted-failed`: latest row in the DB carries `status: 'failed'`
 *    — the IPC layer wrote it after the orchestrator or model threw.
 *    Renderer hides any stale content and renders the row's
 *    `errorMessage` instead.
 *  - The `ok` branch covers the happy path / no-row-yet.
 */
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'preflight-error'; message: string }

interface Props {
  project: Project
  onBack: () => void
}

export function ProjectDetail({ project, onBack }: Props): JSX.Element {
  const [stats, setStats] = useState<StatsState>({ status: 'loading' })
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'loading' })
  const [run, setRun] = useState<RunState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    setStats({ status: 'loading' })
    window.api.projects
      .stats(project.encodedPath)
      .then((s) => {
        if (cancelled) return
        setStats({ status: 'ok', stats: s })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStats({
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      cancelled = true
    }
  }, [project.encodedPath])

  useEffect(() => {
    let cancelled = false
    setAnalysis({ status: 'loading' })
    window.api.analyses
      .latest(project.encodedPath)
      .then((row) => {
        if (cancelled) return
        setAnalysis({ status: 'ok', analysis: row })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setAnalysis({
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      cancelled = true
    }
  }, [project.encodedPath])

  // Drop any in-flight error when the user navigates to a different
  // Project so it doesn't bleed across.
  useEffect(() => {
    setRun({ status: 'idle' })
  }, [project.encodedPath])

  const analyze = async (): Promise<void> => {
    setRun({ status: 'running' })
    try {
      const next = await window.api.analyses.run(project.encodedPath)
      setAnalysis({ status: 'ok', analysis: next })
      setRun({ status: 'idle' })
    } catch (err) {
      // Pre-flight: the IPC threw rather than persisting a row.
      // Surface a friendly message; log the original to the console
      // so the full stack is recoverable when debugging.
      // eslint-disable-next-line no-console
      console.error('[mesh] analyses.run preflight error:', err)
      setRun({
        status: 'preflight-error',
        message: friendly(err)
      })
    }
  }

  return (
    <div className="project-detail">
      <button
        type="button"
        className="project-detail-back"
        onClick={onBack}
        aria-label="Back to home"
      >
        <span aria-hidden="true">‹</span> Home
      </button>
      <header className="project-detail-header">
        <h1 className="project-detail-name">{project.name}</h1>
        {project.autoSubtitle && (
          <p className="project-detail-subtitle">{project.autoSubtitle}</p>
        )}
      </header>

      <StatsRow project={project} state={stats} />

      <AnalyzeArea
        project={project}
        analysis={analysis}
        run={run}
        onAnalyze={() => void analyze()}
      />

      <AnalysisPanel state={analysis} />
    </div>
  )
}

function StatsRow({ project, state }: { project: Project; state: StatsState }): JSX.Element {
  const sessions = state.status === 'ok' ? String(state.stats.sessionCount) : '—'
  const files = state.status === 'ok' ? String(state.stats.filesTouchedCount) : '—'
  const lastActivity =
    state.status === 'ok'
      ? formatLastActivity(state.stats.lastActivityAt ?? project.activity)
      : '—'

  return (
    <dl className="stats-row" aria-label="Project statistics">
      <Stat label="Sessions" value={sessions} />
      <Stat label="Files Touched" value={files} />
      <Stat label="Last Activity" value={lastActivity} />
    </dl>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="stat">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
    </div>
  )
}

function AnalyzeArea({
  project,
  analysis,
  run,
  onAnalyze
}: {
  project: Project
  analysis: AnalysisState
  run: RunState
  onAnalyze: () => void
}): JSX.Element {
  const banner = pickBanner(analysis, run)
  return (
    <div className="analyze-area">
      {banner && <AnalyzeBanner banner={banner} onRetry={onAnalyze} />}
      <button
        type="button"
        className="analyze-button"
        disabled={run.status === 'running' || project.sourceMissing}
        onClick={onAnalyze}
        title={
          project.sourceMissing
            ? 'Source path is missing on disk — can’t analyze.'
            : undefined
        }
      >
        {run.status === 'running' ? 'Analyzing…' : 'Analyze'}
      </button>
    </div>
  )
}

type Banner =
  | { tone: 'info'; message: string }
  | { tone: 'success'; message: string }
  | { tone: 'error'; message: string; retry: true }

function pickBanner(analysis: AnalysisState, run: RunState): Banner | null {
  if (run.status === 'running') {
    return { tone: 'info', message: 'Analyzing…' }
  }
  if (run.status === 'preflight-error') {
    return { tone: 'error', message: run.message, retry: true }
  }
  if (analysis.status !== 'ok' || analysis.analysis === null) {
    return null
  }
  const row = analysis.analysis
  if (row.status === 'failed') {
    return {
      tone: 'error',
      message: row.errorMessage ?? 'Analysis failed.',
      retry: true
    }
  }
  const count = row.sourceSessionCount ?? 0
  const word = count === 1 ? 'session' : 'sessions'
  return {
    tone: 'success',
    message: `Analyzed from ${count} ${word} (last 14 days) · ${relativeTime(row.generatedAt)}`
  }
}

function AnalyzeBanner({
  banner,
  onRetry
}: {
  banner: Banner
  onRetry: () => void
}): JSX.Element {
  const isError = banner.tone === 'error'
  return (
    <div
      className={`analyze-banner analyze-banner-${banner.tone}`}
      role={isError ? 'alert' : 'status'}
    >
      {banner.tone === 'info' && (
        <span className="analyze-banner-spinner" aria-hidden="true" />
      )}
      <span className="analyze-banner-message">{banner.message}</span>
      {isError && 'retry' in banner && (
        <button
          type="button"
          className="analyze-banner-retry"
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  )
}

function AnalysisPanel({ state }: { state: AnalysisState }): JSX.Element {
  if (state.status === 'loading') {
    return (
      <section className="analysis-empty" aria-label="Latest analysis">
        <p>Loading…</p>
      </section>
    )
  }
  if (state.status === 'error') {
    return (
      <section className="analysis-empty" aria-label="Latest analysis" role="alert">
        <p>Couldn’t load Analysis: {state.message}</p>
      </section>
    )
  }
  if (state.analysis === null) {
    return (
      <section className="analysis-empty" aria-label="Latest analysis">
        <p>Not analyzed yet</p>
      </section>
    )
  }
  // Failed rows are represented entirely by the banner above — we
  // suppress the content section here so the user isn't reading stale
  // analysis pulled from a row that pre-dates the failure.
  if (state.analysis.status === 'failed') {
    return <></>
  }
  return <AnalysisView analysis={state.analysis} />
}

function AnalysisView({ analysis }: { analysis: StoredAnalysis }): JSX.Element {
  const content = analysis.content
  if (!content) {
    return (
      <section className="analysis-empty" aria-label="Latest analysis">
        <p>Not analyzed yet</p>
      </section>
    )
  }

  return (
    <section className="analysis" aria-label="Latest analysis">
      <h2 className="analysis-section-heading">Summary of Recent Sessions</h2>
      <div className="analysis-summary">{content.summaryMarkdown}</div>

      {content.nextSteps.length > 0 && (
        <>
          <h2 className="analysis-section-heading">Next Steps</h2>
          <ol className="analysis-list analysis-list-ordered">
            {content.nextSteps.map((item, i) => (
              <li key={`${i}:${item.text}`}>{item.text}</li>
            ))}
          </ol>
        </>
      )}

      {content.suggestedImprovements.length > 0 && (
        <>
          <h2 className="analysis-section-heading">Suggested Improvements</h2>
          <ul className="analysis-list">
            {content.suggestedImprovements.map((item, i) => (
              <li key={`${i}:${item.text}`}>{item.text}</li>
            ))}
          </ul>
        </>
      )}

      <AttributionFooter analysis={analysis} />
    </section>
  )
}

function AttributionFooter({ analysis }: { analysis: StoredAnalysis }): JSX.Element {
  const model = findModel(analysis.model)
  const modelLabel = model ? model.label : analysis.model
  const providerLabel = capitalize(analysis.provider)
  return (
    <footer className="analysis-attribution">
      <span>
        via {providerLabel} · {modelLabel}
      </span>
      <span>· {relativeTime(analysis.generatedAt)}</span>
    </footer>
  )
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value
}

/**
 * Strip raw HTTP-ish noise from a pre-flight error before showing it
 * to the user. The full error is logged to the console, so debugging
 * isn't impaired; we just don't want "Error invoking remote method
 * 'analyses:run': Error: 401 …" surfacing as a user-facing banner.
 */
function friendly(err: unknown): string {
  if (err instanceof Error) {
    let m = err.message
    m = m.replace(/^Error invoking remote method '[^']+': Error: /, '')
    m = m.replace(/^Error invoking remote method '[^']+': /, '')
    m = m.replace(/^\d{3}\s+/, '')
    return m
  }
  return String(err)
}

function formatLastActivity(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
