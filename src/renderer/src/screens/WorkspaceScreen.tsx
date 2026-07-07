import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { FileTree } from '../components/FileTree'
import { FileViewer } from '../components/FileViewer'
import { ModeTabs } from '../components/ModeTabs'
import { PtyTabBar, type PtyTab } from '../components/PtyTabBar'
import { SessionsList } from '../components/SessionsList'
import { Transcript } from '../components/Transcript'
import { ptyHostStore } from '../state/pty-host'
import {
  useLiveSessionsActions,
  useLiveTabsForProject
} from '../hooks/useLiveSessions'
import { useSidebarWidth } from '../hooks/useSidebarWidth'
import { useWorkspaceMode } from '../hooks/useWorkspaceMode'
import { SidebarResizeHandle } from '../components/SidebarResizeHandle'

const FILE_TREE_WIDTH_KEY = 'workspace.fileTreeWidth'
const FILE_TREE_MIN_WIDTH = 180
const FILE_TREE_MAX_WIDTH = 520
const FILE_TREE_DEFAULT_WIDTH = 250

interface Props {
  project: Project
  visible: boolean
  onBack: () => void
  /**
   * Files-sidebar collapse state, lifted to App.tsx and toggled
   * exclusively from the top-bar sidebar button. WorkspaceScreen reads
   * the value to decide whether to render the file tree column.
   */
  treeCollapsed: boolean
  /**
   * v5 / Slice 42: one-shot "land on this session's tab" instruction
   * from a notification's Jump button. `null` when no jump is pending.
   * The `key` changes on every jump (including repeats to the same
   * session) so the consuming effect re-fires.
   */
  pendingJump: PendingJump | null
  onPendingJumpConsumed: () => void
}

/**
 * v5 / Slice 42: payload of a Jump-to-session instruction from a
 * notification toast or dropdown row. `encodedPath` is checked at the
 * App level so this WorkspaceScreen only receives jumps targeted at it.
 */
export interface PendingJump {
  encodedPath: string
  sessionId: string
  ptyId: string | null
  /** Monotonic key so duplicate jumps to the same session still trigger. */
  key: number
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
 * Pty Tabs.
 *
 * Slice 39 (v5): Pty Tab registry now lives in the App-level
 * `LiveSessionsProvider`. WorkspaceScreen filters by `encodedPath` and
 * forwards user actions (Resume, close, tab select) into the registry.
 * Tabs persist across Project navigation; activity tracking + exit
 * cleanup happen at provider level.
 */
export function WorkspaceScreen({
  project,
  visible,
  onBack,
  treeCollapsed,
  pendingJump,
  onPendingJumpConsumed
}: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedFileRelPath, setSelectedFileRelPath] = useState<string | null>(null)
  const [activePtySlotId, setActivePtySlotId] = useState<string | null>(null)
  const { mode, setMode } = useWorkspaceMode(project.encodedPath)

  const tabs = useLiveTabsForProject(project.encodedPath)
  const { addTab } = useLiveSessionsActions()
  const { width: treeWidth, setWidth: setTreeWidth } = useSidebarWidth(
    FILE_TREE_WIDTH_KEY,
    {
      defaultWidth: FILE_TREE_DEFAULT_WIDTH,
      min: FILE_TREE_MIN_WIDTH,
      max: FILE_TREE_MAX_WIDTH
    }
  )

  // Reset per-Workspace UI state on Project switch so selections don't
  // bleed across. Tab registry itself persists at provider level — only
  // the locally-tracked "which tab is focused on this screen visit"
  // resets.
  useEffect(() => {
    setSelectedSessionId(null)
    setSelectedFileRelPath(null)
    setActivePtySlotId(null)
  }, [project.encodedPath])

  // Slice 49 (v6, ADR-0008): register this Workspace's PTY pane as the
  // PtyHost's mount target, and publish which slot should occupy it.
  // The callback ref fires with null on unmount (including the `key`ed
  // remount on Project switch), sending every view back to the host's
  // holding container until the next Workspace registers.
  const registerPtyMount = useCallback((node: HTMLDivElement | null): void => {
    ptyHostStore.getState().setMountNode(node)
  }, [])

  useEffect(() => {
    ptyHostStore.getState().setActiveSlot(activePtySlotId)
  }, [activePtySlotId])

