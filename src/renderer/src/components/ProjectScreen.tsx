import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Lightbulb,
  ListChecks,
  Plus,
  type LucideIcon
} from 'lucide-react'
import type { Project, ProjectStats, StoredAnalysis, UsageProjectSummary } from '@shared/types'
import { findModel } from '@shared/models'
import { useActiveProviderModel } from '../hooks/useActiveProviderModel'
import { useProjectIndicator } from '../hooks/useLiveSessions'
import { relativeTime } from '../util/relativeTime'
import { tildify } from '../util/tildify'
import { ActivitySpinner } from './ActivitySpinner'

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
  onOpenWorkspace: () => void
}

/**
 * The **Project Screen** (v7 / Slice 56) — a single Project's overview,
 * the middle altitude between the Home Screen (all Projects) and the
 * Workspace Screen (deep work). Shown in the Home right pane when a
 * Project is selected in the sidebar; the sidebar stays put so switching
 * Projects is one click. Top to bottom: Stats Row + Usage strip, the
 * Analyze bar, and the Analysis in a collapsible accordion beneath it.
 */
export function ProjectScreen({ project, onBack, onOpenWorkspace }: Props): JSX.Element {
  const [stats, setStats] = useState<StatsState>({ status: 'loading' })
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'loading' })
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [usage, setUsage] = useState<UsageProjectSummary | null>(null)
  // The Analysis accordion is collapsed by default; a fresh Analyze
  // expands it (the user's grill decision), and it stays toggleable.
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const { isLive, isActive } = useProjectIndicator(project.encodedPath)

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

  // Per-Project Usage strip (Slice 56).
  useEffect(() => {
    let cancelled = false
    setUsage(null)
    window.api.usage
      .getProjectSummary(project.encodedPath)
      .then((s) => {
        if (!cancelled) setUsage(s)
      })
      .catch(() => {
        // Usage cache may be mid-ingest or empty; the strip just hides.
      })
    return () => {
      cancelled = true
    }
  }, [project.encodedPath])

  // Drop any in-flight error and collapse the Analysis accordion when the
  // user navigates to a different Project so nothing bleeds across.
  useEffect(() => {
    setRun({ status: 'idle' })
    setAnalysisOpen(false)
  }, [project.encodedPath])

  const analyze = async (): Promise<void> => {
    setRun({ status: 'running' })
    try {
      const next = await window.api.analyses.run(project.encodedPath)
      setAnalysis({ status: 'ok', analysis: next })
      setRun({ status: 'idle' })
      setAnalysisOpen(true) // reveal the fresh Analysis (grill decision)
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
      <div className="project-detail-actions">
        <button
          type="button"
          className="project-detail-back"
          onClick={onBack}
          aria-label="Back to home"
        >
          <span aria-hidden="true">‹</span> Home
        </button>
        <button
          type="button"
          className="project-detail-open-workspace"
          onClick={onOpenWorkspace}
          disabled={project.sourceMissing}
          aria-label={`Open ${project.name} Workspace`}
          title={
            project.sourceMissing
              ? "Workspace unavailable — source folder doesn't exist on disk"
              : 'Open Workspace'
          }
        >
          Open Workspace <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      <header
        className={`project-detail-header${isLive ? ' project-detail-header-live' : ''}`}
      >
        <h1 className="project-detail-name">
          <span>{project.name}</span>
          {isActive && <ActivitySpinner size="small" ariaLabel="Project active" />}
        </h1>
        <span
          className="project-detail-path"
          title={project.sourcePath}
        >
          {tildify(project.sourcePath)}
        </span>
      </header>

      <StatsRow project={project} state={stats} />

      <UsageStrip usage={usage} />

      <AnalyzeBar
        project={project}
        analysis={analysis}
        run={run}
        onAnalyze={() => void analyze()}
      />

      <AnalysisAccordion
        state={analysis}
        open={analysisOpen}
        onToggle={() => setAnalysisOpen((v) => !v)}
      />
    </div>
  )
}

const usageTokenFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
})

/** Per-Project Usage strip: tokens + Notional Cost. Hidden until loaded / when empty. */
function UsageStrip({ usage }: { usage: UsageProjectSummary | null }): JSX.Element | null {
  if (!usage || usage.eventCount === 0) return null
  return (
    <div className="usage-strip" aria-label="Project usage">
      <div className="usage-strip-metric">
        <span className="usage-strip-value">{usageTokenFmt.format(usage.tokens)}</span>
        <span className="usage-strip-label">tokens</span>
      </div>
      <div className="usage-strip-metric">
        <span className="usage-strip-value">${usage.costUsd.toFixed(2)}</span>
        <span className="usage-strip-label">notional · at API rates</span>
      </div>
    </div>
  )
}

