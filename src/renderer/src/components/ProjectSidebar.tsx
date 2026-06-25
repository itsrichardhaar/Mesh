import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import type { ProjectListState } from '../hooks/useProjectList'

interface ContextMenuState {
  encodedPath: string
  hidden: boolean
  x: number
  y: number
}

interface Props {
  state: ProjectListState
  refresh: () => void
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
}

export function ProjectSidebar({
  state,
  refresh,
  selectedEncodedPath,
  onSelect
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const handleToggleHidden = async (encodedPath: string, hidden: boolean): Promise<void> => {
    setMenu(null)
    try {
      await window.api.projects.update(encodedPath, { hidden: !hidden })
      refresh()
    } catch (err) {
      console.error('Failed to toggle hidden:', err)
    }
  }

  return (
    <aside className="sidebar" aria-label="Projects">
      <header className="sidebar-header">
        <h2>Projects</h2>
      </header>

      <div className="sidebar-search">
        <input
          type="search"
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search projects"
        />
      </div>

      <SidebarBody
        state={state}
        query={query}
        showHidden={showHidden}
        selectedEncodedPath={selectedEncodedPath}
        onSelect={onSelect}
        onContextMenu={(e, p) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ encodedPath: p.encodedPath, hidden: p.hidden, x: e.clientX, y: e.clientY })
        }}
      />

      {state.status === 'ok' && (
        <SidebarFooter
          projects={state.projects}
          showHidden={showHidden}
          onToggle={() => setShowHidden((v) => !v)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          hidden={menu.hidden}
          onAction={() => void handleToggleHidden(menu.encodedPath, menu.hidden)}
          onDismiss={() => setMenu(null)}
        />
      )}
    </aside>
  )
}

function SidebarBody({
  state,
  query,
  showHidden,
  selectedEncodedPath,
  onSelect,
  onContextMenu
}: {
  state: ProjectListState
  query: string
  showHidden: boolean
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
  onContextMenu: (e: React.MouseEvent, project: Project) => void
}): JSX.Element {
  const visible = useMemo(() => {
    if (state.status !== 'ok') return []
    const needle = query.trim().toLowerCase()
    return state.projects.filter((p) => {
      if (!showHidden && p.hidden) return false
      if (needle && !p.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [state, query, showHidden])

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
  if (visible.length === 0) {
    return (
      <p className="sidebar-status">
        {query ? 'No projects match your search.' : 'No visible projects.'}
      </p>
    )
  }
  return (
    <ul className="project-list" role="list">
      {visible.map((p) => {
        const classes = ['project-row']
        if (p.encodedPath === selectedEncodedPath) classes.push('project-row-selected')
        if (p.sourceMissing) classes.push('project-row-missing')
        if (p.hidden) classes.push('project-row-hidden')
        return (
          <li key={p.encodedPath}>
            <button
              type="button"
              className={classes.join(' ')}
              onClick={() => onSelect(p.encodedPath)}
              onContextMenu={(e) => onContextMenu(e, p)}
              title={p.sourceMissing ? 'Source folder no longer exists on disk' : undefined}
            >
              <span className="project-name">{p.name}</span>
              <span className="project-activity">{formatRelative(p.activity)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function SidebarFooter({
  projects,
  showHidden,
  onToggle
}: {
  projects: Project[]
  showHidden: boolean
  onToggle: () => void
}): JSX.Element | null {
  const hiddenCount = projects.filter((p) => p.hidden).length
  if (hiddenCount === 0 && !showHidden) return null
  return (
    <footer className="sidebar-footer">
      <button type="button" className="sidebar-footer-toggle" onClick={onToggle}>
        {showHidden ? `Hide Hidden (${hiddenCount})` : `Show Hidden (${hiddenCount})`}
      </button>
    </footer>
  )
}

function ContextMenu({
  x,
  y,
  hidden,
  onAction,
  onDismiss
}: {
  x: number
  y: number
  hidden: boolean
  onAction: () => void
  onDismiss: () => void
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: MouseEvent | KeyboardEvent): void => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') onDismiss()
        return
      }
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [onDismiss])

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="context-menu-item" role="menuitem" onClick={onAction}>
        {hidden ? 'Unhide' : 'Hide'}
      </button>
    </div>
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
