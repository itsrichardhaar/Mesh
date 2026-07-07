# Mesh v6 — Product Requirements Document

> Glossary terms (**Mesh**, **Project**, **Session**, **Pty Tab**, **Analysis**, **Notification**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v5 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; v6 records two new ADRs (ADR-0007, ADR-0008) and — deliberately — introduces **zero new glossary terms**. v6 makes no schema changes and no IPC contract changes.

## Goal

**v6 makes the renderer as disciplined as the main process.** Five consecutive feature releases (v1–v5) built a main process with 264 tests, clean SQL boundaries, and injectable-dependency modules — and a renderer with ~17 components, 5 context providers, a hand-rolled external store, and **zero tests**. Slice 42 alone shipped ~800 lines of React (toast + dropdown + Jump-to-session) verified only by HITL clicking. A regression in the notification UI would ship silently.

v6 is a hardening release. It ships three things:

1. **Renderer test infrastructure** — vitest + jsdom + React Testing Library, with backfill tests over the highest-risk surfaces (notification UI, Jump-to-session) and a standing policy: renderer-touching slices ship renderer tests from now on. The recurring Slice 35 deferral is formally retired.
2. **Renderer state consolidation** — App-level state moves to Zustand stores, incrementally: a navigation store absorbs `App.tsx`'s screen/workspace/jump state; the hand-rolled `live-sessions.ts` external store and the notifications provider convert to Zustand vanilla stores. Theme and UI-mode contexts stay as they are.
3. **Portal-hosted PtyViews** — the one user-visible fix in the release. PtyViews render under a persistent App-level host and portal into the active Workspace, so xterm instances survive Project navigation and **scrollback is never lost**. Renderer view lifetime finally matches main-process PTY lifetime, completing the alignment Slice 39 started for state.

No other features. The v5 dogfood finding (idle-only notification labels feel generic; pattern-matching kind subtypes are the missing half) remains the top *feature* candidate — it moves to v7, where it will land on a tested notification UI. Scheduled Analysis, previously slated for v6, queues behind it.

## Context

v5 shipped 6 slices on 2026-06-30 (`v0.5.0`, 264 tests). Post-v5, a polish train landed on `main` (Cursor-aligned design refresh, resizable sidebars) but no new features. Two inputs reshaped v6 planning on 2026-07-07:

1. **A strengths/weaknesses assessment** (~2026-06-30) identified six accumulating weaknesses. Three cluster in the renderer: zero renderer tests, App-level state growing without architectural pressure, and PTY scrollback loss on Project navigation (acknowledged as deferred in Slice 39). The remaining three — Analysis quality evals, error observability, the drifting Go-Public checklist — queue for later releases.
2. **v5 dogfood pressure** on notification labels ("Agent is idle" for moments that were actually approval prompts) made pattern matchers the leading feature candidate. Deliberately deferred to v7: pattern matchers are notification-*UI* work, and v6 exists partly so that work lands on a tested renderer.

What's *not* right at `v0.5.x` that v6 closes:

- **Zero renderer tests.** All 264 tests are main-process/shared modules. The renderer's most intricate logic — toast lifecycle, dropdown actions, the three-tier Jump-to-session resolution, the live-sessions registry's React binding — has no regression protection.
- **`App.tsx` hosts 4 nested providers, ~8 state values, and orchestration callbacks.** `jumpToSession` + `pendingJump` is cross-screen orchestration living as component-local callbacks. `state/live-sessions.ts` is a hand-rolled external store (state machine + subscriber list) — the codebase already invented the pattern Zustand formalizes.
- **PTY scrollback dies on Project navigation.** `WorkspaceScreen` is `key`ed by `encodedPath`; switching Projects unmounts every `PtyView`, whose cleanup calls `term.dispose()` (`PtyView.tsx:200`). Slice 39 kept the main-process PTY alive and added an `existingPtyId` reconnect path — but the reconnect creates a *fresh* xterm instance, so the buffer restarts empty (documented at `PtyView.tsx:22-29`).

## Scope

Six slices, sequenced tests-first so every structural change lands under the new test policy, and the riskiest slice (portal host) lands last with the most safety net beneath it:

```
Slice 45   Renderer test infra (vitest + jsdom + RTL) + tracer-bullet test
Slice 46   Notification UI + Jump-to-session backfill tests
Slice 47   Zustand navigation store (screen / workspace / jump state out of App.tsx)
Slice 48   Store conversions — live-sessions + notifications to Zustand vanilla stores
Slice 49   Portal PtyView host — scrollback survives Project navigation
Slice 50   PRD-v6 + ADR-0007 + ADR-0008 + v0.6.0 release ceremonials
```

(Slice numbers continue from v5's `44`; slice numbers stay aligned with issue numbers from `#45`.)

Each slice is independently committable and demoable:
- After 45: `pnpm test` runs two vitest projects — the existing 264 node-environment tests plus a jsdom renderer suite with a real (small) component test proving RTL + user-event + the `window.api` mock harness work end-to-end.
- After 46: the notification UI cannot regress silently — toast lifecycle, dropdown actions, unread badge, and the three-tier Jump-to-session resolution are all under test.
- After 47: `App.tsx` no longer owns navigation state; a Zustand `navigation` store (vanilla core, React binding) carries screen/workspace/jump state with its own unit tests. Behavior identical.
- After 48: `live-sessions.ts` and the notifications cache are Zustand vanilla stores; the hand-rolled subscriber plumbing is deleted; existing `live-sessions-state.test.ts` assertions carry over. Behavior identical.
- After 49: Resume a Session, scroll its transcript, switch to another Project and back — **scrollback is intact**. The `existingPtyId` reconnect path is deleted.
- After 50: v6 formally closes — ADR-0007 + ADR-0008 recorded, PRD-v6 committed, `v0.6.0` tagged.

## Implementation Decisions

### Renderer test infrastructure (Slice 45)

**vitest + jsdom + React Testing Library**, structured as a second vitest project so environments never mix:

- Existing tests keep the `node` environment untouched. Renderer tests live in `tests/renderer/` and run under `jsdom` via vitest's project/workspace configuration. One `pnpm test` runs both.
- Dev-dependency additions: `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- **A `window.api` mock harness** (`tests/renderer/test-utils.tsx`) is part of the infrastructure, not an afterthought: a typed fake of the preload surface with per-test overrides and event-channel emitters (so a test can fire a fake `notifications:created` and assert a toast renders). This is the renderer equivalent of the main process's injectable-deps convention.
- **Tracer bullet:** one small real test file proving the full stack — render a component, simulate a user event, assert on accessible output. Small enough to review the harness, real enough to catch config rot.

**Excluded surfaces, permanently (not deferred):** `PtyView` (xterm requires real canvas/DOM measurement jsdom cannot provide) and the Monaco-based `FileViewer`. These remain HITL-verified. The portal host's *state machine* (which view is mounted where) is testable; its terminal rendering is not.

### Renderer test policy (Slice 45, stated here)

**From Slice 45 onward, any slice that touches renderer components or stores ships renderer tests for the behavior it adds or changes.** This retires the recurring deferral first recorded in Slice 35 ("adding RTL + jsdom is out of scope") — the infra now exists, so the exemption is gone. Backfill beyond Slice 46's high-risk surfaces happens organically: when a future slice touches a component, it brings that component under test.

### Backfill scope: high-risk surfaces only (Slice 46)

v6 does **not** attempt comprehensive backfill over all ~15 testable components. Tests written in bulk against never-regressed components assert on current markup rather than on behavior anyone is changing — front-loaded brittleness for little protection. Slice 46 covers exactly the surfaces the assessment flagged:

- **`NotificationToast`** — renders on `notifications:created`, 6 s auto-dismiss (fake timers), stacking newest-on-top, manual × dismisses without marking read, mute suppression.
- **`NotificationsBell` dropdown** — unread badge appears/disappears, list ordering painted as given, Mark-all-read / Clear-all actions call the right IPC, mute banner + Pause/Resume quick-action reflect `notifications:mute-changed`.
- **Jump-to-session flow** — the three-tier resolution (live tab matching `ptyId` → any live tab for `sessionId` → transcript fallback) and one-shot `pendingJump` consumption keyed by monotonic `key` (consecutive jumps to the same session still trigger).
- **`useNotifications` / live-sessions React bindings** — cache stays in sync across the three event channels.

### Zustand, adopted incrementally (Slices 47–48) — ADR-0007

**Zustand (v5.x)** formalizes the external-store pattern the codebase already hand-rolls. The deciding fact: `state/live-sessions.ts` is a framework-independent state machine with a subscriber list, unit-tested without React — that *is* a vanilla store, bespoke. Zustand replaces the bespoke plumbing with the 1 kB standard version, keeps stores testable in plain vitest (matching the main-process testing philosophy), and eliminates provider nesting for the domains it absorbs.

- **Slice 47 — `navigation` store.** Absorbs `App.tsx`'s `screen`, `workspaceProject`, `homeSelection`, `previousScreen`, `pendingJump`, and the actions (`openSettings` / `closeSettings` / `toggleSettings` / `openWorkspace` / `goHome` / `jumpToSession` / `consumePendingJump`). Vanilla store core (testable without React) + `useStore` bindings. `App.tsx` slims to composition.
- **Slice 48 — store conversions.** `live-sessions.ts` converts to `createStore` (Zustand vanilla); `useLiveSessions` becomes a thin `useStore` binding; `LiveSessionsProvider` dissolves. The notifications provider converts the same way. Existing `live-sessions-state.test.ts` assertions carry over with minimal adaptation — the state machine's behavior is unchanged by design.
- **Not converted:** `ThemeProvider` and `UiModeProvider` stay as React contexts. They're small, DOM-coupled (attribute writes, media queries), and not the sprawl problem. Conversion would be motion without progress.
- **Incremental is the pattern, not a compromise.** Future state (e.g., v7 notification-kind UI state) gets a store per domain; nothing forces a big-bang unified store.

### Portal PtyView host (Slice 49) — ADR-0008

**Renderer PTY view lifetime follows main-process PTY lifetime.** Slice 39 aligned *state* lifetime (the live-sessions registry survives navigation); Slice 49 completes the alignment for *views*.

- **A persistent `<PtyHost>` mounts at App level** and owns one `PtyView` per live Pty Tab, keyed by the registry. It never unmounts on navigation.
- **Portal mechanics:** the active Workspace registers a mount node for its PTY pane; `PtyHost` portals the active tab's view into it via `createPortal`. Views whose Workspace isn't visible (or whose tab isn't active) render into an App-level offscreen holding container (`display: none`) — the xterm DOM, and therefore scrollback, persists.
- **The `existingPtyId` reconnect path is deleted**, along with its documented caveat (`PtyView.tsx:22-29`). A PtyView is created once when a PTY spawns and disposed only when the PTY exits or its tab is explicitly closed. The special case is removed, not patched.
- **Focus + resize rules:** on portal-in, the view refits (existing `FitAddon` + `ResizeObserver` machinery) and takes focus; on portal-out, focus returns to the document flow. The ResizeObserver keeps observing the view's own container, which moves with the portal.
- **Rejected alternatives** (recorded in ADR-0008): serialize-and-restore via `@xterm/addon-serialize` (patches the symptom, keeps the reconnect seam, imperfect fidelity) and un-keying `WorkspaceScreen` (the `key` intentionally resets all other Workspace state on Project switch; removing it has high blast radius for the wrong reason).
- Under the Slice 45 policy, the host's state machine (which view portals where; holding-container membership; disposal on exit/close) ships with renderer tests. Terminal rendering itself remains HITL.

### No CONTEXT.md changes

v6 introduces zero new domain language. "Portal host," "store," and "test harness" are implementation vocabulary, not domain terms — they do not enter the glossary. This is the signature of a genuinely internal release.

### PRD-v6 + ADR-0007 + ADR-0008 + release ceremonials (Slice 50)

Mirrors the v4/v5 closing-slice pattern.

1. **ADR-0007 "Zustand for renderer state"** — records the store choice and the alternatives (Jotai, plain context + useReducer, keep hand-rolling, defer).
2. **ADR-0008 "Renderer PTY view lifetime follows main-process PTY lifetime"** — records the portal host and the alternatives (serialize-and-restore, un-keying WorkspaceScreen).
3. **`docs/PRD-v6.md` committed** — drafted into the working tree during v6 planning (you're reading it), held across Slices 45–49 per the v3/v4/v5 precedent.
4. **PRD-v5 dated notes.** Its "v6 is Scheduled Analysis" statements gain: `Update — 2026-07-07: v6 became renderer hardening (see PRD-v6); pattern-matching notification kinds are the leading v7 feature candidate; Scheduled Analysis queues behind them.` v5's body otherwise untouched, per Slice 32 principle A.
5. **Release ceremonials.** `package.json` 0.5.0 → 0.6.0. CHANGELOG `[Unreleased]` (which already carries the post-v5 design refresh + resizable sidebars) → `[0.6.0] — YYYY-MM-DD`; new empty `[Unreleased]` opens for v7. `git tag v0.6.0`.
6. **HITL verification** (the parts tests can't reach):
   - Resume Sessions in two different Projects; produce scrollback in both; switch Projects repeatedly in both directions — scrollback intact, live indicators (green + spinner) still correct on all four surfaces.
   - Typing lands in the active terminal immediately after every switch; ⌘[ back-navigation and the sidebar toggle still behave.
   - Resize the Workspace file-tree sidebar while a terminal is portaled out; return — terminal refits without artifacts.
   - Theme toggle with live terminals in two Projects — both repaint.
   - Full notification round-trip regression pass (idle fire → toast → dropdown → Jump → mark-read), including mute.

## Testing Decisions

v6 *is* the testing decision. Specifics:

| Module | Test? | Pattern |
|---|---|---|
| Renderer test harness + `window.api` mock | ✅ (tracer) | One real component test proving render + user-event + api-mock + event-channel emitters |
| `NotificationToast` | ✅ | Fake timers for 6 s dismiss; event-channel emitter drives creation; assert on accessible output |
| `NotificationsBell` + dropdown | ✅ | Badge presence, action → IPC-call assertions via api mock, mute banner state |
| Jump-to-session flow | ✅ | Three-tier resolution + one-shot `pendingJump` consumption; monotonic-key re-trigger |
| `navigation` store (vanilla) | ✅ | Plain vitest, no DOM — transitions, `previousScreen` restore, jump orchestration with injected api |
| `live-sessions` store (converted) | ✅ | Existing `live-sessions-state.test.ts` assertions carried over |
| Notifications store (converted) | ✅ | Cache-sync across the three event channels |
| `PtyHost` state machine | ✅ | Which view portals where; holding-container membership; disposal on exit/tab-close |
| `PtyView` (xterm) | ❌ permanent | jsdom cannot host xterm; HITL in Slice 50 |
| Monaco `FileViewer` | ❌ permanent | Same reasoning |
| Theme/UiMode providers | ⏸ | Untouched by v6; come under test when a slice touches them (policy) |

**Estimated test delta:** 264 → ~300.

**What makes a good renderer test here:** user-observable behavior through accessible queries — never implementation details. Assert "a toast with this label appears and disappears after 6 s," never "state X was set." Drive inputs the way the user does (`user-event`) or the way main does (fake event-channel emitters). If a test needs to reach into a component's internals, the component or the test is wrong.

**Prior art:** `tests/live-sessions-state.test.ts` (framework-free store testing — the pattern Slices 47–48 preserve), `tests/idle-detector.test.ts` (fake timers + injected emitters), `tests/settings-repository.test.ts` (round-trip discipline).

## Out of Scope (deferred)

**Leading v7 candidate:**
- **Pattern-matching Notification kind subtypes** (`approval` / `complete` / `question`) via PTY-stdout parsing. Top feature candidate per v5 dogfood (idle-only labels felt generic in real use, twice). Deliberately sequenced *after* v6 so the notification-UI changes land on a tested renderer. The schema (`kind` as open TEXT), IPC surface, renderer degradation, and the reserved `--timeline-*` pastel tokens are all already in place; only the detectors and kind-specific UI are the v7 work.

**Queued behind that (v8+):**
- **Scheduled / cron-based Analysis** — was slated for v6 by PRD-v5; displaced by this release. Its decision tree (always-on vs OS-scheduled, catch-up semantics, throttling) remains unresolved and unowned.
- **Analysis quality evals** — fixture transcripts, output scoring, Claude vs OpenAI comparison, long-input failure modes. The "systematically evaluated" concern from the 2026-06 assessment; deserves its own focused release.
- **Error observability** — structured logging beyond `console.error`; scale-of-one today.
- **Go-Public checklist decision** — schedule it or formally close it; currently drifting. (Code signing, notarization, auto-updater, arm64, Windows, Linux, Playwright e2e.)
- **Comprehensive renderer test backfill** — beyond Slice 46's high-risk surfaces; happens organically under the test policy.
- **Functional Local Provider**, **Suggested Next chips**, **editable Monaco** (ADR-0004 in force), and all other previously-deferred items remain deferred per their original PRDs.

## Risks and Open Items

- **Portal focus management is the sharpest edge.** xterm owns a textarea for keyboard input; portaling the DOM node between containers must not drop focus or leave a stale `document.activeElement`. Mitigation: the portal host lands last (Slice 49) with the full harness beneath it; focus behavior is an explicit HITL item; if `createPortal` proves fragile for xterm specifically, the fallback within the same architecture is a fixed App-level layer positioned over the Workspace's PTY pane (same lifetime guarantee, different mechanics) — ADR-0008 notes this escape hatch.
- **Store conversions can regress the v5 indicators silently.** Four surfaces + the idle detector's foreground checks read live-sessions state. Mitigation: Slice 48 carries over the existing state-machine tests verbatim before converting, and Slice 46's backfill lands first — the notification UI is under test before its store moves.
- **jsdom fidelity limits.** Some real bugs (layout, CSS, focus-visible) don't reproduce in jsdom. Mitigation: the policy pairs tests with the existing HITL gate; jsdom tests target logic and contract, not pixels.
- **Zustand v5 + React 18 `useSyncExternalStore` semantics** — tearing-safe by design, but conversion must preserve subscription granularity so ProjectCards doesn't re-render on every PTY data chunk. Mitigation: selector-based subscriptions from day one; the vanilla-store tests assert notification counts per state change.
- **A hardening release has no dopamine.** Five slices of internal work with one visible fix risks mid-release drift. Mitigation: tests-first ordering front-loads fast slices; the scrollback fix is the finale; the release is six slices, not ten.

## Slice Index

| # | Title | Issue |
|---|---|---|
| 45 | Renderer test infra (vitest + jsdom + RTL) + tracer-bullet test | [#45](https://github.com/itsrichardhaar/Mesh/issues/45) |
| 46 | Notification UI + Jump-to-session backfill tests | [#46](https://github.com/itsrichardhaar/Mesh/issues/46) |
| 47 | Zustand navigation store | [#47](https://github.com/itsrichardhaar/Mesh/issues/47) |
| 48 | Store conversions — live-sessions + notifications to Zustand | [#48](https://github.com/itsrichardhaar/Mesh/issues/48) |
| 49 | Portal PtyView host — scrollback survives Project navigation | [#49](https://github.com/itsrichardhaar/Mesh/issues/49) |
| 50 | PRD-v6 + ADR-0007 + ADR-0008 + v0.6.0 release ceremonials | [#50](https://github.com/itsrichardhaar/Mesh/issues/50) |

Per v1–v5 workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; manual verification before close.

## Further Notes

- v6 keeps `~/.claude/projects/` as the canonical Project source (ADR-0002 unchanged), the provider mechanism (ADR-0003/0005), read-only Monaco (ADR-0004), and the notification subsystem's shape (ADR-0006) all unchanged.
- v6 makes **no** SQLite schema changes, **no** IPC contract changes, and **no** main-process behavior changes. The main process is untouched except where renderer wiring requires none at all — which is everywhere.
- Runtime dependency added: `zustand` (Slice 47). Dev dependencies added: `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` (Slice 45).
- The `[Unreleased]` CHANGELOG block already contains the post-v5 design refresh + resizable sidebars; those ship inside `v0.6.0` alongside the v6 slices.
- v7 planning happens when v6 ships. Pattern-matching notification kinds enter it as the leading candidate with their design questions unresolved and explicitly *not* locked today: detector input (raw chunks vs ANSI-stripped rolling buffer), fire timing (upgrade-at-idle-fire vs immediate), which kinds ship first, and the fixture corpus strategy for brittleness.
