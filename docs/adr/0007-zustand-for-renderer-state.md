# Zustand for renderer state

Mesh v6 consolidates App-level renderer state into **Zustand** stores, adopted incrementally per domain. A `navigation` store absorbs `App.tsx`'s screen/workspace/jump state and orchestration callbacks; the hand-rolled `state/live-sessions.ts` external store and the notifications provider convert to Zustand vanilla stores with thin `useStore` React bindings. `ThemeProvider` and `UiModeProvider` remain React contexts — they are small, DOM-coupled, and not the sprawl problem.

The deciding fact: the codebase had already invented the pattern. `state/live-sessions.ts` (Slice 39) is a framework-independent state machine with a subscriber list, unit-tested in vitest without React — a bespoke vanilla store. Zustand replaces the bespoke subscriber plumbing with the ~1 kB industry-standard version of the same idea, keeps every store testable in plain vitest (matching the main process's injectable-dependency testing philosophy), and removes provider nesting for the domains it absorbs.

## Considered Options

- **Jotai** — rejected: its atomic model shines for fine-grained derived state, but Mesh's renderer state is a few coarse domains with explicit transitions (navigation, live sessions, notifications). Atoms would fragment what is currently well-clustered, and the vanilla-store testing story is weaker.
- **Plain React consolidation** (a `useReducer`-backed `AppStateProvider`, no new dependency) — rejected: anything read from outside React — the portal PtyView host (ADR-0008), the idle detector's foreground bookkeeping, future non-component consumers — would keep requiring hand-rolled subscriber plumbing, and provider nesting stays. The dependency avoided is 1 kB; the plumbing retained is the thing v6 exists to delete.
- **Keep hand-rolling external stores** (extend the `live-sessions.ts` pattern to navigation and notifications) — rejected: three bespoke implementations of subscribe/notify is maintenance surface with no upside over the standard library that implements exactly this, with `useSyncExternalStore` integration and selector-based subscriptions already correct.
- **Defer consolidation past v6** — rejected: the portal host adds new App-level state in the same release; declining to organize state while adding to it would deepen the hole. Also, "growing without architectural pressure" only stays cheap to fix while it's still small.
- **A single unified store** (one big AppStore) — rejected: store-per-domain preserves the boundary discipline the main process's module layout established. Nothing forces a big-bang; incremental *is* the pattern, not a compromise.

## Consequences

- **`navigation` store** (Slice 47): `screen`, `workspaceProject`, `homeSelection`, `previousScreen`, `pendingJump`, plus actions (`openSettings`, `closeSettings`, `toggleSettings`, `openWorkspace`, `goHome`, `jumpToSession`, `consumePendingJump`). Vanilla core testable without DOM; `App.tsx` slims to composition.
- **`live-sessions` conversion** (Slice 48): `createStore` (Zustand vanilla) replaces the hand-rolled machine; `useLiveSessions` becomes a `useStore` binding; `LiveSessionsProvider` dissolves. The existing `live-sessions-state.test.ts` assertions carry over — the state machine's behavior is unchanged by design.
- **Notifications conversion** (Slice 48): same shape; the renderer remains a cache over main's authoritative SQLite, synced via the three event channels — that ADR-0006 stance is unchanged.
- **Selector-based subscriptions from day one** so high-frequency updates (PTY data chunks bumping `lastActivityAt`) don't re-render coarse consumers like ProjectCards.
- **Store-per-domain is the pattern for future state** (e.g., v7 notification-kind UI state). New cross-screen state gets a store, not another `App.tsx` useState.
- **Contexts survive where they fit**: theme and UI-mode stay contexts; this ADR is not a ban on React context, it is a home for cross-screen orchestration state.
- Runtime dependency added: `zustand` (v5.x).
