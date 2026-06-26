import type { Project } from '@shared/types'
import { OnboardingBanner } from '../components/OnboardingBanner'
import { ProjectCards } from '../components/ProjectCards'
import { ProjectDetail } from '../components/ProjectDetail'
import { ProjectSidebar } from '../components/ProjectSidebar'
import { useProjectList } from '../hooks/useProjectList'

interface Props {
  onOpenWorkspace: (project: Project) => void
  onOpenSettings: () => void
  selectedEncodedPath: string | null
  onSelect: (encodedPath: string | null) => void
}

export function HomeScreen({
  onOpenWorkspace,
  onOpenSettings,
  selectedEncodedPath,
  onSelect
}: Props): JSX.Element {
  const { state, refresh } = useProjectList()

  const selected =
    state.status === 'ok'
      ? state.projects.find((p) => p.encodedPath === selectedEncodedPath) ?? null
      : null

  return (
    <div className="home-screen">
      <OnboardingBanner onOpenSettings={onOpenSettings} />
      <div className="home-screen-body">
        <ProjectSidebar
          state={state}
          refresh={refresh}
          selectedEncodedPath={selectedEncodedPath}
          onSelect={onSelect}
          onOpen={onOpenWorkspace}
        />
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
            <ProjectCards
              projects={state.projects}
              onSelect={onSelect}
              onOpenWorkspace={onOpenWorkspace}
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
