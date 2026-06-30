import { useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Project, ProjectStats, StoredAnalysis } from '@shared/types'
import { relativeTime } from '../util/relativeTime'

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
const MAX_CARDS = 12

interface Props {
  projects: Project[]
  onSelect: (encodedPath: string) => void
  onOpenWorkspace: (project: Project) => void
}

/**
 * Home Screen cards grid (Slice 22). "Recent triage" view — the top 12
 * Projects active within the last 14 days, with Hidden and Source-Missing
 * Projects excluded. Beyond-window or hidden Projects live in the sidebar.
 *
 * Card-as-link accessibility pattern (Inclusive Components): the title is
 * the primary action (opens Analysis) with a stretched `::after` pseudo-
 * element covering the card surface; the `Open Workspace →` button is a
 * sibling positioned with `z-index` so it intercepts clicks before the
 * stretched surface does. Distinct `aria-label`s on each so screen readers
 * announce the destination clearly.
 */
export function ProjectCards({ projects, onSelect, onOpenWorkspace }: Props): JSX.Element {
  const visible = useMemo(() => {
    const cutoff = Date.now() - FOURTEEN_DAYS_MS
    return projects
      .filter((p) => !p.hidden && !p.sourceMissing)
      .filter((p) => new Date(p.activity).getTime() >= cutoff)
      .sort((a, b) => new Date(b.activity).getTime() - new Date(a.activity).getTime())
      .slice(0, MAX_CARDS)
  }, [projects])

  if (visible.length === 0) {
    return (
      <div className="cards-empty">
        <h2>No recent projects</h2>
        <p>
          Projects active in the last 14 days show up here. Open Claude Code in any
          folder to bring it in, or pick one from the sidebar to revisit older work.
        </p>
      </div>
    )
  }

  return (
    <ul className="project-cards-grid" role="list">
      {visible.map((p) => (
        <li key={p.encodedPath}>
          <ProjectCard project={p} onSelect={onSelect} onOpenWorkspace={onOpenWorkspace} />
        </li>
      ))}
    </ul>
  )
}

function ProjectCard({
  project,
  onSelect,
  onOpenWorkspace
}: {
  project: Project
  onSelect: (encodedPath: string) => void
  onOpenWorkspace: (project: Project) => void
}): JSX.Element {
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [analysis, setAnalysis] = useState<StoredAnalysis | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void window.api.projects.stats(project.encodedPath).then((s) => {
      if (!cancelled) setStats(s)
    })
    void window.api.analyses.latest(project.encodedPath).then((a) => {
      if (!cancelled) setAnalysis(a)
    })
    return () => {
      cancelled = true
    }
  }, [project.encodedPath])

  const analysisStatus =
    analysis === undefined
      ? null
      : analysis === null
        ? 'Never analyzed'
        : `Analyzed ${relativeTime(analysis.generatedAt)}`

  return (
    <article className="project-card">
      <h3 className="project-card-title">
        <button
          type="button"
          className="project-card-title-link"
          onClick={() => onSelect(project.encodedPath)}
          aria-label={`Open ${project.name} analysis`}
        >
          {project.name}
        </button>
      </h3>
      <p className="project-card-metrics">
        <span>{relativeTime(project.activity)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {stats ? `${stats.sessionCount} session${stats.sessionCount === 1 ? '' : 's'}` : '— sessions'}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {stats ? `${stats.filesTouchedCount} file${stats.filesTouchedCount === 1 ? '' : 's'}` : '— files'}
        </span>
      </p>
      {analysisStatus && <p className="project-card-analysis">{analysisStatus}</p>}
      <button
        type="button"
        className="project-card-cta"
        onClick={() => onOpenWorkspace(project)}
        aria-label={`Open ${project.name} Workspace`}
      >
        Open Workspace <ArrowRight size={14} aria-hidden="true" />
      </button>
    </article>
  )
}
