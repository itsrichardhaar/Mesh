import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { FileTree } from '../components/FileTree'
import { FileViewer } from '../components/FileViewer'
import { ModeTabs } from '../components/ModeTabs'
import { SessionsList } from '../components/SessionsList'
import { Transcript } from '../components/Transcript'
import { useWorkspaceMode } from '../hooks/useWorkspaceMode'

interface Props {
  project: Project
  visible: boolean
  onBack: () => void
}

/**
 * Three-column Workspace: file tree (left), Sessions list (middle),
 * Mode-toggled content pane (right). The right pane carries Mode Tabs
 * — Sessions (transcript) or File Editor (Monaco) — both kept mounted
 * with `display: none` when inactive so transcript scroll, selected
 * Session, and (later) live Pty Tabs survive the toggle. Workspace
 * visibility itself is driven by the parent so the whole screen can
 * stay mounted on the Home round-trip.
 */
export function WorkspaceScreen({ project, visible, onBack }: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedFileRelPath, setSelectedFileRelPath] = useState<string | null>(null)
  const { mode, setMode } = useWorkspaceMode(project.encodedPath)

  // Reset selections when the user opens a different Project so we
  // don't try to read a sessionId / relPath that doesn't belong here.
  useEffect(() => {
    setSelectedSessionId(null)
    setSelectedFileRelPath(null)
  }, [project.encodedPath])

  // ⌘. routes through the application menu so the accelerator is
  // standard across screens; here we only act on it when the Workspace
  // is the visible screen.
  useEffect(() => {
    if (!visible) return
    const off = window.api.menu.onToggleHidden(() => setShowHidden((v) => !v))
    return off
  }, [visible])

  const handleFileSelect = (relPath: string): void => {
    setSelectedFileRelPath(relPath)
    // Clicking a file while still in Sessions mode is the natural way
    // to indicate "I want to look at files now" — auto-switch.
    if (mode !== 'editor') setMode('editor')
  }

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
          <FileTree
            encodedPath={project.encodedPath}
            showHidden={showHidden}
            selectedRelPath={mode === 'editor' ? selectedFileRelPath : null}
            onFileSelect={handleFileSelect}
          />
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
          <ModeTabs mode={mode} onChange={setMode} />
          <div className="workspace-mode-pane" hidden={mode !== 'sessions'}>
            {selectedSessionId ? (
              <Transcript
                key={`${project.encodedPath}:${selectedSessionId}`}
                encodedPath={project.encodedPath}
                sessionId={selectedSessionId}
              />
            ) : (
              <p className="workspace-stub">Select a Session.</p>
            )}
          </div>
          <div className="workspace-mode-pane" hidden={mode !== 'editor'}>
            <FileViewer
              encodedPath={project.encodedPath}
              relPath={selectedFileRelPath}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
