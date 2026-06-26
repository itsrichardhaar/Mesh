import { useEffect, useState } from 'react'

export interface PtyTab {
  /** Slot id assigned by `WorkspaceScreen` before the pty has spawned. */
  slotId: string
  /** Session the tab was Resumed from — drives the label. */
  sessionId: string
  /** Display label (defaults to the first ~10 chars of sessionId). */
  label: string
  /** ms epoch of the most recent output chunk; used to drive ●. */
  lastActivityAt: number
}

interface Props {
  tabs: ReadonlyArray<PtyTab>
  activeSlotId: string | null
  onSelect: (slotId: string) => void
  onClose: (slotId: string) => void
}

/**
 * Recency window for the ● activity dot — output received within this
 * many ms keeps the indicator lit. 2 s matches the issue's spec.
 */
const ACTIVITY_WINDOW_MS = 2_000

/**
 * Strip above the xterm area. One tab per live Pty Tab; the active
 * tab is highlighted, others render with a dimmed style. A ● dot
 * appears next to tabs whose pty emitted output in the last 2 s so
 * the user can spot background activity at a glance.
 */
export function PtyTabBar({ tabs, activeSlotId, onSelect, onClose }: Props): JSX.Element | null {
  // Tick every 500 ms so the ● indicator clears itself without
  // needing the tabs array to change.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (tabs.length === 0) return
    const id = setInterval(() => setTick((t) => t + 1), 500)
    return () => clearInterval(id)
  }, [tabs.length])

  if (tabs.length === 0) return null

  const now = Date.now()
  return (
    <div className="pty-tab-bar" role="tablist" aria-label="Live sessions">
      {tabs.map((tab) => {
        const active = tab.slotId === activeSlotId
        const recent = now - tab.lastActivityAt < ACTIVITY_WINDOW_MS
        return (
          <div
            key={tab.slotId}
            className={`pty-tab${active ? ' pty-tab-active' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="pty-tab-select"
              onClick={() => onSelect(tab.slotId)}
              title={`Session ${tab.sessionId}`}
            >
              {recent && <span className="pty-tab-dot" aria-hidden="true">●</span>}
              <span className="pty-tab-label">{tab.label}</span>
            </button>
            <button
              type="button"
              className="pty-tab-close"
              aria-label={`Close session ${tab.sessionId}`}
              onClick={() => onClose(tab.slotId)}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
