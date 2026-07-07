import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { liveSessionsStore } from '../hooks/useLiveSessions'
import { placementFor, ptyHostStore } from '../state/pty-host'
import { PtyView } from './PtyView'

/**
 * App-level PtyView host (Slice 49 / v6, ADR-0008): renderer PTY view
 * lifetime follows main-process PTY lifetime. One `PtyView` per live
 * tab in the registry, created when the tab appears and disposed only
 * when the tab leaves (PTY exit or explicit close) — never on
 * navigation.
 *
 * Placement mechanics: each slot gets a stable wrapper element that
 * React portals into exactly once. The host then *moves* the wrapper
 * between the Workspace's registered mount node and its own hidden
 * holding container with `appendChild` — an imperative DOM move that
 * preserves the subtree (xterm's buffer, scrollback, selection)
 * because React never re-creates the portal. Portaling directly into
 * a changing container would remount the view and dispose the
 * terminal — the exact bug this component exists to fix.
 */
export function PtyHost(): JSX.Element {
  const tabs = useStore(liveSessionsStore, (s) => s.tabs)
  const mountNode = useStore(ptyHostStore, (s) => s.mountNode)
  const activeSlotId = useStore(ptyHostStore, (s) => s.activeSlotId)
  const [holdingNode, setHoldingNode] = useState<HTMLDivElement | null>(null)
  const wrappersRef = useRef(new Map<string, HTMLDivElement>())

  const wrapperFor = (slotId: string): HTMLDivElement => {
    let wrapper = wrappersRef.current.get(slotId)
    if (!wrapper) {
      wrapper = document.createElement('div')
      wrapper.className = 'pty-host-slot'
      wrapper.dataset.slotId = slotId
      wrappersRef.current.set(slotId, wrapper)
    }
    return wrapper
  }

  // Reconcile wrapper placement after every render: active slot's
  // wrapper into the mount node, everything else into holding, and
  // drop wrappers whose tabs left the registry (their portal children
  // unmounted in the same commit).
  useEffect(() => {
    if (!holdingNode) return
    const liveSlotIds = new Set(tabs.map((t) => t.slotId))
    for (const [slotId, wrapper] of wrappersRef.current) {
      if (!liveSlotIds.has(slotId)) {
        wrapper.remove()
        wrappersRef.current.delete(slotId)
        continue
      }
      const target =
        placementFor(slotId, { mountNode, activeSlotId }) === 'mount' && mountNode
          ? mountNode
          : holdingNode
      if (wrapper.parentElement !== target) target.appendChild(wrapper)
    }
  }, [tabs, mountNode, activeSlotId, holdingNode])

  return (
    <div ref={setHoldingNode} className="pty-host-holding" aria-hidden="true">
      {holdingNode &&
        tabs.map((tab) =>
          createPortal(
            <PtyView
              encodedPath={tab.encodedPath}
              sessionId={tab.sessionId}
              focused={placementFor(tab.slotId, { mountNode, activeSlotId }) === 'mount'}
              onPtyId={(ptyId) => liveSessionsStore.getState().updatePtyId(tab.slotId, ptyId)}
            />,
            wrapperFor(tab.slotId),
            tab.slotId
          )
        )}
    </div>
  )
}
