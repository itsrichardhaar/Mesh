import { useState } from 'react'
import type { Project } from '@shared/types'
import { ProjectDetail } from '../components/ProjectDetail'
import { ProjectSidebar } from '../components/ProjectSidebar'
import { useProjectList } from '../hooks/useProjectList'

interface Props {
  onOpenWorkspace: (project: Project) => void
}

export function HomeScreen({ onOpenWorkspace }: Props): JSX.Element {
  const { state, refresh } = useProjectList()
  const [selectedEncodedPath, setSelectedEncodedPath] = useState<string | null>(null)

  const selected =
    state.status === 'ok'
      ? state.projects.find((p) => p.encodedPath === selectedEncodedPath) ?? null
      : null

  return (
    <div className="home-screen">
      <ProjectSidebar
        state={state}
        refresh={refresh}
        selectedEncodedPath={selectedEncodedPath}
        onSelect={setSelectedEncodedPath}
        onOpen={onOpenWorkspace}
      />
      <main className="detail-pane" aria-label="Project detail">
        {selected ? <ProjectDetail project={selected} /> : <EmptyDetail />}
      </main>
    </div>
  )
}

function EmptyDetail(): JSX.Element {
  return (
    <div className="detail-placeholder">
      <h1>Mesh</h1>
      <p className="detail-subtitle">AI workspace OS</p>
      <p className="detail-hint">Select a project from the sidebar.</p>
    </div>
  )
}