  useEffect(() => {
    return () => {
      ptyHostStore.getState().setActiveSlot(null)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const off = window.api.menu.onToggleHidden(() => setShowHidden((v) => !v))
    return off
  }, [visible])

  // Slice 41 (v5): tell main which Pty Tab the user is currently
  // foregrounded on so the idle detector can suppress notifications
  // they'd see anyway. Null when this Workspace is hidden, when no
  // tab is active, or when the active tab hasn't yet been assigned a
  // ptyId (still spawning).
  useEffect(() => {
    if (!visible) {
      void window.api.notifications.setForegroundPty(null)
      return
    }
    const active = tabs.find((t) => t.slotId === activePtySlotId)
    void window.api.notifications.setForegroundPty(active?.ptyId ?? null)
  }, [visible, activePtySlotId, tabs])

  // Slice 42 (v5): consume Jump-to-session instructions. Prefer the
  // tab whose ptyId matches (most precise — same agent the user was
  // notified about). Fall back to any tab for the same sessionId
  // (the agent may have been re-spawned). If no live tab exists,
  // surface the Session's transcript view.
  useEffect(() => {
    if (!pendingJump) return
    if (pendingJump.encodedPath !== project.encodedPath) return
    const byPty = pendingJump.ptyId
      ? tabs.find((t) => t.ptyId === pendingJump.ptyId)
      : undefined
    const bySession = byPty ?? tabs.find((t) => t.sessionId === pendingJump.sessionId)
    if (bySession) {
      setActivePtySlotId(bySession.slotId)
      setSelectedSessionId(bySession.sessionId)
    } else {
      setActivePtySlotId(null)
      setSelectedSessionId(pendingJump.sessionId)
    }
    onPendingJumpConsumed()
    // Keyed by `pendingJump.key` so repeat jumps to the same session
    // still trigger.
  }, [pendingJump?.key, project.encodedPath]) // eslint-disable-line react-hooks/exhaustive-deps

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
    addTab({ slotId, encodedPath: project.encodedPath, sessionId })
    setActivePtySlotId(slotId)
  }

  const handleTabSelect = (slotId: string): void => {
    setActivePtySlotId(slotId)
    // Surface the underlying session in the middle column too so the
    // user's mental model (which session am I in?) stays in sync.
    const tab = tabs.find((t) => t.slotId === slotId)
    if (tab) setSelectedSessionId(tab.sessionId)
  }

  const handleTabClose = (slotId: string): void => {
    const tab = tabs.find((t) => t.slotId === slotId)
    if (tab?.ptyId) {
      // Provider's pty:exit subscriber removes the registry entry once
      // the PTY's exit event lands. Optimistic local fallback for the
      // active-slot cursor.
      void window.api.pty.kill(tab.ptyId)
    }
    // Move focus to the rightmost remaining tab if we just closed the
    // active one. If the registry hasn't yet processed the exit, we
    // can still pick the next slot from the current `tabs` snapshot.
    setActivePtySlotId((current) => {
      if (current !== slotId) return current
      const remaining = tabs.filter((t) => t.slotId !== slotId)
      return remaining.length > 0 ? remaining[remaining.length - 1]!.slotId : null
    })
  }

  const tabBarData: PtyTab[] = tabs.map((t) => ({
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

      <div
        className={`workspace-body${treeCollapsed ? ' workspace-body-tree-collapsed' : ''}`}
        style={
          treeCollapsed ? undefined : { gridTemplateColumns: `${treeWidth}px 1fr` }
        }
      >
        <aside
          className="workspace-tree-column"
          aria-label="File tree column"
          hidden={treeCollapsed}
        >
          {!treeCollapsed && (
            <SidebarResizeHandle
              width={treeWidth}
              min={FILE_TREE_MIN_WIDTH}
              max={FILE_TREE_MAX_WIDTH}
              onResize={setTreeWidth}
              ariaLabel="Resize file tree"
            />
          )}
          <div className="workspace-column-header">
            <span className="workspace-tree-heading">Files</span>
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
              {/* Slice 49: PtyViews live in the App-level PtyHost and
                  portal into this pane while their tab is active —
                  they are never remounted by Workspace navigation. */}
              <div
                className="workspace-pty-mount"
                data-pty-mount="true"
                ref={registerPtyMount}
                hidden={activePtySlotId === null}
              />
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
