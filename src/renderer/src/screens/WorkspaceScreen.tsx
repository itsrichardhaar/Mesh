import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Project } from '@shared/types'
import { FileTree } from '../components/FileTree'
import { FileViewer } from '../components/FileViewer'
import { ModeTabs } from '../components/ModeTabs'
import { PtyTabBar, type PtyTab } from '../components/PtyTabBar'
import { PtyView } from '../components/PtyView'
import { SessionsList } from '../components/SessionsList'
import { Transcript } from '../components/Transcript'
import { useFileTreeCollapsed } from '../hooks/useFileTreeCollapsed'
import { useWorkspaceMode } from '../hooks/useWorkspaceMode'

interface Props {
  project: Project
  visible: boolean
  onBack: () => void
}

interface PtySlot {
  /** Synthetic id assigned before the pty spawns so React keying is stable. */
  slotId: string
  sessionId: string
  /** Filled in once `pty.create` returns. Until then, key by `slotId`. */
  ptyId: string | null
  lastActivityAt: number
}

let nextSlotCounter = 0
function nextSlotId(): string {
  nextSlotCounter += 1
  return `pty-slot-${nextSlotCounter}`
}

/**
 * Three-column Workspace: file tree (left), Sessions list (middle),
 * Mode-toggled content pane (right). The right pane carries Mode Tabs
 * — Sessions (transcript) or File Editor (Monaco). The Sessions pane
 * itself hosts the Transcript reader plus a multi-tab strip of live
 * Pty Tabs (Slice 17): each `Resume` opens a fresh tab; existing
 * tabs stay DOM-mounted with `display: none` so scrollback survives
 * tab switches and Home round-trips.
 */
