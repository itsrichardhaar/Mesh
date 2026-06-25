import { useState } from 'react'
import { ProjectSidebar } from '../components/ProjectSidebar'

export function HomeScreen(): JSX.Element {
  const [selectedEncodedPath, setSelectedEncodedPath] = useState<string | null>(null)

  return (
    <div className="home-screen">
      <ProjectSidebar
        selectedEncodedPath={selectedEncodedPath}
        onSelect={setSelectedEncodedPath}
      />
      <main className="detail-pane" aria-label="Project detail">
        {selectedEncodedPath ? (
          <PlaceholderProjectDetail encodedPath={selectedEncodedPath} />
        ) : (
          <PlaceholderEmptyDetail />
        )}
      </main>
    </div>
  )
}

function PlaceholderEmptyDetail(): JSX.Element {
  return (
    <div className="detail-placeholder">
      <h1>Mesh</h1>
      <p className="detail-subtitle">AI workspace OS</p>
      <p className="detail-hint">Select a project from the sidebar.</p>
    </div>
  )
}

function PlaceholderProjectDetail({ encodedPath }: { encodedPath: string }): JSX.Element {
  // Slice 4 replaces this with the project header + Stats Row + Analysis panel.
  return (
    <div className="detail-placeholder">
      <p className="detail-hint">
        Project selected. Header, Stats Row, and Analysis panel land in Slice 4.
      </p>
      <p className="detail-encoded-path">{encodedPath}</p>
    </div>
  )
}
