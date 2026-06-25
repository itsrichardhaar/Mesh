import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; projects: Project[] }
  | { status: 'error'; message: string }

interface Props {
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
}

export function ProjectSidebar({ selectedEncodedPath, onSelect }: Props): JSX.Element {
  const [state, setState] = useState<FetchState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    window.api.projects
      .list()
      .then((projects) => {
        if (cancelled) return
        setState({ status: 'ok', projects })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside className="sidebar" aria-label="Projects">
      <header className="sidebar-header">
        <h2>Projects</h2>
      </header>
      <SidebarBody state={state} selectedEncodedPath={selectedEncodedPath} onSelect={onSelect} />
    </aside>
  )
}

function SidebarBody({
  state,
  selectedEncodedPath,
  onSelect
}: {
  state: FetchState
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
}): JSX.Element {
  if (state.status === 'loading') {
    return <p className="sidebar-status">Loading…</p>
  }
  if (state.status === 'error') {
    return (
      <p className="sidebar-status sidebar-status-error">
        Couldn’t load projects: {state.message}
      </p>
    )
  }
  if (state.projects.length === 0) {
    return (
      <p className="sidebar-empty">
        No projects yet — open Claude Code in any directory to begin.
      </p>
    )
  }
  return (
    <ul className="project-list" role="list">
      {state.projects.map((p) => (
        <li key={p.encodedPath}>
          <button
            type="button"
            className={
              'project-row' + (p.encodedPath === selectedEncodedPath ? ' project-row-selected' : '')
            }
            onClick={() => onSelect(p.encodedPath)}
          >
            <span className="project-name">{p.name}</span>
            <span className="project-activity">{formatRelative(p.activity)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
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
