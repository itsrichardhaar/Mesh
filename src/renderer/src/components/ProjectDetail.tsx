import { useEffect, useState } from 'react'
import type { Project, ProjectStats } from '@shared/types'

type StatsState =
  | { status: 'loading' }
  | { status: 'ok'; stats: ProjectStats }
  | { status: 'error'; message: string }

interface Props {
  project: Project
}

export function ProjectDetail({ project }: Props): JSX.Element {
  const [stats, setStats] = useState<StatsState>({ status: 'loading' })

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

  return (
    <div className="project-detail">
      <header className="project-detail-header">
        <h1 className="project-detail-name">{project.name}</h1>
        {project.autoSubtitle && (
          <p className="project-detail-subtitle">{project.autoSubtitle}</p>
        )}
      </header>

      <StatsRow project={project} state={stats} />

      <section className="analysis-empty" aria-label="Latest analysis">
        <p>Not analyzed yet</p>
      </section>
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
