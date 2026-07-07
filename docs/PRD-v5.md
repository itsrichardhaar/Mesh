# Mesh v5 — Product Requirements Document

> Glossary terms (**Mesh**, **Project**, **Session**, **Pty Tab**, **Analysis**, **Provider**, **Active Provider**, **Model**, **Hidden**, **Source-Missing**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v4 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; v5 records one new ADR (ADR-0006) and introduces one new glossary term (**Notification**). v5 makes no schema changes that affect existing tables — it adds a new `notifications` table.

## Goal

**v5 makes the state of background agent work visible.** Today, the moment a user navigates away from a Pty Tab, they lose all sense of what that agent is doing. Did Claude finish? Is it waiting for an approval? Is the session still alive? The information exists — the Pty's stdout knows — but nothing in Mesh's UI surfaces it outside the active Workspace view. v5 fixes this with two complementary mechanisms:

1. **Active-session indicators** — subtle green tinting and shared activity spinners on every surface that lists Sessions or Projects, so the user can spot live agent work at a glance from anywhere in the app.
2. **In-window notifications** — persistent records of moments that may need attention (agent went idle while a Pty Tab is open), surfaced as toasts and a macOS Notification Center–style dropdown, with one-click navigation back to the session.

No other features. The candidate pool in PRD-v4's "Out of Scope" list contained Scheduled Analysis, Local Provider, expanded tool-call rendering, and others. v5 ships exactly one new initiative from that pool: visible-background-work + notifications. **Scheduled Analysis moves to v6** — its decision tree (always-on vs OS-scheduled, catch-up semantics, throttling, etc.) is unresolved and remains deferred per the v4 planning split.

## Context

v4 shipped 4 slices on 2026-06-29 (`main` branch, 207 tests, production build succeeds), tagged `v0.4.0`. v4 made OpenAI a functional Provider and lit up Active Provider switching. Post-v4, a polish train landed (sidebar toggle, gear toggles, Jump-to-bottom, Active Projects heading) but no new features.

What's *not* yet done at `v0.4.x` that v5 closes:

- **Pty Tab activity is only visible inside the Workspace's tab bar.** `PtyTabBar.tsx` lights a ● activity dot on each live tab, but the moment the user navigates away from that Project's Workspace, the signal is gone. The Home Screen has no visibility into live agent work.
- **Pty Tab renderer state is local to `WorkspaceScreen.tsx`.** `WorkspaceScreen` is `key`ed by `encodedPath`, so switching Projects unmounts the component and loses the renderer-side `ptyTabs` array — even though the underlying `node-pty` processes remain alive in the main process. State must lift to App level for cross-screen visibility.
- **No way to tell which Sessions are "live."** A Session row in the Sessions list looks identical whether the user has Resumed it into a Pty Tab or has never touched it. The Resume action has no persistent visual consequence.
- **No notification surface exists.** When an agent finishes a task, asks for approval, or goes idle waiting for input, Mesh tells the user nothing. The user must manually navigate to each Pty Tab to discover the state.
- **No way to navigate back to a specific session's live terminal from outside the Workspace.** Once attention moves to another Project or to Settings, returning to a particular Pty Tab requires manual navigation (Home → click Project → Workspace → click Sessions → find session → click).
- **No mute/silence affordance** — because nothing is yet noisy enough to need silencing. v5 introduces both the noise and the controls in the same release.

v5 closes those gaps.

## Scope

Six slices, sequenced linearly with tracer-bullet seams between each:

```
Slice 39   Lift Pty Tab state to App level + per-Session indicators (Workspace)
Slice 40   Project-level aggregation (sidebar + ProjectCards + Detail pane) + "Active" → "Recent" rename
Slice 41   Notification backend (migration 0004 + idle detector + IPC surface)
Slice 42   Notification UI (toast + dropdown + bell icon + Jump-to-session)
Slice 43   Silence controls (global + per-Project + BellOff variant)
Slice 44   PRD-v5 + ADR-0006 + v0.5.0 release ceremonials
```

(Slice numbers continue from v4's `37`. Issue `#38` was the CSP fix discovered post-v4; v5 slice numbers resume sequential alignment with issue numbers from `39`.)

Each slice is independently committable and demoable:
- After 39: Workspace's Sessions list visibly shows which Sessions have live Pty Tabs (subtle green) and which are currently producing output (activity spinner replaces the "just now" timestamp).
- After 40: Home Screen sidebar, ProjectCards grid, and Project Detail pane all show green + spinner aggregated per Project. The user can spot live agent work without leaving the Home Screen.
- After 41: `notifications` table exists; the idle detector fires `notifications:created` events when a live Pty Tab goes idle for 8 s; rows persist with 7-day retention. No UI yet — verifiable via DevTools / tests.
- After 42: Bell icon appears in the top bar; toasts pop in the top-right on new notifications; dropdown lists all notifications newest-first; clicking "Jump to session" opens the Workspace + activates the Pty Tab + marks read. End-to-end notifications work without silence controls.
- After 43: Global mute (Settings + dropdown quick-action) and per-Project mute (project-settings popover) gate toast emission while preserving SQLite storage. BellOff variant indicates muted state.
- After 44: v5 formally closes — ADR-0006 recorded, PRD-v5 committed, `v0.5.0` tagged.

## Implementation Decisions

### Indicator semantics (two states, two indicators)

The single most foundational decision for the visual layer: **subtle green** and the **activity spinner** carry different information.

- **Green background tint** = "this Session has at least one live Pty Tab." Sticky — turns on at Resume, off when every tab for that Session has been closed or its process has exited. Persists across navigation; survives the user looking away.
- **Activity spinner** = "PTY output arrived in the last 2 seconds." Transient — animates only while output is actively streaming, stops once the agent goes quiet. Reuses `PtyTabBar.tsx`'s existing `lastActivityAt` + 2 000 ms recency window.

Conflating the two indicators (one state, both indicators bound together) was rejected — it would either animate the spinner perpetually for any open Pty Tab (visual noise that undermines the "spot active work" purpose) or hide the green during idle (losing the "I have unfinished business here" signal). The two-indicator model maps cleanly to the existing primitive: spinner = `lastActivityAt < 2 s`, green = `tab exists`. No new detection layer required.

The transition from spinner-on → spinner-off (output stopped for ≥ 8 s) is also the load-bearing primitive for notification firing — see [Idle detection](#idle-detection-slice-41).

### Lift Pty Tab state to App level (Slice 39)

Today `WorkspaceScreen.tsx` owns the `ptyTabs` array as local state. Two reasons that has to lift:

1. **HomeScreen sidebar + ProjectCards + Project Detail pane** all need to read which Projects have live Pty Tabs — none of them are descendants of `WorkspaceScreen`.
2. **`WorkspaceScreen` is `key`ed by `encodedPath`** (`App.tsx`'s `key={workspaceProject.encodedPath}`). Switching Projects unmounts and remounts it, discarding the local `ptyTabs` array — even though the underlying `node-pty` processes are still alive in the main process. The renderer's tab registry is out of sync with main-process reality on every Project switch.

**Solution: a new `useLiveSessions` hook + context provider mounted at App level.** Each tab carries `{ slotId, encodedPath, sessionId, ptyId, lastActivityAt, isAlive }`. `WorkspaceScreen` is one of three consumers (alongside `HomeScreen` and `ProjectSidebar`); it filters the registry to its current `encodedPath` for its own tab strip. PTY data subscription stays in the renderer (existing `pty:data` events from preload), but the activity-tracking state lives in the App-level context.

The state lift also fixes the latent Project-switch bug as a side effect: tabs survive Project navigation because the state lives above `WorkspaceScreen`. The reverse direction (closing a Pty Tab) propagates through the main-process kill + the existing `pty:exit` event, which clears the entry from the App-level registry.

### Shared `<ActivitySpinner>` component (Slice 39)

Today the Analyze button has its own spinner animation. v5 introduces three more sites where a spinner needs to animate: Workspace Sessions list, Project sidebar items, ProjectCards grid, Project Detail pane.

**Extract the Analyze spinner into a shared `<ActivitySpinner size="small" | "medium" />` component**, then use it everywhere — including the existing Analyze button (refactored to call the shared component). One animation, five sites — visual consistency for free, and the spinner's timing/styling lives in one place if it ever needs to change.

### Per-Session indicators on the Workspace Sessions list (Slice 39)

Each Session row in the Sessions list (middle column of the Workspace Screen) reads from `useLiveSessions` and renders:
- **Background tint**: subtle green (`--mesh-session-live-bg`, a CSS variable defined in `styles.css`) when any Pty Tab exists for that Session's `sessionId`. Survives spinner stopping.
- **Activity area** (the existing "just now" / "3 m ago" timestamp display): replaced by `<ActivitySpinner size="small" />` when the Session's most-active Pty Tab has emitted output within 2 s; falls back to the timestamp when idle.

The visual treatment is *subtle* — the green is a tint, not a fill; the spinner is the same muted accent color used elsewhere. Goal is glanceable, not loud.

### Project-level aggregation (Slice 40)

Three surfaces on the Home Screen carry the per-Project rollup:

1. **`ProjectSidebar.tsx`** sidebar item — green tint on the row when any of that Project's Sessions has a live Pty Tab; spinner glyph next to the project name when any tab is currently active (max activity across tabs wins).
2. **`ProjectCards.tsx`** grid card — green tint on the card; spinner near the title or in the corner where the activity time renders today.
3. **Project Detail pane** (right side of Home Screen when a Project is selected) — subtle green tint on the header bar; spinner in the title row.

Aggregation rule: a Project shows green if *any* of its Pty Tabs are alive; spinner if *any* are active. Same source — `useLiveSessions` — with a grouping by `encodedPath`.

### "Active Projects" → "Recent Projects" rename (Slice 40)

The existing `ProjectCards.tsx` section is titled "Active Projects" — but it means *recently-active by Last Activity timestamp*, not *currently-running agent work*. v5 introduces a new meaning of "active" (has a live Pty Tab). To avoid the naming collision, **rename the section heading to "Recent Projects"** in this slice.

One-line change in `ProjectCards.tsx`; one `aria-label` update; one CSS class rename if any class encodes "active." Trivial polish that frees up "active" semantics for the new feature.

### `Notification` (new glossary term)

**Notification:** A persistent record of a moment that may need user attention in a Project's Pty Tab. Created when a live Pty Tab transitions from active to idle (no PTY output for ≥ 8 s) while the user is not currently looking at that Pty Tab. Stored in SQLite with 7-day retention. Surfaced as a top-right toast on creation and as a row in the top-bar dropdown until read or cleared.

CONTEXT.md gains this term in Slice 44's docs commit.

### Idle detection (Slice 41)

The notification trigger primitive: **PTY output stopped for ≥ 8 s while the Pty Tab is alive and not foregrounded.**

- **Threshold: 8 s** (vs `PtyTabBar.tsx`'s 2 s spinner-recency window). 2 s is too tight for notifications — Claude often pauses 3–5 s mid-thought. 8 s reliably means "stopped, not thinking."
- **Foreground suppression:** if the user is currently looking at that Session's Pty Tab (i.e. the tab is the active one in the active `WorkspaceScreen`), no notification fires. The idle state is already visible to them.
- **Debounce:** once a notification fires for a given Pty Tab's idle period, the trigger is disarmed until PTY activity resumes (or the PTY exits). A single overnight idle generates one notification, not dozens.
- **Pattern-matching subtypes are deferred.** v1 of this feature ships a single `kind = 'idle'`. Future slices (v6+) can add `kind = 'approval' | 'complete' | 'question'` by parsing PTY stdout. The schema's `kind` column is stored as `TEXT` (not `CHECK`-constrained) so adding a value is a code change, not a migration; the renderer treats unknown kinds as `'idle'` for graceful degradation.

This choice was deliberate: pattern matching alone is brittle (every Claude Code TUI update could silently break detection), while the idle-transition primitive is the same `lastActivityAt` machinery the spinner already uses. The hybrid approach (idle fires the notification; pattern matchers *upgrade the label* when they can) means the user never gets a silent miss — if Claude stopped writing, Mesh noticed.

### `notifications` table schema (Slice 41)

Migration `0004_notifications.sql`:

```sql
CREATE TABLE notifications (
  id            TEXT NOT NULL PRIMARY KEY,    -- UUID
  created_at    TEXT NOT NULL,                -- ISO 8601
  encoded_path  TEXT NOT NULL,                -- Project FK (no enforced ref — projects table is augmentation-only)
  session_id    TEXT NOT NULL,                -- Session this notification is about
  pty_id        TEXT,                         -- nullable — PTY may have exited by read time
  kind          TEXT NOT NULL,                -- 'idle' in v1; future: 'approval' | 'complete' | 'question'
  label_text    TEXT NOT NULL,                -- human-readable label, e.g. "Agent is idle"
  read_at       TEXT                          -- nullable — null = unread
);

CREATE INDEX idx_notifications_recent ON notifications (created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (read_at) WHERE read_at IS NULL;
```

Retention: a sweep on app boot deletes rows older than 7 days. No user-facing setting; keeps the table small without forcing the user to housekeep.

### Notification repository (Slice 41)

`src/main/notifications/repository.ts`. Functions:

- `insertNotification(db, row): void`
- `listNotifications(db, { limit?, encodedPath? }): Notification[]` — newest-first, unread-first within same day
- `markRead(db, id): void`
- `markAllRead(db, { encodedPath?, sessionId? }): void` — scoped variants for "mark this session's unread read" auto-actions
- `clearAll(db, { encodedPath? }): void`
- `deleteOlderThan(db, isoDate): void` — retention sweep

Same shape as `analyses/repository.ts` and `settings/repository.ts` — pure SQL boundary, no side effects beyond DB writes.

### Auto-mark-read triggers (Slice 41)

To prevent the dropdown from accumulating stale unread items, a Session's unread notifications mark as read automatically on any of these events:

1. **User navigates to that Session's Pty Tab** via any means (Workspace's tab bar, "Jump to session" button in a notification, sidebar click that lands the Workspace on the tab).
2. **The PTY emits new output** (agent un-idled — the wait condition is gone; mark all that session's unread read).
3. **The PTY exits** (process ended — no action possible; mark all that session's unread read).

The notification *records* stay in the dropdown (you can review the history); only the unread state clears.

### Notification IPC surface (Slice 41)

Three methods on a new `notifications` IPC namespace:

- `notifications.list(): Promise<Notification[]>`
- `notifications.markRead(id: string): Promise<void>`
- `notifications.markAllRead(opts?: { encodedPath?, sessionId? }): Promise<void>`
- `notifications.clearAll(opts?: { encodedPath? }): Promise<void>`

Plus three event channels:

- `notifications:created` — fires on insert; payload is the full `Notification` row so the toast can render without an extra round-trip.
- `notifications:updated` — fires on `markRead` / `markAllRead`; payload is `{ ids: string[] }`.
- `notifications:cleared` — fires on `clearAll`.

Subscribers in the renderer use the existing `() => unsubscribe` pattern established by `onActiveProviderChanged` (Slice 36).

### Notification UI (Slice 42)

**Toast.** A single `<NotificationToast>` rendered at App level, anchored top-right. Subscribes to `notifications:created`; on each event, displays for 6 s with the notification's `label_text`, the Project name, the Session label, and a "Jump" button. Click on the toast body or the Jump button = jump to session (opens Workspace, activates Pty Tab, marks the notification's session as read). Dismissing the toast (× button or 6 s timeout) leaves the notification unread in the dropdown.

**Bell icon in top bar.** Positioned between the existing `<div className="top-bar-spacer" />` and the theme toggle (`Moon`/`Sun`) — i.e. to the left of the Light/Dark + Settings buttons. Lucide-react's `Bell` glyph; swaps to `BellOff` when global mute is active (Slice 43). A small unread dot (no number) appears when ≥ 1 unread notification exists, matching the muted-style pattern from Slice 36's Analyze button subtitle.

**Dropdown.** Opens from the bell icon. Ordered newest-first; unread items appear before read items within the same day. Each row:
- Project name (links to Project via Jump button)
- Session label (first ~10 chars of session-id, matching `PtyTabBar.tsx`'s label convention)
- Time-ago (`5 m ago`, `2 h ago`)
- "Jump to session" primary action button
- Subtle background tint when unread

Header actions: "Mark all read" + "Clear all" buttons. A "🔕 Pause notifications" toggle mirroring global-mute state (Slice 43).

**Jump-to-session semantics.** Clicking Jump on any notification:
1. Calls `markAllRead({ sessionId })` for that session
2. Sets the active Workspace project to `encodedPath`
3. Navigates the renderer to the Workspace Screen
4. Activates the Pty Tab matching `pty_id` if still alive; otherwise navigates to the Session row in the Sessions list (read-only transcript view)

### Silence controls (Slice 43)

**Two controls, no more.** Anything beyond solves problems v5 hasn't hit yet.

1. **Global mute** — boolean setting stored under key `notifications_global_mute`. Default `false`. Two access surfaces, both writing the same setting:
   - `Settings → Notifications` section: checkbox labeled "Pause notifications."
   - Notification dropdown header: "🔕 Pause notifications" quick-action mirroring the same state without leaving the dropdown.
2. **Per-Project mute** — boolean field on the project augmentation row (`mute_notifications`, default `false`). UI: a checkbox in the existing Project settings popover (alongside rename / accent color / hide).

**Storage when muted: notifications still persist to SQLite.** Mute gates *toast emission* only. The dropdown still surfaces the row, the unread badge still appears on the icon, and the user can review what they missed when they unmute. Matches macOS DND behavior and respects the persistence decision (v5 is fundamentally about *not missing* things).

**Visual feedback when muted:**
- Top-bar bell icon swaps `Bell` → `BellOff` when global mute is on.
- Per-Project muted state is reflected in the project's settings popover only — no surface-level cue, matching how `Hidden` works today (boolean state with no decoration).

### Deferred to v6+: notification kind subtypes

v1 of notifications ships with `kind = 'idle'` only. The decision tree for adding `kind = 'approval' | 'complete' | 'question'` involves parsing PTY stdout for Claude Code's TUI patterns — brittle work that needs its own design pass. The infrastructure to support multiple kinds is in place from day one (the `kind` column is stored as `TEXT`, the renderer treats unknown kinds as `'idle'`, the toast/dropdown render `label_text` directly without switching on kind).

When kind subtypes ship (v6+), the only changes are: new detector modules alongside the idle detector, new kind values written into existing rows, and (optionally) renderer-side icon/copy variants per kind.

### PRD-v5 + ADR-0006 + release ceremonials (Slice 44)

Mirrors v4's Slice 37 closing-slice pattern.

**1. New ADR-0006 "In-window notifications surface."** Records the affirmative new architectural decision: a `notifications` table + main-process idle detector + IPC event channels constitute Mesh's notification subsystem. Future notification sources (Scheduled Analysis runs in v6, build/lint events later) plug into the same table + IPC surface. The decision to suppress system-level macOS notifications (no `new Notification(...)` calls; in-window toast only) is captured here.

**2. `docs/PRD-v5.md` published** — canonical record of v5's identity, scope, and decisions. (You're reading it.)

**3. PRD-v4 dated note in its "Out of Scope" section.** A single line under "Scheduled / cron-based Analysis": `Update — 2026-MM-DD: v5 shipped active-session indicators + in-window notifications instead; Scheduled Analysis moves to v6.` v4's body otherwise untouched, per Slice 32's principle A.

**4. CONTEXT.md update.** New glossary term: **Notification** (see [Notification (new glossary term)](#notification-new-glossary-term) above). One paragraph added under the existing "Sessions and terminals" section.

**5. Release ceremonials.** `package.json` 0.4.0 → 0.5.0. CHANGELOG `[Unreleased]` → `[0.5.0] — YYYY-MM-DD`. New empty `[Unreleased]` opens for v6. `git tag v0.5.0`.

**6. HITL verification.** Dogfood v5: open Mesh, Resume two Claude Code Sessions across different Projects, walk away for 2 minutes. Verify:
- Both Sessions show green tint + spinner that drops to green-only when the agents idle.
- Both Projects' sidebar items, ProjectCards tiles, and the active Project's Detail pane reflect the same state.
- Two toasts fire (one per idle event), both land in the dropdown.
- Clicking "Jump to session" on one notification lands on the right Pty Tab + marks read.
- Toggling global mute suppresses toasts but still stores the row.
- Toggling per-Project mute on one Project but not the other behaves correctly.

Same HITL shape as v4's Slice 37.

## Testing Decisions

Test scope mirrors v4's pattern: unit-test the deep modules (SQL boundaries, timing logic, validation logic); defer renderer-side component testing per Slice 35's reasoning (adding React Testing Library + jsdom for a handful of assertions is out of scope; the build's TypeScript pass + HITL cover renderer correctness).

| Module | Test? | Pattern |
|---|---|---|
| `notifications-repository` | ✅ | Mirrors `settings-repository.test.ts` — CRUD round-trip, list ordering (newest-first, unread-first), markRead scoping, retention sweep cutoff |
| `idle-detector` | ✅ | Injectable clock + injectable PTY data feed; tests cover: 8 s threshold, foreground suppression, debounce (no second fire during same idle period), re-arm after activity resumes, re-arm after PTY exit, auto-mark-read triggers |
| Migration `0004_notifications` | ✅ | Schema migration upgrade-cycle test (Slice 30 pattern) — apply migrations from 0000, verify table exists with expected columns and indexes |
| Settings extensions (`notifications_global_mute`) | ✅ | Mirrors Slice 36's `setActiveProvider` test shape — 6 tests covering default-when-absent, round-trip persistence, stable key shape, boundary validation, overwrite-on-second-set, corruption fallback |
| Per-Project mute on augmentation row | ✅ | Mirrors existing `projects-augmentation.test.ts` patterns |
| Notification IPC handlers (in `index.ts`) | ⏸ | Indirectly covered by repository + idle-detector tests; full IPC integration deferred per project convention |
| `useLiveSessions` hook | ⏸ | Renderer-side; would require RTL + jsdom infra Slice 35 deferred |
| `<NotificationToast>` / `<NotificationDropdown>` | ⏸ | Renderer-side; same reasoning |
| Indicator surface CSS / JSX (green tint, spinner placement) | ⏸ | Visual; covered by HITL in Slice 44 |
| `<ActivitySpinner>` component | ⏸ | Visual; the existing Analyze spinner has no tests either |

**Estimated test delta:** 207 → ~235 tests.

**What makes a good test for this feature:** External behavior only. For the idle detector: feed it PTY-data events and clock ticks, assert that `notifications:created` events fire (or don't) at the expected moments. Never assert on internal timer handles or intermediate state. For the repository: assert that `listNotifications` returns rows in the expected order after given inserts/updates — never inspect SQL strings or row IDs unless the test is specifically about retention cutoff.

**Prior art:**
- `tests/settings-repository.test.ts` — pattern for SQL-boundary repository tests (round-trip, validation, default-when-absent)
- `tests/orchestrator.test.ts` — pattern for injectable-dependency unit tests (injectable clock via `now`, injectable git via `runGitLog`)
- `tests/schema-migration.test.ts` (Slice 30) — upgrade-cycle pattern for new migrations
- `tests/model-clients.test.ts` — pattern for tests over external SDK interactions with seam-injected fakes

## Out of Scope (deferred to v6+)

Everything PRD-v4's "Out of Scope" list contains stays deferred, minus the v5 work. Specifically:

**Deferred to v6:**

> **Update — 2026-07-07:** v6 became renderer hardening (see [PRD-v6](./PRD-v6.md)) — renderer test infrastructure, Zustand state consolidation, and the portal PtyView host. Pattern-matching Notification kinds are the leading v7 feature candidate per v5 dogfood; Scheduled / cron-based Analysis queues behind them.

- **Scheduled / cron-based Analysis** — explicit candidate for v6 per the v4 planning Q1 split as updated by v5 planning. Brings its own decision tree (always-on vs OS-scheduled, catch-up semantics, notifications when a scheduled run completes — which now plugs into v5's notification subsystem, throttling, per-Project vs global). The notification surface v5 ships is intentionally designed to receive future signal sources, of which Scheduled Analysis run completion is the most obvious next consumer.

**Deferred to v7 or later:**
- **Notification `kind` subtypes** (`approval` / `complete` / `question`) via PTY-stdout pattern matching. Schema and renderer support multiple kinds from day one; the detectors are the deferred work.
- **System-level (macOS) notifications.** v5 is in-window only — no `new Notification()` calls, no macOS permission prompts. Avoids the friction of permission flows and keeps Mesh's notification surface inside the app.
- **Notification grouping / collapsing** in the dropdown (e.g., "3 notifications from Project X"). Each notification is its own row in v5.
- **Notification snooze / "remind me in 1 hour."** Not requested; adds state machine complexity.
- **Per-type silence controls** (e.g., mute idle but keep approval). Only one type exists in v5; granularity is premature for an empty taxonomy.
- **Do-Not-Disturb time windows** (quiet hours). Adds a cron-like config surface for a need that hasn't actually emerged. v5's foreground suppression covers the "I'm not at my desk" case.
- **Auto-DND based on user activity** (e.g., suppress when the user has been keyboard-idle for 5+ min). Clever but not asked for.
- **Cross-Project / cross-Session notification filtering** in the dropdown. v5 ships a flat list with newest-first ordering.
- **Notification persistence beyond 7 days** without user setting. v5 hard-codes 7-day retention.
- **Functional Local Provider** (Ollama and OpenAI-compatible self-hosted servers) — unchanged from v4
- **Suggested Next chips** (fourth Analysis panel) — unchanged from v4
- **Editable Monaco file editor** (ADR-0004 remains in force) — unchanged from v4
- **Soft onboarding flow with UI Mode preselect** — unchanged from v4
- All other v4-Out-of-Scope items not enumerated here remain deferred per their original PRDs.

**Deferred to Go-Public (future v1.0.0):**
- arm64 `.dmg`
- Code signing + notarization
- Auto-updater via `electron-updater`
- True clean-room fresh-machine launch verification
- Crash reporting
- Windows installer
- Linux installer
- Playwright e2e tests

## Risks and Open Items

- **State lift may surface latent Pty Tab bugs.** Today's renderer-side `ptyTabs` array is local to `WorkspaceScreen` and is silently lost on Project switch. v5 lifts state to App level — which fixes that latent bug but may surface main-process / renderer-state desync that was previously masked (e.g., a tab whose PTY exited but whose renderer entry never got the `pty:exit` event). Mitigation: Slice 39's tests cover the registry's response to every documented `pty:*` event; Slice 44's HITL exercises Project-switching mid-session.
- **Idle threshold of 8 s may need tuning.** 8 s was chosen as a reasonable midpoint between "Claude paused mid-thought" (3–5 s) and "agent is definitely waiting" (15 s+). Real dogfood may show 8 s misfires on long generations, or feels too slow for snappy "task complete" detection. Mitigation: the threshold is a single constant in the idle detector; tuning is a one-line change. If dogfood reveals systemic mistuning, Slice 44's HITL findings inform a follow-up commit.
- **Pattern matching for kind subtypes is explicitly deferred.** v5's notifications are accurate but generic ("Agent is idle"). If users find generic labels insufficient, the pressure to add pattern matchers may arrive sooner than v6. Mitigation: the schema and renderer support unknown kinds gracefully; adding a `kind = 'approval'` detector in a future polish slice is non-breaking.
- **No system-level notifications.** A user with Mesh minimized in the background will not see a toast — toasts render in Mesh's window. The user must have Mesh visible on at least one desktop / space to see toasts. The dropdown catches up everything they missed on next focus. If this proves insufficient in practice, system-level notifications are a candidate for v6+ (with their own macOS permission flow).
- **First real migration since Slice 30.** Slice 30 introduced the schema-migration upgrade-cycle test as preparation for this exact moment. Slice 41 is the first migration to use that harness. Mitigation: the harness was deliberately designed to catch this category of regression; if a column shape or index name turns out wrong, the test fails before the slice ships.
- **`useLiveSessions` becomes a critical App-level dependency.** Four indicator surfaces + the Workspace tab bar + the idle detector's foreground-suppression check all read from it. A bug in the hook (stale state, missed updates) affects everything. Mitigation: keep the hook small (it's essentially a `Map<slotId, TabRecord>` with insert/update/delete + a subscriber list); test the underlying state machine independent of React in a vitest unit test.
- **Bell icon competing with theme toggle for top-bar attention.** The right side of the top bar gains a third icon (Bell + Sun/Moon + Settings). At narrow window widths this may crowd. Mitigation: visual review in Slice 42; if crowding occurs, the BellOff variant can hide its label and the unread dot remains the only signal.

## Slice Index

| # | Title | Issue |
|---|---|---|
| 39 | Lift Pty Tab state to App level + per-Session indicators (Workspace) | [#39](https://github.com/itsrichardhaar/Mesh/issues/39) |
| 40 | Project-level aggregation (sidebar + ProjectCards + Detail pane) + "Active" → "Recent" rename | [#40](https://github.com/itsrichardhaar/Mesh/issues/40) |
| 41 | Notification backend (migration 0004 + idle detector + IPC surface) | [#41](https://github.com/itsrichardhaar/Mesh/issues/41) |
| 42 | Notification UI (toast + dropdown + bell icon + Jump-to-session) | [#42](https://github.com/itsrichardhaar/Mesh/issues/42) |
| 43 | Silence controls (global + per-Project + BellOff variant) | [#43](https://github.com/itsrichardhaar/Mesh/issues/43) |
| 44 | PRD-v5 + ADR-0006 + v0.5.0 release ceremonials | [#44](https://github.com/itsrichardhaar/Mesh/issues/44) |

Per v1/v2/v3/v4 workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; manual verification before close.

## Further Notes

- v5 keeps `~/.claude/projects/` as the canonical Project source (ADR-0002 unchanged).
- v5 keeps SQLite + `safeStorage` + the existing IPC surface as foundation. Additions: one new table (`notifications`), one settings key (`notifications_global_mute`), one new column on projects augmentation (`mute_notifications`), one new IPC namespace (`notifications.*`), four new IPC event channels (`notifications:created`, `notifications:updated`, `notifications:cleared`, plus the existing PTY events repurposed for state-lift signaling).
- v5 keeps the `AnalysisOutput` schema and the Active Provider mechanism unchanged. ADR-0003 + ADR-0005 remain in force.
- v5 keeps Monaco read-only (ADR-0004 unchanged).
- v5 introduces ADR-0006 (in-window notifications surface). Future notification sources — Scheduled Analysis run completion (v6), other event types later — plug into the same table + IPC surface introduced here.
- v5 introduces one new glossary term: **Notification**. CONTEXT.md is updated in Slice 44.
- v5 renames the Home Screen's "Active Projects" section to "Recent Projects" (Slice 40) to free up "active" semantics for the new feature. The underlying section behavior (sort by Last Activity) is unchanged.
- v6 is Scheduled / cron-based Analysis per the planning split as updated by v5. v6 planning happens when v5 ships; the decision tree (always-on vs OS-scheduled, catch-up semantics, notifications when a scheduled run completes — which now plugs into v5's notification subsystem, throttling, per-Project vs global) is unresolved and not premature to lock today. *(Update — 2026-07-07: superseded; v6 became renderer hardening per PRD-v6. Pattern-matching kinds lead the v7 candidate pool; Scheduled Analysis queues behind them.)*
