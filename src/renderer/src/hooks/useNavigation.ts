import { useStore } from 'zustand'
import { createNavigationStore, type NavigationState } from '../state/navigation'

/**
 * The App's navigation store instance (Slice 47 / v6). One per
 * renderer lifetime — navigation state survives everything short of a
 * window reload. `window.api` is referenced lazily inside the action,
 * so importing this module never touches the preload bridge.
 */
export const navigationStore = createNavigationStore({
  listProjects: () => window.api.projects.list()
})

/** Selector-based subscription — components re-render only when their slice changes. */
export function useNavigation<T>(selector: (state: NavigationState) => T): T {
  return useStore(navigationStore, selector)
}
