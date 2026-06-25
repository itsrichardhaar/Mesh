import { useEffect, useState } from 'react'
import type { Project, ProjectStats, StoredAnalysis } from '@shared/types'
import { findModel } from '@shared/models'

type StatsState =
  | { status: 'loading' }
  | { status: 'ok'; stats: ProjectStats }
  | { status: 'error'; message: string }

type AnalysisState =
  | { status: 'loading' }
  | { status: 'ok'; analysis: StoredAnalysis | null }
  | { status: 'error'; message: string }

interface Props {
  project: Project
}

export function ProjectDetail({ project }: Props): JSX.Element {
  const [stats, setStats] = useState<StatsState>({ status: 'loading' })
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'loading' })

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

  return (
    <div className="project-detail">
      <header className="project-detail-header">
        <h1 className="project-detail-name">{project.name}</h1>
        {project.autoSubtitle && (
          <p className="project-detail-subtitle">{project.autoSubtitle}</p>
        )}
      </header>

      <StatsRow project={project} state={stats} />

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

  return <AnalysisView analysis={state.analysis} />
}

function AnalysisView({ analysis }: { analysis: StoredAnalysis }): JSX.Element {
  if (analysis.status === 'failed') {
    return (
      <section className="analysis-failed" aria-label="Latest analysis" role="alert">
        <h2>Analysis failed</h2>
        <p>{analysis.errorMessage ?? 'Unknown error'}</p>
        <AttributionFooter analysis={analysis} />
      </section>
    )
  }

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
      <span>· {formatGeneratedAt(analysis.generatedAt)}</span>
    </footer>
  )
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value
}

function formatGeneratedAt(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
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