export function WorkspaceScreen({ project, visible, onBack }: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedFileRelPath, setSelectedFileRelPath] = useState<string | null>(null)
  const [ptyTabs, setPtyTabs] = useState<PtySlot[]>([])
  const [activePtySlotId, setActivePtySlotId] = useState<string | null>(null)
  const { mode, setMode } = useWorkspaceMode(project.encodedPath)
  const { collapsed: treeCollapsed, toggle: toggleTreeCollapsed } = useFileTreeCollapsed()

  // Reset Project-scoped state on Project switch so we don't leak
  // selections/tabs across.
  useEffect(() => {
    setSelectedSessionId(null)
    setSelectedFileRelPath(null)
    setPtyTabs([])
    setActivePtySlotId(null)
  }, [project.encodedPath])

  useEffect(() => {
    if (!visible) return
    const off = window.api.menu.onToggleHidden(() => setShowHidden((v) => !v))
    return off
  }, [visible])

  const handleFileSelect = (relPath: string): void => {
    setSelectedFileRelPath(relPath)
    if (mode !== 'editor') setMode('editor')
  }

  const handleSessionSelect = (sessionId: string): void => {
    setSelectedSessionId(sessionId)
    // Clicking a Session in the middle column means "show me this
    // session's transcript". If a Pty Tab is currently active, the
    // transcript host is hidden behind it — deactivate the tab so the
    // transcript surfaces. The tab itself stays alive in the strip;
    // the user can click it again to return to the live terminal.
    setActivePtySlotId(null)
  }

  const handleResume = (sessionId: string): void => {
    const slotId = nextSlotId()
    setPtyTabs((prev) => [
      ...prev,
      { slotId, sessionId, ptyId: null, lastActivityAt: Date.now() }
    ])
    setActivePtySlotId(slotId)
  }

  const handleTabSelect = (slotId: string): void => {
    setActivePtySlotId(slotId)
    // Surface the underlying session in the middle column too so the
    // user's mental model (which session am I in?) stays in sync.
    const tab = ptyTabs.find((t) => t.slotId === slotId)
    if (tab) setSelectedSessionId(tab.sessionId)
  }

  const handleTabClose = (slotId: string): void => {
    const tab = ptyTabs.find((t) => t.slotId === slotId)
    if (tab?.ptyId) void window.api.pty.kill(tab.ptyId)
    setPtyTabs((prev) => prev.filter((t) => t.slotId !== slotId))
    // If we closed the active tab, fall back to the rightmost remaining one.
    setActivePtySlotId((current) => {
      if (current !== slotId) return current
      const remaining = ptyTabs.filter((t) => t.slotId !== slotId)
      return remaining.length > 0 ? remaining[remaining.length - 1]!.slotId : null
    })
  }

  const handlePtyExit = (slotId: string): void => {
    // Drop the tab when the child process exits on its own — the
    // viewport's "Session exited" line stays for a beat via the
    // remove-tab animation… well, instant removal for v1.
    setPtyTabs((prev) => prev.filter((t) => t.slotId !== slotId))
    setActivePtySlotId((current) => {
      if (current !== slotId) return current
      const remaining = ptyTabs.filter((t) => t.slotId !== slotId)
      return remaining.length > 0 ? remaining[remaining.length - 1]!.slotId : null
    })
  }

  const setPtyId = (slotId: string, ptyId: string): void => {
    setPtyTabs((prev) =>
      prev.map((t) => (t.slotId === slotId ? { ...t, ptyId } : t))
    )
  }

  const markActivity = (slotId: string): void => {
    setPtyTabs((prev) =>
      prev.map((t) =>
        t.slotId === slotId ? { ...t, lastActivityAt: Date.now() } : t
      )
    )
  }

  const tabBarData: PtyTab[] = ptyTabs.map((t) => ({
    slotId: t.slotId,
    sessionId: t.sessionId,
    label: t.sessionId.slice(0, 8),
    lastActivityAt: t.lastActivityAt
  }))

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
        </div>
        <div className="workspace-header-spacer" />
      </header>

      <div className={`workspace-body${treeCollapsed ? ' workspace-body-tree-collapsed' : ''}`}>
        <aside
          className="workspace-tree-column"
          aria-label="File tree column"
          hidden={treeCollapsed}
        >
          <div className="workspace-column-header">
            <button
              type="button"
              className="workspace-tree-toggle"
              onClick={toggleTreeCollapsed}
              aria-label="Collapse file tree"
              aria-expanded={true}
              title="Collapse file tree"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span>Files</span>
            </button>
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

        {treeCollapsed && (
          <button
            type="button"
            className="workspace-tree-toggle workspace-tree-toggle-collapsed"
            onClick={toggleTreeCollapsed}
            aria-label="Expand file tree"
            aria-expanded={false}
            title="Show file tree"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        )}

        <section className="workspace-content-area" aria-label="Workspace content">
          <ModeTabs mode={mode} onChange={setMode} />

          <div className="workspace-mode-pane workspace-sessions-pane" hidden={mode !== 'sessions'}>
            <aside className="workspace-sessions-column" aria-label="Sessions list">
              <SessionsList
                encodedPath={project.encodedPath}
                selectedSessionId={selectedSessionId}
                onSelect={handleSessionSelect}
              />
            </aside>
            <div className="workspace-sessions-content">
              <PtyTabBar
                tabs={tabBarData}
                activeSlotId={activePtySlotId}
                onSelect={handleTabSelect}
                onClose={handleTabClose}
              />
              {/* All live Pty Tabs stay mounted; only the active one is visible. */}
              {ptyTabs.map((tab) => (
                <PtyView
                  key={tab.slotId}
                  encodedPath={project.encodedPath}
                  sessionId={tab.sessionId}
                  hidden={tab.slotId !== activePtySlotId}
                  onPtyId={(ptyId) => setPtyId(tab.slotId, ptyId)}
                  onActivity={() => markActivity(tab.slotId)}
                  onExit={() => handlePtyExit(tab.slotId)}
                />
              ))}
              {/* Transcript shows when no tab is active. Selecting a tab
                  hides it; closing the last tab brings it back. */}
              <div
                className="workspace-transcript-host"
                hidden={activePtySlotId !== null}
              >
                {selectedSessionId ? (
                  <Transcript
                    key={`${project.encodedPath}:${selectedSessionId}`}
                    encodedPath={project.encodedPath}
                    sessionId={selectedSessionId}
                    onResume={handleResume}
                  />
                ) : (
                  <p className="workspace-stub">Select a Session.</p>
                )}
              </div>
            </div>
          </div>

          <div className="workspace-mode-pane workspace-editor-pane" hidden={mode !== 'editor'}>
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
