# Mesh v8 — Product Requirements Document

> Glossary terms (**Usage**, **Usage Event**, **Notional Cost**, **Token Composition**, **Activity Heatmap**, **Subscription Utilization**, **Quota**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v7 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; **v8 records no new ADRs** — it is a read-layer + one-setting release governed by the decisions already in place (esp. ADR-0009 rebuildable cache, ADR-0010 Notional Cost not spend).
>
> Unlike v7 (a feature release that touched every layer — a new migration, new IPC, an IA rework, and Mesh's first network call), **v8 is deliberately thin below the renderer**: no schema change, no new ADR, one new Settings key, and one additive field on an existing IPC payload. Everything else renders over the Usage spine v7 already shipped.

## Goal

**v8 completes the Usage story on the v7 spine.** v7 shipped spine-first — ingest, Notional Cost, the global dashboard, by-project/by-model breakdowns, the session explorer, the Project Screen, and networked Quota (`v0.7.0`, 2026-07-14). v8 lands the three Usage fast-follows that v7 deliberately deferred, all reading over the `usage_events` cache that already works.

v8 ships three things:

1. **Token Composition** — the share of Usage tokens across the four token classes (Input, Output, Cache-Read, Cache-Write), answering "what *kind* of tokens am I consuming?" A range-aware breakdown card on the Home Screen.
2. **Activity Heatmap** — a calendar view of Usage intensity over a recent span, so streaks and gaps read at a glance. It shares the Home Screen's time-visualization slot with the usage trend via a **Trend | Heatmap** toggle.
3. **Subscription Utilization** — a calendar month's Notional Cost against a user-entered flat monthly plan fee, answering "is the subscription paying off?" A gauge on the Home Screen, gated behind a new plan-fee Settings field.

**Scope is renderer-heavy by design.** The one main-process change is an additive extension of the per-day series with its four token-class counts (pure derivation from columns already stored — no migration). The heatmap and Subscription Utilization compute client-side over the day series the dashboard already returns. The plan fee is one new Settings key read through the generic setting IPC. Nothing reopens the ingest pipeline or the schema.

## Context

Two inputs set v8's shape:

1. **v7's own deferral.** PRD-v7's "Out of Scope → v8" named exactly these fast-follows: activity heatmap, token composition, by-model breakdown, and the Subscription Utilization gauge (with its plan-fee setting). Of those, **by-model shipped early** as post-release polish on Slice 55 (commit `ca6d619`), so v8 carries the remaining three.
2. **A planning grill (2026-07-14)** walked the three features against CONTEXT.md and the ADRs. The load-bearing decisions:
   - **Four token classes, schema-free.** Token Composition shows only the four classes `usage_events` stores; reasoning/thinking tokens (a companion-app row, sourced from Codex which Mesh dropped) are folded into `output` and are **not** broken out — doing so would reopen ingest + a migration for no Claude-only benefit.
   - **The heatmap must survive color removal.** A hue-ramped calendar would violate the reduced-color-vision constraint outright; v8 encodes intensity by **lightness + cell-fill size + on-hover value + a named legend**, so magnitude reads three ways without hue.
   - **Subscription Utilization is monthly and decoupled from the range toggle.** A monthly fee only makes sense against a calendar month; wiring it to the 30d/90d/all range slider would produce a meaningless denominator.
   - **Global-only.** All three views live on the Home Screen. Subscription Utilization is account-global by nature (the plan fee is account-level); per-Project composition/heatmap are deferred to keep v8 tight.

What v8 changes relative to `v0.7.x`:

- **The Home dashboard shows *how much* and *by whom/what*, but not *what kind* or *when-shaped*.** Token totals, Notional Cost, trend, by-project, and by-model all ship — but there is no token-class breakdown and no calendar view of intensity.
- **Notional Cost has no anchor.** A user sees "$X at API rates" with no sense of whether their flat subscription is worth it. The plan fee is the missing constant that turns Notional Cost into an answerable "paying off?" question.

## Scope

Four slices, sequenced cheapest-payload-first, then the two client-only views, then release:

```
Slice 58   Token Composition card (extend day series with token-class split; range-aware share card on Home)
Slice 59   Activity Heatmap + Trend | Heatmap view toggle in the shared time slot (color-safe encoding)
Slice 60   Plan-fee Settings field + Subscription Utilization gauge (Home)
Slice 61   PRD-v8 + CONTEXT + v0.8.0 release ceremonials + HITL gate + packaged-build install
```

(Slice numbers continue from v7's `57`; slice numbers stay aligned with issue numbers from `#58`.)

Each slice is independently committable and demoable:
- After 58: the Home dashboard shows a Token Composition card — the four token-class shares over the active range (Input / Output / Cache-Read / Cache-Write), always a token share (never Notional Cost).
- After 59: the time-visualization slot toggles between the usage **Trend** and a ~1-year **Activity Heatmap** (stretched full-width like the trend); intensity follows the Tokens/Notional-Cost metric toggle; the granularity control hides in Heatmap mode; the heatmap is legible with color removed.
- After 60: entering a monthly plan fee in Settings reveals a **Subscription Utilization** gauge — this calendar month's Notional Cost as a percent of the fee, with the Quota-style fill + % + label encoding; clearing the fee hides the gauge.
- After 61: v8 formally closes — PRD-v8 committed, CONTEXT terms recorded, `v0.8.0` tagged, and the packaged build installed into `/Applications/Mesh.app`.

## Implementation Decisions

### Token Composition (Slice 58)

- **The one payload change in v8.** `UsageDayPoint` (the per-day series the dashboard already returns) gains four class counts — `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` — derived in `buildDayPoints` from the columns already stored. No migration; the day series stays the single client-side source for trend, heatmap, and composition.
- **Range-aware, granularity-agnostic.** Composition sums the four classes across the active range (30d/90d/all) and renders shares; it is a breakdown, not a time series, so granularity does not apply.
- **Always a token share, never cost.** Cache-Read tokens are nearly free, so a cost-weighted composition would tell a misleading story; the card is fixed to token shares regardless of the Tokens/Cost toggle.
- **Layout** mirrors the existing ranked-list cards: a stacked proportion bar + labeled rows (class · tokens · %), styled in Mesh's theme.

### Activity Heatmap + view toggle (Slice 59)

- **Shares the time slot with the trend.** A segmented **Trend | Heatmap** control swaps the visualization in place — one slot, two view modes, rather than a second stacked card.
- **Client-side over the day series.** The heatmap buckets the existing per-day series into a **~1-year (53-week)** calendar (weeks as columns, weekdays as rows), stretched to fill the container width like the trend chart (responsive square cells). *Realized decision (Slice 59):* a 26-week window left a large empty gap beside the full-width trend; a rolling year fills the width, matches the GitHub-style reference, and reads as sparse-but-honest on young data.
- **Color-safe encoding (the reduced-color-vision constraint).** Intensity is a **single-hue lightness ramp** (darker = more), *plus* an intensity-scaled **cell fill (size)**, *plus* the exact value **on hover**, *plus* a discrete **named legend** (none/low/med/high with thresholds). Magnitude reads three redundant ways; hue is never load-bearing.
- **Control visibility.** The metric toggle (Tokens / Notional Cost) applies to both views and stays visible. The granularity (Day/Week/Month) and range (30d/90d/all) controls are Trend-only and **hide** in Heatmap mode (the heatmap owns its window) — hidden, not disabled, so there are no dead controls.

### Subscription Utilization + plan-fee (Slice 60)

- **Plan fee is one free-form monthly USD number** stored under a new Settings key, read/written through the existing generic `getSetting`/`setSetting` IPC. **No plan-tier dropdown** — hardcoded Pro/Max prices drift and go stale (the trap ADR-0010 warns of); a placeholder hint suffices, and annual-plan users enter fee ÷ 12.
- **The metric = current calendar month's Notional Cost ÷ monthly plan fee**, computed client-side by summing the day series over the current month. Independent of the range/granularity toggles.
- **Gauge presentation** reuses the Quota chip's reduced-color-vision encoding: fill length + numeric % + label. At ≥ 100% the label reads "paying off"; below, "…% of your plan's value."
- **Framing honors ADR-0010.** The numerator stays *notional* (API-rate value); the denominator is a flat constant the user typed and is **never** decremented per Usage Event. A clarifier states "value received at API rates vs. your flat fee — not money spent." This is an *application* of Notional Cost, not a new pricing principle — hence no new ADR.
- **Empty state:** no fee entered → the gauge is hidden behind a "Set your plan fee" affordance, mirroring the Quota opt-in pattern.

### PRD-v8 + release ceremonials (Slice 61)

Mirrors the v4/v5/v6/v7 closing-slice pattern.

1. **`docs/PRD-v8.md` committed** — this document, drafted up front and held across Slices 58–60.
2. **CONTEXT.md terms committed** — **Token Composition** and **Activity Heatmap** added, **Subscription Utilization** sharpened to "calendar month" with the fee-never-decremented clarifier (all written during the planning grill).
3. **PRD-v7 dated note.** Its "Out of Scope → v8" list gains: `Update — <date>: v8 shipped token composition, activity heatmap, and Subscription Utilization; by-model already shipped in v7 polish.` v7's body otherwise untouched.
4. **Release ceremonials.** `package.json` 0.7.0 → 0.8.0. CHANGELOG `[Unreleased]` → `[0.8.0] — YYYY-MM-DD`; new empty `[Unreleased]` opens for v9. `git tag v0.8.0`.
5. **Packaged-build install.** Build via `pnpm dist` and install into `/Applications/Mesh.app` for daily use (the deferral set at v7 close — v0.7.0 was never installed; v0.8.0 becomes the first installed post-v6 build).
6. **HITL verification** (the parts tests can't reach) — see Testing Decisions.

### CONTEXT.md changes

v8 introduces two glossary terms (**Token Composition**, **Activity Heatmap**) and sharpens one (**Subscription Utilization**), all written during the planning grill. Implementation vocabulary — *view toggle*, *lightness ramp*, *53-week window*, *day series* — stays OUT of the glossary (the same call v6/v7 made). No Relationships change: these are views over Usage Events and Notional Cost, which the Relationships section already covers.

### No new ADRs (why)

None of v8's decisions clears the bar (hard-to-reverse + surprising + a real trade-off with genuine alternatives):
- The **color-safe heatmap** encoding follows an existing, documented constraint — it is a UI application, not a new architectural decision.
- **Subscription Utilization** is governed by ADR-0010 (Notional Cost not spend); it applies that principle rather than establishing a new one.
- The **day-series extension** and the **plan-fee setting** are trivial and reversible.

## Testing Decisions

v8 keeps the v6/v7 test policy: **renderer-touching slices ship renderer tests**, and main-process logic ships node tests. Visual/chart surfaces (SVG/heatmap pixels) and hue-independence are HITL, as xterm, Monaco, and the v7 charts already are.

| Module | Test? | Pattern |
|---|---|---|
| `buildDayPoints` token-class extension | ✅ | Pure: per-day class counts sum correctly; totals unchanged |
| Composition share math (range sum → shares) | ✅ | Pure over fixtures; shares total 100%, empty-range guard |
| Heatmap bucketer (day series → 53-week grid) | ✅ | Pure: correct week/weekday cells, window edges, empty days |
| Subscription Utilization math (month cost ÷ fee) | ✅ | Pure; month boundary, missing-fee → hidden, ≥100% label |
| Plan-fee setting round-trip | ✅ | Node: set/get through the settings repository; invalid/blank input |
| Token Composition card | ✅ | RTL over accessible queries; shares + labels; range re-computes |
| Trend \| Heatmap view toggle + control visibility | ✅ | RTL: toggle swaps view; granularity/range hide in Heatmap; metric persists |
| Subscription Utilization gauge (hidden until fee, %/label) | ✅ (logic) / ❌ (visual) | RTL asserts hidden-without-fee + %/label; hue-independence is HITL |
| Heatmap pixel rendering (lightness + cell size) | ❌ HITL | jsdom has no layout; color-safe legibility in Slice 61 gate |

**Estimated test delta:** 405 → ~430.

**Slice 61 HITL gate:**
- Token Composition shares match a hand spot-check of the four class totals over one range; switching range re-computes.
- Toggle Trend ↔ Heatmap: the slot swaps in place; the granularity + range controls hide in Heatmap and return in Trend; the metric toggle persists across both.
- The Activity Heatmap is legible with color removed — lightness *and* cell fill *and* the hover value each convey intensity; the named legend buckets read correctly.
- Enter a plan fee → the Subscription Utilization gauge appears with this month's Notional Cost as a plausible percent; clear the fee → the gauge hides cleanly; the gauge is legible with color removed.
- All new SVG/heatmap surfaces render correctly in both themes.
- `pnpm dist` produces a packaged build that launches from `/Applications/Mesh.app` with the full Usage dashboard intact.

## Out of Scope (deferred)

**Later / v9-era:**
- **Per-Project Token Composition and Activity Heatmap.** v8 ships both globally on the Home Screen; the Project Screen keeps its existing Usage strip. Per-Project variants are a straightforward follow-on once the global versions prove out.
- **Reasoning/thinking token isolation.** Would require an ingest + schema change (a new token column, a migration, a rebuild) for a Claude-only benefit that is currently folded into `output`. Not worth reopening ADR-0009's cache for in v8.

**v9:**
- **Pattern-matching Notification kind subtypes** (`approval` / `complete` / `question`) via PTY-stdout parsing — the former leading v7 candidate, still fully pre-staged (open `kind` column, reserved `--timeline-*` tokens, the `IdleDetector.onPtyData` seam). Unchanged in readiness.

**Not planned under any current release:**
- **Plan-tier presets / live plan pricing** — the plan fee stays a user-entered constant; Mesh does not track Anthropic's plan prices.
- **Real spend / billing-API integration** — ADR-0010 forbids it without a new ADR; Subscription Utilization is notional-vs-fee, not spend.
- **Multi-currency / non-USD fees** — the fee and Notional Cost are both USD.
- **Codex or any second Provider** — ADR-0002 holds; Mesh stays Claude-Code-only.
- **Scheduled Analysis, Analysis quality evals, error observability, the Go-Public checklist** — unchanged from PRD-v6/v7's deferral lists.

## Risks and Open Items

- **Heatmap density on young data.** The `usage_events` cache is ~1 month old at v8 planning; a full-year calendar will look sparse. Accepted deliberately (Slice 59): full-width parity with the trend chart was the stronger UX signal than a denser-but-narrow grid, and the named legend keeps low-density cells interpretable. The grid fills in as history grows.
- **Reduced-color-vision correctness on the heatmap and the Utilization gauge.** A shade-only heatmap or a hue-coded pass/fail gauge would be invisible to the user. Mitigation: lightness + cell-fill size + hover value + named legend on the heatmap; fill + % + label on the gauge; both verified with color removed in the HITL gate. This is the sharpest constraint in v8.
- **Subscription Utilization mis-read as spend.** Comparing Notional Cost to a real dollar fee invites the "money spent" reading ADR-0010 forbids. Mitigation: the numerator stays notional, the fee is never decremented per-use, the clarifier says so, and CONTEXT.md pins the wording.
- **The plan fee is a static, user-entered constant.** A plan change means the user must re-enter it; a stale fee silently skews the gauge. Mitigation: acceptable for v8 — the fee lives in Settings where the user set it, and the gauge is opt-in via that field; no automatic plan detection is attempted (that would need Anthropic plan data Mesh does not have).
- **Day-series payload growth.** Adding four ints per day to `UsageDayPoint` grows the dashboard payload. Mitigation: negligible — four integers × days-of-history is trivial, and it removes any need for a separate composition round-trip.

## Slice Index

| # | Title | Issue |
|---|---|---|
| 58 | Token Composition card (extend day series with token-class split; range-aware share card on Home) | #58 |
| 59 | Activity Heatmap + Trend \| Heatmap view toggle in the shared time slot (color-safe encoding) | #59 |
| 60 | Plan-fee Settings field + Subscription Utilization gauge (Home) | #60 |
| 61 | PRD-v8 + CONTEXT + v0.8.0 release ceremonials + HITL gate + packaged-build install | #61 |

Per v1–v7 workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; manual verification before close; `hitl` label on the closing slice.

## Further Notes

- v8 keeps `~/.claude/projects/` as the canonical source (ADR-0002/0009), the provider mechanism (ADR-0003/0005), read-only Monaco (ADR-0004), the notification subsystem (ADR-0006), Zustand stores (ADR-0007), the portal PtyHost (ADR-0008), Notional Cost (ADR-0010), and the networked Quota exception (ADR-0011) all in force and unchanged.
- v8 makes **no** SQLite schema change and records **no** new ADR. The only main-process change is the additive `UsageDayPoint` token-class extension; the only new persisted state is the plan-fee Settings key.
- `token-usage-analytics` remains the reference for the composition and heatmap layouts; no code crosses over.
- v9 planning happens when v8 ships; pattern-matching Notification kinds re-enter as the leading candidate (pre-staged since v6), with per-Project Usage views as a secondary track.
