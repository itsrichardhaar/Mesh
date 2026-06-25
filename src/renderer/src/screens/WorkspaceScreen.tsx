import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { FileTree } from '../components/FileTree'
import { SessionsList } from '../components/SessionsList'
import { Transcript } from '../components/Transcript'

interface Props {
  project: Project
  visible: boolean
  onBack: () => void
}

/**
 * Three-column Workspace: file tree (left), Sessions list (middle),
 * content pane (right). The right column shows the transcript of the
 * selected Session via `react-markdown` + `react-virtuoso`. Visibility
 * is driven by the parent so the Workspace can stay mounted
 * (display:none) when the user goes back to Home — that's how scroll
 * position, tree expand state, and the selected Session survive the
 * round-trip per PRD.
 */
export function WorkspaceScreen({ project, visible, onBack }: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  // Reset the selected session when the user opens a different
  // Project's Workspace so we don't try to read a sessionId that
  // doesn't belong to this Project.
  useEffect(() => {
    setSelectedSessionId(null)
  }, [project.encodedPath])

  // ⌘. routes through the application menu so the accelerator is
  // standard across screens; here we only act on it when the Workspace
  // is the visible screen.
  useEffect(() => {
    if (!visible) return
    const off = window.api.menu.onToggleHidden(() => setShowHidden((v) => !v))
    return off
  }, [visible])

  return (
    <div className="workspace-screen" hidden={!visible}>
      <header className="workspace-header">
        <button
          type="button"
          className="workspace-back"
          onClick={onBack}
          aria-label="Back to home"
        >
          <span aria-hidden="true">‹</span> Home
        </button>
        <div className="workspace-title">
          <span className="workspace-title-name">{project.name}</span>
          {project.autoSubtitle && (
            <span className="workspace-title-subtitle">{project.autoSubtitle}</span>
          )}
        </div>
        <div className="workspace-header-spacer" />
      </header>

      <div className="workspace-body">
        <aside className="workspace-tree-column" aria-label="File tree column">
          <div className="workspace-column-header">
            <span>Files</span>
            <button
              type="button"
              className={`workspace-hidden-toggle${showHidden ? ' workspace-hidden-toggle-on' : ''}`}
              onClick={() => setShowHidden((v) => !v)}
              title="Toggle hidden / gitignored files (⌘.)"
            >
              {showHidden ? 'Hide hidden' : 'Show hidden'}
            </button>
          </div>
          <FileTree encodedPath={project.encodedPath} showHidden={showHidden} />
        </aside>

        <section className="workspace-sessions-column" aria-label="Sessions column">
          <div className="workspace-column-header">
            <span>Sessions</span>
          </div>
          <SessionsList
            encodedPath={project.encodedPath}
            selectedSessionId={selectedSessionId}
            onSelect={setSelectedSessionId}
          />
        </section>

        <section className="workspace-content-column" aria-label="Content pane">
          {selectedSessionId ? (
            <Transcript
              key={`${project.encodedPath}:${selectedSessionId}`}
              encodedPath={project.encodedPath}
              sessionId={selectedSessionId}
            />
          ) : (
            <p className="workspace-stub">Select a Session.</p>
          )}
        </section>
      </div>
    </div>
  )
}
