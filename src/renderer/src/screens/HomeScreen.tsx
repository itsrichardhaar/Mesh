import type { Project } from '@shared/types'
import type { JumpToSessionInput } from '../components/NotificationsBell'
import { OnboardingBanner } from '../components/OnboardingBanner'
import { ProjectDetail } from '../components/ProjectDetail'
import { ProjectSidebar } from '../components/ProjectSidebar'
import { UsageDashboard } from '../components/UsageDashboard'
import { useProjectList } from '../hooks/useProjectList'

interface Props {
  onOpenWorkspace: (project: Project) => void
  onOpenSettings: () => void
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string | null) => void
  /** Hide the projects sidebar — toggled from the top-bar sidebar button. */
  sidebarCollapsed: boolean
  /** v7 / Slice 55: session-explorer rows jump via the App-level three-tier resolver. */
  onJumpToSession: (input: JumpToSessionInput) => Promise<void> | void
}

export function HomeScreen({
  onOpenWorkspace,
  onOpenSettings,
  selectedEncodedPath,
  onSelect,
  sidebarCollapsed,
  onJumpToSession
}: Props): JSX.Element {
  const { state, refresh } = useProjectList()

  const selected =
    state.status === 'ok'
      ? state.projects.find((p) => p.encodedPath === selectedEncodedPath) ?? null
      : null

  return (
    <div className="home-screen">
      <OnboardingBanner onOpenSettings={onOpenSettings} />
      <div
        className={`home-screen-body${sidebarCollapsed ? ' home-screen-body-sidebar-collapsed' : ''}`}
      >
        {!sidebarCollapsed && (
          <ProjectSidebar
            state={state}
            refresh={refresh}
            selectedEncodedPath={selectedEncodedPath}
            onSelect={onSelect}
            onOpen={onOpenWorkspace}
          />
        )}
        <main className="detail-pane" aria-label="Project detail">
          {selected ? (
            <ProjectDetail
              project={selected}
              onBack={() => onSelect(null)}
              onOpenWorkspace={() => onOpenWorkspace(selected)}
            />
          ) : state.status === 'ok' && state.projects.filter((p) => !p.hidden && !p.sourceMissing).length === 0 ? (
            <EmptyHome />
          ) : state.status === 'ok' ? (
            // v7 / Slice 54: the default Home pane is now the global Usage
            // dashboard (Recent Projects cards retired). The sidebar is
            // the Project navigator. Slice 55 adds by-project + sessions.
            <UsageDashboard
              projects={state.projects}
              onSelectProject={onSelect}
              onJumpToSession={onJumpToSession}
            />
          ) : (
            <EmptyDetail loading={state.status === 'loading'} />
          )}
        </main>
      </div>
    </div>
  )
}

function EmptyHome(): JSX.Element {
  return (
    <div className="home-empty">
      <h2>No projects yet</h2>
      <p>
        Mesh discovers projects automatically from <code>~/.claude/projects/</code>.
        Open Claude Code in any folder to get started — it'll appear here on next launch.
      </p>
    </div>
  )
}

function EmptyDetail({ loading }: { loading: boolean }): JSX.Element {
  return (
    <div className="detail-placeholder">
      <p className="detail-hint">{loading ? 'Loading projects…' : 'Select a project from the sidebar.'}</p>
    </div>
  )
}