/** Collapsible Analysis section (Slice 56). Collapsed by default; Analyze opens it. */
function AnalysisAccordion({
  state,
  open,
  onToggle
}: {
  state: AnalysisState
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const hint =
    state.status === 'ok' && state.analysis?.status === 'ok'
      ? `Updated ${relativeTime(state.analysis.generatedAt)}`
      : state.status === 'ok' && state.analysis === null
        ? 'Not analyzed yet'
        : ''
  return (
    <section className="analysis-accordion" aria-label="Analysis">
      <button
        type="button"
        className="analysis-accordion-header"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={`analysis-accordion-chevron${open ? ' analysis-accordion-chevron-open' : ''}`}
        />
        <span className="analysis-accordion-title">Analysis</span>
        {hint && <span className="analysis-accordion-hint">{hint}</span>}
      </button>
      {open && <AnalysisPanel state={state} />}
    </section>
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

type BarTone = 'neutral' | 'info' | 'success' | 'error'

type BarView =
  | { tone: 'neutral'; role: 'status'; message: string; action: 'Analyze' }
  | { tone: 'info'; role: 'status'; message: string; action: null }
  | { tone: 'success'; role: 'status'; message: string; action: 'Re-analyze' }
  | { tone: 'error'; role: 'alert'; message: string; action: 'Try again' }

function AnalyzeBar({
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
  const view = pickBarView(analysis, run)
  // Slice 36: "via Provider · Model" subtitle inside the button so the
  // user can glance-check what's about to run before clicking. Live-
  // updates when Active Provider or selected Model changes in Settings.
  const activeBlurb = useActiveProviderModel()
  return (
    <div className={`analyze-bar analyze-bar-${view.tone}`} role={view.role}>
      {view.tone === 'info' && <ActivitySpinner size="small" ariaLabel="Analyzing" />}
      <span className="analyze-bar-message">{view.message}</span>
      {view.action && (
        <button
          type="button"
          className="analyze-bar-action"
          disabled={project.sourceMissing}
          onClick={onAnalyze}
          title={
            project.sourceMissing
              ? "Source path is missing on disk — can't analyze."
              : undefined
          }
        >
          <span className="analyze-bar-action-main">
            <Plus size={14} aria-hidden="true" />
            {view.action}
          </span>
          {activeBlurb && activeBlurb.modelLabel && (
            <span className="analyze-bar-action-meta">
              via {activeBlurb.providerLabel} · {activeBlurb.modelLabel}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

function pickBarView(analysis: AnalysisState, run: RunState): BarView {
  if (run.status === 'running') {
    return { tone: 'info', role: 'status', message: 'Analyzing…', action: null }
  }
  if (run.status === 'preflight-error') {
    return { tone: 'error', role: 'alert', message: run.message, action: 'Try again' }
  }
  if (analysis.status !== 'ok' || analysis.analysis === null) {
    return {
      tone: 'neutral',
      role: 'status',
      message: 'Not yet analyzed',
      action: 'Analyze'
    }
  }
  const row = analysis.analysis
  if (row.status === 'failed') {
    return {
      tone: 'error',
      role: 'alert',
      message: row.errorMessage ?? 'Analysis failed.',
      action: 'Try again'
    }
  }
  const count = row.sourceSessionCount ?? 0
  const word = count === 1 ? 'session' : 'sessions'
  const model = findModel(row.model)
  const modelLabel = model?.label ?? row.model
  return {
    tone: 'success',
    role: 'status',
    message: `Analyzed from ${count} ${word} (last 14 days) · ${relativeTime(row.generatedAt)} · ${modelLabel}`,
    action: 'Re-analyze'
  }
}

/* `BarTone` is exported so future Analyze-bar consumers can extend the
   palette; kept local for now. */
export type { BarTone }

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
      <AnalysisSection icon={FileText} title="Summary of Recent Sessions">
        <div className="analysis-summary">{content.summaryMarkdown}</div>
      </AnalysisSection>

      {content.nextSteps.length > 0 && (
        <AnalysisSection icon={ListChecks} title="Next Steps">
          <ol className="analysis-numbered-list">
            {content.nextSteps.map((item, i) => (
              <li key={`${i}:${item.text}`}>
                <span className="analysis-numbered-badge" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="analysis-list-text">{item.text}</span>
              </li>
            ))}
          </ol>
        </AnalysisSection>
      )}

      {content.suggestedImprovements.length > 0 && (
        <AnalysisSection icon={Lightbulb} title="Suggested Improvements">
          <ul className="analysis-dotted-list">
            {content.suggestedImprovements.map((item, i) => (
              <li key={`${i}:${item.text}`}>
                <span className="analysis-list-text">{item.text}</span>
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
    </section>
  )
}

function AnalysisSection({
  icon: Icon,
  title,
  children
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="analysis-section">
      <h2 className="analysis-section-heading">
        <Icon size={16} aria-hidden={true} />
        <span>{title}</span>
      </h2>
      {children}
    </div>
  )
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
