import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import type { Project } from '@shared/types'
import type { ProjectListState } from '../hooks/useProjectList'
import { useProjectIndicator } from '../hooks/useLiveSessions'
import { useSidebarWidth } from '../hooks/useSidebarWidth'
import { ActivitySpinner } from './ActivitySpinner'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { buildProjectTree, type RunGroup, type SidebarNode } from './projectTree'

const PROJECTS_SIDEBAR_WIDTH_KEY = 'home.projectsSidebarWidth'
const PROJECTS_SIDEBAR_MIN_WIDTH = 200
const PROJECTS_SIDEBAR_MAX_WIDTH = 520
const PROJECTS_SIDEBAR_DEFAULT_WIDTH = 260

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

function isIdle(project: Project): boolean {
  if (project.sourceMissing) return false
  return Date.now() - new Date(project.activity).getTime() > FOURTEEN_DAYS_MS
}

/**
 * The tag shown on a Worktree Run row (ADR-0014): `no-mistakes` for a Gate Run,
 * `worktree` for a generic worktree. A labeled pill — meaning carried by text,
 * not hue (reduced-color-vision constraint).
 */
function runTagLabel(project: Project): string {
  return project.subtype === 'gate' ? 'no-mistakes' : 'worktree'
}

function runTagTitle(project: Project): string {
  return project.subtype === 'gate'
    ? 'no-mistakes gate run'
    : 'git worktree run'
}

/**
 * A Gate Run's row label (Slice C): what it built, resolved `intent → branch →
 * short runId` from its enrichment. Non-gate runs keep their worktree basename.
 * The full string rides the row `title` so an ellipsized intent stays readable.
 */
function runDisplayLabel(project: Project): string {
  if (project.subtype === 'gate' && project.gate) {
    return (
      project.gate.intent?.trim() ||
      project.gate.branch?.trim() ||
      project.gate.runId.slice(0, 8)
    )
  }
  return project.name
}

/** Pass/fail glyph for a Gate Run — shape + text, never hue alone (a11y). */
interface RunGlyph {
  char: string
  label: string
  className: string
}

function runStatusGlyph(project: Project): RunGlyph | null {
  if (project.subtype !== 'gate' || !project.gate) return null
  const { status, prState } = project.gate
  if (status === 'completed' || prState === 'merged') {
    return { char: '✓', label: 'passed', className: 'run-glyph-pass' }
  }
  if (status === 'failed') {
    return { char: '✗', label: 'failed', className: 'run-glyph-fail' }
  }
  return null
}

