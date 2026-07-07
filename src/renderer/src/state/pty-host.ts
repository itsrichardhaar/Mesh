/**
 * Placement state for the App-level PtyView host (Slice 49 / v6,
 * ADR-0008). The visible Workspace registers its PTY pane's DOM node
 * as the mount target and publishes which slot is active; the
 * `<PtyHost>` component moves each live tab's view between that mount
 * node and its offscreen holding container accordingly.
 *
 * Pure placement data — no React. `mountNode` is null whenever no
 * Workspace is mounted (the `key`ed remount on Project switch passes
 * through null between screens).
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

export interface PtyHostState {
  /** The visible Workspace's PTY pane, or null when none is mounted. */
  mountNode: HTMLElement | null
  /** The slot whose view should occupy the mount node. */
  activeSlotId: string | null
  setMountNode(node: HTMLElement | null): void
  setActiveSlot(slotId: string | null): void
}

export type PtyHostStore = StoreApi<PtyHostState>

export function createPtyHostStore(): PtyHostStore {
  return createStore<PtyHostState>()((set) => ({
    mountNode: null,
    activeSlotId: null,
    setMountNode: (node) => set({ mountNode: node }),
    setActiveSlot: (slotId) => set({ activeSlotId: slotId })
  }))
}

/** The App's host-placement store instance — one per renderer lifetime. */
export const ptyHostStore = createPtyHostStore()

/**
 * Where a slot's view belongs: the Workspace mount node when it is the
 * active slot and a mount exists; the holding container otherwise.
 */
export function placementFor(
  slotId: string,
  state: Pick<PtyHostState, 'mountNode' | 'activeSlotId'>
): 'mount' | 'holding' {
  return state.mountNode !== null && state.activeSlotId === slotId ? 'mount' : 'holding'
}
