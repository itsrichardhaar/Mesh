import type { WorkspaceMode } from '../hooks/useWorkspaceMode'

interface Props {
  mode: WorkspaceMode
  onChange: (next: WorkspaceMode) => void
}

const TABS: ReadonlyArray<{ id: WorkspaceMode; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'editor', label: 'File Editor' }
]

/**
 * The Workspace Screen's right-pane Mode Tab toggle. Lives at the top
 * of the third column. Switching the tab does NOT unmount the
 * inactive pane — the parent keeps both mounted (display:none) so
 * Sessions transcript scroll state and (later) xterm processes
 * survive the round-trip.
 */
export function ModeTabs({ mode, onChange }: Props): JSX.Element {
  return (
    <div className="mode-tabs" role="tablist" aria-label="Workspace mode">
      {TABS.map((tab) => {
        const active = mode === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`mode-tab${active ? ' mode-tab-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