/** The text a run row matches sidebar search against — name plus intent/branch. */
function runSearchText(project: Project): string {
  return [project.name, project.gate?.intent, project.gate?.branch]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

interface ContextMenuState {
  encodedPath: string
  hidden: boolean
  muteNotifications: boolean
  x: number
  y: number
}

interface Props {
  state: ProjectListState
  refresh: () => void
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
  onOpen: (project: Project) => void
}

export function ProjectSidebar({
  state,
  refresh,
  selectedEncodedPath,
  onSelect,
  onOpen
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const { width, setWidth } = useSidebarWidth(PROJECTS_SIDEBAR_WIDTH_KEY, {
    defaultWidth: PROJECTS_SIDEBAR_DEFAULT_WIDTH,
    min: PROJECTS_SIDEBAR_MIN_WIDTH,
    max: PROJECTS_SIDEBAR_MAX_WIDTH
  })

  const handleToggleHidden = async (encodedPath: string, hidden: boolean): Promise<void> => {
    setMenu(null)
    try {
      await window.api.projects.update(encodedPath, { hidden: !hidden })
      refresh()
    } catch (err) {
      console.error('Failed to toggle hidden:', err)
    }
  }

  const handleToggleMute = async (encodedPath: string, muted: boolean): Promise<void> => {
    setMenu(null)
    try {
      await window.api.projects.update(encodedPath, { muteNotifications: !muted })
      refresh()
    } catch (err) {
      console.error('Failed to toggle mute:', err)
    }
  }

  return (
    <aside className="sidebar" aria-label="Projects" style={{ width }}>
      <SidebarResizeHandle
        width={width}
        min={PROJECTS_SIDEBAR_MIN_WIDTH}
        max={PROJECTS_SIDEBAR_MAX_WIDTH}
        onResize={setWidth}
        ariaLabel="Resize Projects sidebar"
      />
      <header className="sidebar-header">
        <button
          type="button"
          className="sidebar-group-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-controls="sidebar-projects-body"
        >
          {collapsed ? (
            <ChevronRight size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
          <span>Projects</span>
        </button>
      </header>

      {!collapsed && (
        <div id="sidebar-projects-body" className="sidebar-projects-body">
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
            onOpen={onOpen}
            onContextMenu={(e, p) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({
                encodedPath: p.encodedPath,
                hidden: p.hidden,
                muteNotifications: p.muteNotifications,
                x: e.clientX,
                y: e.clientY
              })
            }}
          />

          {state.status === 'ok' && (
            <SidebarFooter
              projects={state.projects}
              showHidden={showHidden}
              onToggle={() => setShowHidden((v) => !v)}
            />
          )}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          hidden={menu.hidden}
          muteNotifications={menu.muteNotifications}
          onToggleHidden={() => void handleToggleHidden(menu.encodedPath, menu.hidden)}
          onToggleMute={() => void handleToggleMute(menu.encodedPath, menu.muteNotifications)}
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
  onOpen,
  onContextMenu
}: {
  state: ProjectListState
  query: string
  showHidden: boolean
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
  onOpen: (project: Project) => void
  onContextMenu: (e: React.MouseEvent, project: Project) => void
}): JSX.Element {
  // Which run groups the user has manually expanded. Renderer-local and
  // session-only (ADR-0014): groups start collapsed and reset on reload.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroup = (key: string): void =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const nodes = useMemo(() => {
    if (state.status !== 'ok') return []
    if (showHidden) return buildProjectTree(state.projects)
    // A Worktree Run belongs to its Parent Project, so hiding the Parent takes
    // its runs with it — otherwise a hidden parent's runs would re-appear under a
    // raw-Encoded-Path synthetic header. Runs whose parent is genuinely
    // undiscovered still fall under a synthetic grouping node.
    const hiddenParents = new Set(
      state.projects.filter((p) => p.hidden).map((p) => p.encodedPath)
    )
    const afterHidden = state.projects.filter((p) => {
      if (p.hidden) return false
      if (
        p.kind === 'worktreeRun' &&
        p.parentEncodedPath !== null &&
        hiddenParents.has(p.parentEncodedPath)
      ) {
        return false
      }
      return true
    })
    return buildProjectTree(afterHidden)
  }, [state, showHidden])

  const needle = query.trim().toLowerCase()
  const rendered = useMemo(
    () => renderTree(nodes, needle, expandedGroups),
    [nodes, needle, expandedGroups]
  )

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
  if (rendered.length === 0) {
    return (
      <p className="sidebar-status">
        {query ? 'No projects match your search.' : 'No visible projects.'}
      </p>
    )
  }
  return (
    <ul className="project-list" role="list">
      {rendered.map((r) => (
        <NodeRow
          key={r.node.id}
          rendered={r}
          selectedEncodedPath={selectedEncodedPath}
          onSelect={onSelect}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
          onToggleGroup={toggleGroup}
        />
      ))}
    </ul>
  )
}

/** A node with search applied: which groups to show, whether each is expanded. */
interface RenderedNode {
  node: SidebarNode
  groups: Array<RunGroup & { expanded: boolean }>
}

/**
 * Apply the search needle and collapse state to the tree. A node shows when its
 * own name matches or when a child matches; a child match auto-expands the
 * group holding it (and narrows that group to the matches).
 */
function renderTree(
  nodes: SidebarNode[],
  needle: string,
  expandedGroups: Set<string>
): RenderedNode[] {
  const out: RenderedNode[] = []
  for (const node of nodes) {
    const nodeName = (node.type === 'project' ? node.project.name : node.label).toLowerCase()
    const parentMatches = !needle || nodeName.includes(needle)

    const groups: Array<RunGroup & { expanded: boolean }> = []
    for (const group of node.groups) {
      if (needle && !parentMatches) {
        const runs = group.runs.filter((r) => runSearchText(r).includes(needle))
        if (runs.length === 0) continue
        groups.push({ ...group, runs, expanded: true }) // reveal the match
      } else {
        groups.push({ ...group, expanded: expandedGroups.has(group.key) })
      }
    }

    if (parentMatches || groups.length > 0) out.push({ node, groups })
  }
  return out
}

function NodeRow({
  rendered,
  selectedEncodedPath,
  onSelect,
  onOpen,
  onContextMenu,
  onToggleGroup
}: {
  rendered: RenderedNode
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
  onOpen: (project: Project) => void
  onContextMenu: (e: React.MouseEvent, project: Project) => void
  onToggleGroup: (key: string) => void
}): JSX.Element {
  const { node, groups } = rendered
  return (
    <li>
      {node.type === 'project' ? (
        <ProjectRow
          project={node.project}
          isSelected={node.project.encodedPath === selectedEncodedPath}
          onSelect={onSelect}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ) : (
        <SyntheticNodeRow label={node.label} />
      )}
      {groups.map((group) => (
        <RunGroupDisclosure
          key={group.key}
          group={group}
          selectedEncodedPath={selectedEncodedPath}
          onSelect={onSelect}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
          onToggle={() => onToggleGroup(group.key)}
        />
      ))}
    </li>
  )
}

/**
 * A grouping-node header for Worktree Runs whose Parent Project isn't a
 * discovered Project (ADR-0014). Not selectable — it's a label, not a Project.
 */
function SyntheticNodeRow({ label }: { label: string }): JSX.Element {
  return (
    <div className="project-row project-row-synthetic" title="Runs of a repo with no Claude Code sessions of its own">
      <span className="project-name">{label}</span>
      <span className="sidebar-pill sidebar-pill-worktree">runs</span>
    </div>
  )
}

function RunGroupDisclosure({
  group,
  selectedEncodedPath,
  onSelect,
  onOpen,
  onContextMenu,
  onToggle
}: {
  group: RunGroup & { expanded: boolean }
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string) => void
  onOpen: (project: Project) => void
  onContextMenu: (e: React.MouseEvent, project: Project) => void
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="run-group">
      <button
        type="button"
        className="run-group-toggle"
        onClick={onToggle}
        aria-expanded={group.expanded}
      >
        {group.expanded ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )}
        <span>{group.label}</span>
      </button>
      {group.expanded && (
        <ul className="run-group-list" role="list">
          {group.runs.map((run) => (
            <li key={run.encodedPath}>
              <ProjectRow
                project={run}
                indented
                isSelected={run.encodedPath === selectedEncodedPath}
                onSelect={onSelect}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectRow({
  project: p,
  isSelected,
  indented = false,
  onSelect,
  onOpen,
  onContextMenu
}: {
  project: Project
  isSelected: boolean
  indented?: boolean
  onSelect: (encodedPath: string) => void
  onOpen: (project: Project) => void
  onContextMenu: (e: React.MouseEvent, project: Project) => void
}): JSX.Element {
  const { isLive, isActive } = useProjectIndicator(p.encodedPath)
  const idle = isIdle(p)
  const isRun = p.kind === 'worktreeRun'
  const classes = ['project-row']
  if (isSelected) classes.push('project-row-selected')
  // ADR-0014: a Worktree Run's deleted worktree is expected — suppress the
  // Source-Missing *alarm* styling for runs (the disk-gone behavior below still
  // keys off `sourceMissing`).
  if (p.sourceMissing && !isRun) classes.push('project-row-missing')
  if (isRun) classes.push('project-row-run')
  if (indented) classes.push('project-row-child')
  if (idle) classes.push('project-row-idle')
  if (p.hidden) classes.push('project-row-hidden')
  if (isLive) classes.push('project-row-live')

  // Slice C: a Gate Run reads like a validation run — a pass/fail glyph, an
  // intent-first label, its relative time, and (when it opened one) a PR link.
  const isGate = p.subtype === 'gate'
  const glyph = runStatusGlyph(p)
  const label = isRun ? runDisplayLabel(p) : p.name
  const prUrl = isRun ? (p.gate?.prUrl ?? null) : null

  const trailing = isRun ? (
    isGate ? (
      <>
        <span className="sidebar-pill sidebar-pill-worktree">{runTagLabel(p)}</span>
        <span className="project-activity">{formatRelative(p.activity)}</span>
      </>
    ) : (
      <span className="sidebar-pill sidebar-pill-worktree">{runTagLabel(p)}</span>
    )
  ) : p.sourceMissing ? (
    <span className="sidebar-pill sidebar-pill-missing">Source missing</span>
  ) : idle ? (
    <span className="sidebar-pill sidebar-pill-idle">Idle</span>
  ) : (
    <span className="project-activity">{formatRelative(p.activity)}</span>
  )

  const rowButton = (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={() => onSelect(p.encodedPath)}
      onDoubleClick={() => {
        if (!p.sourceMissing) onOpen(p)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !p.sourceMissing) {
          e.preventDefault()
          onOpen(p)
        }
      }}
      onContextMenu={(e) => onContextMenu(e, p)}
      title={
        isRun
          ? isGate
            ? runDisplayLabel(p)
            : runTagTitle(p)
          : p.sourceMissing
            ? 'Source folder no longer exists on disk'
            : undefined
      }
    >
      {glyph && (
        <span
          className={`run-glyph ${glyph.className}`}
          aria-label={glyph.label}
          title={glyph.label}
        >
          {glyph.char}
        </span>
      )}
      <span className="project-name">{label}</span>
      {isActive && <ActivitySpinner size="small" ariaLabel="Project active" />}
      {trailing}
    </button>
  )

  // The PR affordance is a sibling button, not nested inside the row button
  // (interactive elements can't nest); a flex wrapper keeps it on the row.
  if (prUrl) {
    return (
      <div className="project-row-wrap">
        {rowButton}
        <button
          type="button"
          className="run-pr-link"
          title="Open pull request"
          aria-label="Open pull request"
          onClick={(e) => {
            e.stopPropagation()
            void window.api.shell.openExternal(prUrl)
          }}
        >
          <ExternalLink size={12} aria-hidden="true" />
        </button>
      </div>
    )
  }
  return rowButton
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
  muteNotifications,
  onToggleHidden,
  onToggleMute,
  onDismiss
}: {
  x: number
  y: number
  hidden: boolean
  muteNotifications: boolean
  onToggleHidden: () => void
  onToggleMute: () => void
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
      <button
        type="button"
        className="context-menu-item"
        role="menuitem"
        onClick={onToggleHidden}
      >
        {hidden ? 'Unhide' : 'Hide'}
      </button>
      <button
        type="button"
        className="context-menu-item"
        role="menuitem"
        onClick={onToggleMute}
      >
        {muteNotifications ? 'Resume notifications' : 'Pause notifications'}
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
