import { FileText, MessageSquare, type LucideIcon } from 'lucide-react'
import type { WorkspaceMode } from '../hooks/useWorkspaceMode'

interface Props {
  mode: WorkspaceMode
  onChange: (next: WorkspaceMode) => void
}

const TABS: ReadonlyArray<{
  id: WorkspaceMode
  label: string
  Icon: LucideIcon
}> = [
  { id: 'sessions', label: 'Sessions', Icon: MessageSquare },
  { id: 'editor', label: 'File Editor', Icon: FileText }
]

/**
 * Workspace Mode Tab toggle. Slice 23 promotes this to span the entire
 * content area (everything right of the file tree) — switching the tab
 * changes both the middle and right sub-columns (sessions list visible
 * in Sessions mode, gone in File Editor mode). Both panes stay mounted
 * (display:none on the inactive one) so transcript scroll and xterm
 * processes survive the round-trip.
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
            <tab.Icon size={14} aria-hidden={true} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
