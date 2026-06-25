import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { FileTree } from '../components/FileTree'

interface Props {
  project: Project
  visible: boolean
  onBack: () => void
}

/**
 * Slice 13's three-column shell. File tree on the left, Sessions list
 * stub in the middle (Slice 14 fills it), content pane stub on the
 * right (Slices 14–18 fill it). Visibility is driven by the parent so
 * the Workspace can stay mounted (display:none) when the user goes
 * back to Home — that's how scroll position and tree expand state
 * survive the round-trip per PRD.
 */
export function WorkspaceScreen({ project, visible, onBack }: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)

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
          <p className="workspace-stub">Sessions list lands in Slice 14.</p>
        </section>

        <section className="workspace-content-column" aria-label="Content pane">
          <p className="workspace-stub">Select a Session or file.</p>
        </section>
      </div>
    </div>
  )
}
