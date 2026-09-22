# Mesh v10 — Product Requirements Document

> Glossary terms (**Usage**, **Usage Event**, **Usage Filter**, **Timeframe**, **Metric Card**, **Notional Cost**, **Token Composition**, **Activity Heatmap**, **Subscription Utilization**, **Quota**, **Project**, **Session**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v9 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force. **v10 records one new ADR — [ADR-0013](./adr/0013-usage-filter-parameterized-query.md)** — the Usage Filter re-scopes the filtered views via parameterized main-process queries, not client-side folding.
>
> **v10 makes no SQLite schema change.** The existing `usage_events` indices (`idx_usage_events_time`, `idx_usage_events_project` from migration `0006`) already cover the new filter predicates. ADR-0009's rebuildable-cache shape is untouched — v10 reads it with `WHERE` clauses.

## Goal

**v10 turns the Usage views from a fixed all-time snapshot into a filterable workspace, and gives the headline numbers a glanceable redesign.** v7–v8 shipped the Usage spine (ingest, Notional Cost, trend, composition, heatmap, by-project/by-model, sessions, Subscription Utilization). But the dashboard is static: every view is all-time and all-project, the top cards are raw totals, and the top-bar Quota is a read-only glance. v10 adds the interaction layer that was always the point of collecting the data.

v10 ships three things:

1. **The Usage Filter** — a control bar of `Tokens | Cost` + a **Project** selector + a **Timeframe** selector (All time / This Month / Last 7 / 30 / 90 Days). It re-scopes the **filtered views** — the usage trend, Token Composition, By-model, and the Sessions table — in place. Selecting a Project also scopes the Sessions table to that Project and hides the (now-redundant) By-project breakdown. There is **no** Provider filter (Claude-only, ADR-0003) and **no** session search.
2. **Redesigned global Metric Cards** — four headline cards that stay **global** regardless of the Usage Filter, computed in main on the user's **local calendar day**: **Today** (tokens · sessions), **7-Day** (tokens · active days), **This Month** (tokens · avg per active day), and **Subscription Utilization** (now shown as an **"N× your plan fee"** multiple with the notional figure alongside).
3. **A clickable Quota dropdown** — the top-bar 5-hour and weekly bars become clickable, opening one notifications-styled panel that shows both windows with their percent-used bar, percent-remaining, and time-to-reset.

**Ported from the `token-usage-analytics` companion app** (the same reference that seeded v7), converted to Mesh's UI, styles, glossary, and local-first constraints. Two deliberate divergences from the reference: its filter bar also has a Provider dropdown and a session search (both dropped here), and its metric cards are *filtered* — Mesh's are **global** (Today/7-day/month are already time-scoped, so layering a Timeframe on them would be incoherent).

## Context

Two inputs set v10's shape:

1. **The reference dashboard.** `token-usage-analytics` filters server-side via query params (`provider`/`project`/`start`/`end`) that compose across every view, computes Today/7-day/month summaries and a subscription-utilization multiple, and renders a "Claude Code Quota" panel with both windows. Mesh already has the equivalent *data* (the `usage_events` cache) and most of the *views*; v10 adds the filter interaction, the redesigned cards, and the Quota panel.
2. **A planning grill (2026-07-27)** walked the port against CONTEXT.md and the ADRs. The load-bearing decisions:
   - **Parameterized queries, not client-side folding (ADR-0013).** The renderer's existing `days[]`-folding can't honor a Project filter — `days[]` has no project/model dimension. Rather than ship a granular cube + the full session list, main re-queries the cache with predicates. `Tokens|Cost` and granularity stay client-side; only Project/Timeframe re-fetch.
   - **Metric Cards and the Activity Heatmap are global.** They ignore the Usage Filter by design; the heatmap stays a rolling-year, all-project calendar (the one filtered-area view that opts out, to avoid a degenerate 7-day strip).
   - **Local-timezone Metric Cards.** "Today"/"This Month" are computed on the user's local calendar day (in main), so they match the user's wall clock rather than rolling over at UTC midnight. The rest of the UTC-keyed pipeline is left as-is for v10.
   - **Subscription Utilization is a multiple, phrased "× your plan fee".** Not "× value" — CONTEXT.md's avoid-list forbids "value" for this metric. ADR-0010 holds (numerator notional, fee a flat constant).

What v10 changes relative to `v0.9.x`:

- **The dashboard is all-time and all-project, always.** There is no way to ask "how much did I spend on Project X last month?" — every view answers only "all of everything, forever."
- **The top cards are raw totals** (Sessions / Tokens / Cost), not the glanceable Today/7-day/month rhythm the reference proved out.
- **The top-bar Quota is a dead-end glance** — the percentages show, but the reset times and remaining headroom aren't reachable without leaving the app.

## Problem Statement

As a heavy Claude Code user with many Projects, I open Mesh's Usage views and can only see all-time, all-project totals. I can't answer the questions I actually have — "how many tokens did Project X burn this month?", "what did last week look like?", "which sessions in this Project were the expensive ones?" The headline numbers are raw lifetime totals that don't tell me about *today* or *this week*, and the top-bar Quota shows a percentage but hides the one thing I need under time pressure: when it resets and how much headroom is left.

## Solution

A filter bar sits atop the Usage views: toggle **Tokens / Cost**, pick a **Project**, pick a **Timeframe**, and the trend, Token Composition, By-model breakdown, and Sessions table all re-scope in place — pick a Project and the Sessions table narrows to that Project's sessions (most-recent first) while the redundant By-project card drops away. Above the filter, four always-global cards give the at-a-glance rhythm — what you burned **today**, over the **last 7 days**, and **this month** (with your daily average), plus whether your subscription is paying off as a clean **"N× your plan fee"** multiple. And the top-bar Quota bars become clickable: one panel drops down showing both the 5-hour and weekly windows — percent used, percent remaining, and exactly when each resets.

## User Stories

1. As a Mesh user, I want a Timeframe selector on the Usage views, so that I can look at This Month / Last 7 / 30 / 90 Days / All time instead of only all-time.
2. As a user, I want the usage trend to re-scope to the selected Timeframe, so that the chart shows the period I care about.
3. As a user, I want Token Composition to re-scope to the selected Timeframe, so that the token-class mix reflects that period.
4. As a user, I want the By-model breakdown to re-scope to the selected Timeframe, so that I see which models I used in that period.
5. As a user, I want a Project selector, so that I can focus every filtered view on a single Project.
6. As a user, when I select a Project, I want the Sessions table to show only that Project's sessions, so that I can review that Project's work.
7. As a user, when I select a Project, I want the trend, composition, and by-model views to scope to that Project, so that the whole filtered area answers questions about that one Project.
8. As a user, when I select a Project, I want the By-project breakdown to disappear, so that I'm not shown a pointless single-row 100% chart.
9. As a user, I want a Tokens / Cost toggle that flips the trend, heatmap, by-model, and by-project views between token counts and Notional Cost, so that I can read either dimension without leaving the page.
10. As a user, I want the Tokens/Cost toggle and the Day/Week/Month granularity to respond instantly (no reload), so that the frequent interactions feel immediate.
11. As a user, I want the Timeframe to default to This Month, so that I land on a bounded, useful view rather than an all-time dump.
12. As a user, I want Token Composition to always show token shares regardless of the Tokens/Cost toggle, so that a cheap-cache-read cost split never misleads me.
13. As a user, I want the filters to reset to defaults when I restart Mesh, so that each session starts from a predictable state.
14. As a user, I want a **Today** card showing today's tokens and session count, so that I can see the current day's activity at a glance.
15. As a user, I want a **7-Day** card showing the last 7 days' tokens and how many of those days were active, so that I can gauge my recent cadence.
16. As a user, I want a **This Month** card showing this month's tokens and my average per active day, so that I can sense my monthly pace.
17. As a user, I want the Today / 7-Day / This Month figures computed on my local calendar day, so that "today" matches my wall clock and doesn't roll over in the afternoon.
18. As a user, I want the Metric Cards to stay global regardless of the Usage Filter, so that my headline rhythm doesn't change when I drill into a Project or period.
19. As a user, I want a **Subscription Utilization** card showing an "N× your plan fee" multiple with my notional dollar figure and plan fee, so that I can tell whether my subscription is paying off.
20. As a user, I want the Subscription Utilization bar to fill toward 3× the fee, so that "clearly worth it" reads at a glance.
21. As a user with reduced color vision, I want every Metric Card and bar to convey its state through numbers, labels, and bar length — not hue alone — so that I can read them regardless of color perception.
22. As a user, I want the Activity Heatmap to stay a global rolling-year calendar, so that it keeps showing long-run streaks even when I've filtered the other views to a week.
23. As a user, I want to click the top-bar 5-hour or weekly Quota bar, so that I can open a detailed panel.
24. As a user, I want the Quota panel to show each window's percent used, a bar, percent remaining, and time-to-reset, so that I know my headroom and when it refreshes.
25. As a user, I want the Quota panel to open from either bar and show both windows together, so that I get the full picture in one place.
26. As a user, I want the Quota panel styled like the notifications dropdown and dismissible by clicking away or pressing Escape, so that it behaves consistently with the rest of the app.
27. As a user, I want the Sessions table ordered most-recent-first, so that my newest sessions are at the top.
28. As a user, I want the Sessions table to show all sessions matching the current filter, so that I'm not silently limited to a top-N.
29. As a user, I want to still expand a session row to see its per-turn detail, so that I can drill into a session's cost.
30. As a user, I want to jump from a session row into that session, so that I can resume or review it.
31. As a user, I want the Provider filter and session search from the reference omitted, so that the bar stays uncluttered with controls Mesh doesn't need.
32. As a user, I want switching Project/Timeframe to re-fetch quickly, so that filtering feels responsive even over a large history.

## Implementation Decisions

Decisions below are the eight locked in the 2026-07-27 planning grill. Governing ADR: **ADR-0013**. New glossary terms: **Usage Filter**, **Timeframe**, **Metric Card**.

**Parameterized filtering (ADR-0013).** `usage:get-dashboard` gains an optional `{ timeframe, project }` argument. Main resolves the Timeframe to a date range and adds `WHERE timestamp BETWEEN start AND end` and (when a Project is selected) `AND encoded_path = ?` to its existing aggregation queries, returning an already-scoped `{ summary, days[], byModel, byProject, sessions }`. The renderer's `Tokens|Cost` toggle and Trend granularity operate **client-side** on the returned scoped `days[]` — they never re-fetch. Only Project and Timeframe changes trigger a re-fetch (debounced). No schema change; the existing `0006` indices cover the predicates.

**`resolveTimeframe(timeframe, now) → { start, end } | null`.** A pure function mapping the five Timeframe options to an inclusive date range: `all` → null (no bound); `month` → local month-start to now; `7d`/`30d`/`90d` → trailing N local days inclusive of today. This is the single source of the date math and is unit-tested independently.

**Metric Cards computed in main, global, local-tz.** A `metricCards(db, now, tz)` producer returns the four global figures on the user's local calendar day, independent of the filter argument:
- **Today**: sum of tokens for events on the local day + `COUNT(DISTINCT session)` that day.
- **7-Day**: sum of tokens over the trailing 7 local days + count of **active days** (days with any Usage) in that window.
- **This Month**: sum of tokens since local month-start + tokens ÷ active-day count (average over active days, not calendar days).
- **Subscription Utilization**: month-to-date Notional Cost, the plan fee, and the **multiple** = notional ÷ fee. Rendered as "N× your plan fee" with the notional figure alongside; the bar fills `min(multiple / 3, 1)`. Returns a not-set state when the fee is unset/≤0 (unchanged gating from v8). ADR-0010 holds — numerator notional, fee a flat constant.

**The Usage Filter state.** `state/usage.ts` gains `project: string | null` and replaces `range` with `timeframe` (`all | month | 7d | 30d | 90d`, default `month`). `metric` and `granularity` remain. Changing `project` or `timeframe` re-fetches the dashboard with the filter argument; changing `metric` or `granularity` does not. Filter state is session-only (not persisted).

**Filter bar.** A control bar renders `[Tokens|Cost] [Project ▾] [Timeframe ▾]`. The Project dropdown lists the user's Projects (display names via the existing `projectName` resolver) plus an "All projects" default; the Timeframe dropdown lists the five options with "This Month" default. The Day/Week/Month granularity toggle stays with the Trend view (Trend mode only), as today.

**By-project hides when a Project is selected.** When `project !== null`, the By-project breakdown card is not rendered (the entire view is that Project). By-model stays and is now Project-scoped. When `project === null`, By-project renders as today (top 5).

**Activity Heatmap stays global.** It ignores both Timeframe and Project — a rolling-year, all-project calendar — and continues to honor the client-side `Tokens|Cost` metric. It reads the existing global day-series, not the filtered payload.

**Sessions table.** Ordered by each session's last-activity timestamp, descending (most-recent first). Shows **all** sessions matching the current filter (Project + Timeframe), scrollable, with a high safety backstop (most-recent 500) that surfaces a "showing 500 of N" note only when exceeded. The expand-to-turns detail and jump-to-session actions are unchanged. The `Tokens|Cost` toggle no longer reorders it.

**Quota dropdown.** The top-bar `QuotaChip` inline bars (5-hour + weekly) become the click target; clicking either opens one dropdown, styled like the notifications dropdown (anchored under the chip, dismiss on outside-click / Escape). It renders both windows, each with label, "resets in Xh Ym" (reusing the existing `formatReset`), percent used, a fill bar, and percent remaining = `max(0, 100 − percentUsed)`. Gating is unchanged — the chip and dropdown exist only when Quota is opted-in and a snapshot is present. Reduced-color-vision: fill length + number + label carry state; no hue dependence.

## Testing Decisions

**What makes a good test here:** exercise external behavior through a module's public interface, not its internals. v10's correctness-critical logic is the date math and the local-tz aggregation, both of which are pure or DB-level and testable without Electron.

- **`resolveTimeframe` (M1, pure).** All five options → correct inclusive ranges, with explicit coverage of the month-boundary case (first/last day of month) and `all` → null. Prior art: the pure helpers in `util/trend.ts` / `util/heatmap.ts`.
- **`metricCards` (M3, main + in-memory DB).** Today/7-day/month tokens, sessions-today (distinct-session count), active-day counts, average-over-active-days, and the utilization multiple — all on **local-tz** day boundaries (seed events straddling a UTC midnight to prove local bucketing). Prior art: `tests/usage-dashboard.test.ts`, `tests/usage-repository.test.ts` (in-memory SQLite + `runMigrations`).
- **Parameterized query (M2, main + in-memory DB).** Project + Timeframe predicates actually filter the aggregates: seeding two Projects across two months and asserting a `{project, timeframe}` fetch returns only the matching subset in `days[]`, `byModel`, and `sessions`. Prior art: the usage repository/dashboard tests.
- **Renderer (M5/M7/M8, RTL).** The filter bar drives a re-fetch on Project/Timeframe change (and *not* on metric/granularity); By-project hides when a Project is selected; the Quota dropdown opens from a bar showing both windows with reset/used/remaining; the Sessions table renders most-recent-first and shows all filtered rows. Prior art: the v6 RTL harness (`tests/renderer/*`, `window.api` mock in `test-utils`).

Tests assert observable outputs (returned aggregates, rendered rows, re-fetch calls), never internal query structure.

## Out of Scope

- **Provider filter** — Mesh is Claude-only (ADR-0003); the reference's provider dropdown is dropped.
- **Session search** — dropped; the recency-ordered, filter-scoped table replaces the need.
- **Filtered Metric Cards** — the cards are global by design; they never respond to the Usage Filter.
- **Timeframe-driven Activity Heatmap** — the heatmap stays a global rolling-year calendar; it does not narrow to the Timeframe (avoids a degenerate short-window strip).
- **Full local-timezone migration** — only the Metric Cards move to local-tz in v10; the heatmap and Subscription-Utilization month bucketing stay UTC. A whole-pipeline local-tz pass is a separate future effort.
- **Persisted filter state** — filters are session-only; remembering them across restarts is a possible later nicety.
- **Per-Project Metric Cards / per-Project Quota** — Quota stays account-global (ADR-0011); cards stay global.
- **New schema / new ADR beyond ADR-0013** — no migration; the `0006` indices suffice.

> **Update — 2026-09-22 (v11 shipped, `v0.11.0`):** v11 was **Worktree Runs** (`docs/PRD-v11.md`, ADR-0014), not a Usage-dashboard cycle — it nests `no-mistakes` gate runs under their **Parent Project** (recognition + attribution + a collapsed `Gate runs (N)` disclosure), enriches each run row (pass/fail glyph, intent label, PR link) from a ring-fenced read of `~/.no-mistakes/state.sqlite`, and **rolls each run's Usage up into its Parent at query time** — by-Project merge, Parent-scoped filter expansion, and Project-Screen headline incl. Session count. No Mesh schema change (ADR-0014). The deferrals above still stand (persisted filter state, full local-tz pass, per-Project Quota); the **in-app read-only diff viewer** for a run is deferred to v12 (v11 covers merged-run diffs via the PR link).

## Further Notes

- **CONTEXT.md** gained **Usage Filter**, **Timeframe**, and **Metric Card** terms this cycle, plus notes that the Activity Heatmap is global and that Subscription Utilization is shown as a multiple ("× your plan fee", never "× value"). **ADR-0013** records the parameterized-query decision.
- **Reduced-color-vision** (`memory/user-reduced-color-vision.md`) governs the new cards, bars, and Quota panel: numbers + labels + bar length first, hue only as reinforcement.
- **Slicing (tracer-bullet, foundation-first).** Published under parent issue #68; slice issues #69–#74:
  - *Slice 69* — **Timeframe filter end-to-end**: `resolveTimeframe` (M1) + parameterized query for the timeframe predicate (M2) + `timeframe` state (M4) + the Timeframe dropdown (M5). Trend / Composition / By-model / Sessions re-scope by Timeframe. Establishes the whole parameterized-fetch architecture.
  - *Slice 70* — **Project filter end-to-end**: the project predicate (M2) + the Project dropdown (M5) + hide By-project + Sessions scoped to Project. Depends on #69.
  - *Slice 71* — **Sessions table reshape**: recency ordering + show-all + the 500 backstop/note (M8). Depends on #70.
  - *Slice 72* — **Global Metric Cards**: `metricCards` in main (M3) + the four redesigned cards incl. the Subscription-Utilization multiple (M6). Independent of the filter work; parallel with #69–#71.
  - *Slice 73* — **Quota dropdown**: clickable `QuotaChip` + notifications-styled panel (M7). Independent; parallel with everything.
  - *Slice 74* (HITL) — **PRD-v10 + ADR-0013 close-out + v0.10.0 release ceremonials + packaged-build install.** Planning artifacts (this PRD, ADR-0013, CONTEXT terms) are committed at planning time in `3827721`, so the closing slice does not re-commit them (mirrors Slice 57/61/67).
- v10 keeps `~/.claude/projects/` as the canonical source (ADR-0002/0009), Notional Cost (ADR-0010), the networked Quota exception (ADR-0011), and the notification subsystem (ADR-0006/0012) all in force and unchanged. `token-usage-analytics` remains the reference for the metric-card and quota-panel layouts; no code crosses over.
