# Mesh v7 — Product Requirements Document

> Glossary terms (**Mesh**, **Project**, **Session**, **Usage**, **Usage Event**, **Notional Cost**, **Quota**, **Analysis**, **Project Screen**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v6 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; v7 records three new ADRs (ADR-0009, ADR-0010, ADR-0011).
>
> Unlike v6 (which introduced zero new glossary terms and made no schema, IPC, or network changes), **v7 is a feature release that touches every layer**: new domain vocabulary (the **Usage** family), a new SQLite migration (`0006_usage_events`), new IPC channels (usage + quota), an information-architecture rework of the Home Screen, and — for the first time in Mesh's history — a single, ring-fenced **outbound network call** (ADR-0011).

## Goal

**v7 brings token Usage into Mesh.** It is a native reimplementation of the concepts, views, and layouts proven in the companion tool `token-usage-analytics` (a Python/FastAPI dashboard the user built over the same `~/.claude/projects/` data) — rebuilt in Mesh's Electron/React/TypeScript stack, under the same ADR and test discipline as the rest of the app. No Python ships; `token-usage-analytics` is the reference spec.

v7 ships four things:

1. **Claude Quota** — the user's top-priority signal: the subscription's 5-hour and weekly windows, each with a percent-used and a reset time, shown as a persistent top-bar chip visible on every screen. This is the one feature that cannot be derived from local logs, so it lands behind an opt-in, ring-fenced network call to Anthropic's OAuth usage endpoint (ADR-0011).
2. **A Usage ingest pipeline and rebuildable cache** — Usage Events derived from every Session's JSONL into a `usage_events` SQLite cache (ADR-0009), kept fresh by an async startup sweep and the existing chokidar watcher.
3. **Notional Cost** — Usage priced at published API rates (ADR-0010), driving a Tokens/Cost metric toggle across the Usage views.
4. **An information-architecture rework** — the Home Screen becomes the global Usage surface (the Recent Projects cards are deleted; the activity-sorted sidebar is the navigator), and a new **Project Screen** holds the per-Project overview (Usage strip → Analyze bar → Analysis accordion). The Workspace Screen is unchanged.

**Scope is spine-first.** v7 ships the cross-project Usage views that carry the most value and prove the ingest+cache spine under real load: stat cards (tokens + cost), usage trend, by-project breakdown, and the session explorer. The remaining views — activity heatmap, token composition, by-model breakdown, and the Subscription Utilization gauge — are the **v8** fast-follow, landing on a spine that already works. Pattern-matching Notification kinds, the former leading v7 candidate, move to **v9**.

## Context

Two inputs reshaped the roadmap after v6 shipped (`v0.6.0`, 2026-07-07, 326 tests):

1. **The user built `token-usage-analytics` (TUA)** — a single-machine dashboard over the same Claude Code logs Mesh reads, sharing Mesh's exact architecture (local logs as truth, SQLite as a rebuildable index, a CONTEXT.md glossary + ADRs). It surfaces an activity heatmap, usage trend, token composition, by-model / by-project breakdowns, a session explorer, Notional Cost, Subscription Utilization, and — the piece the user values most — Claude subscription Quota. The user wants those data, views, and layouts inside Mesh.
2. **A planning grill (2026-07-13)** walked the integration decision tree end-to-end. The load-bearing decisions:
   - **Native reimplementation**, not a Python sidecar or an HTTP dependency. One app, one stack, full discipline. (TUA is the spec.)
   - **Claude-Code-only.** ADR-0002 and Mesh's identity hold; TUA's Codex support and its Codex-sourced views (by-provider breakdown) are dropped. (Quota is *not* Codex-specific — see below.)
   - **Full money layer**, split across releases: Notional Cost in v7, Subscription Utilization (which needs a plan-fee setting) in v8.
   - **Quota is the top priority and comes first**, despite being the one networked exception, because it is self-contained (independent of the ingest pipeline) and the highest-value signal for a user working live in AI sessions.

What v7 changes relative to `v0.6.x`:

- **Mesh has no token-usage visibility at all.** Every assistant turn in Claude Code's JSONL carries a rich `usage` object (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `service_tier`), plus the enclosing `model`, `timestamp`, `sessionId`, `cwd`, and `uuid`. Mesh's `session-reader` already streams these exact lines for the transcript view and **throws `usage` away**. The data is one field-access from where Mesh already reads.
- **The Home Screen's right pane shows Recent Projects cards** — largely redundant with the activity-sorted sidebar, and occupying the most valuable real estate in the app with a low-information view.
- **Claude Quota is invisible.** Users learn their remaining 5-hour and weekly headroom only by running Claude Code's own `/usage`. There is no local source; the number lives behind Anthropic's OAuth usage endpoint.

## Scope

Seven slices, sequenced **quota-first** (the top-priority, self-contained feature de-risks the network exception early), then the ingest spine, then the views that render over it, then the IA rework, then release ceremonials:

```
Slice 51   Networked Quota module (opt-in, safeStorage OAuth, 429-safe) + top-bar chip
Slice 52   Usage ingest + usage_events cache (migration 0006, async sweep + watcher tail)
Slice 53   Pricing table + Notional Cost over ingested events
Slice 54   Home Screen -> global Usage views (stat cards + cost, usage trend)
Slice 55   by-project breakdown + session explorer (jump reuses v5 Jump-to-session)
Slice 56   Project Screen (Usage strip -> Analyze -> Analysis accordion); delete Recent Projects cards
Slice 57   PRD-v7 + ADR-0009 + ADR-0010 + ADR-0011 + v0.7.0 release ceremonials
```

(Slice numbers continue from v6's `50`; slice numbers stay aligned with issue numbers from `#51`.)

Each slice is independently committable and demoable:
- After 51: enable Quota in Settings; the top-bar chip shows real 5-hour and weekly percent-used with reset countdowns; disabling it or losing the credential hides the chip cleanly. Mesh with Quota *off* is still 100% local.
- After 52: `usage_events` populates on launch and stays fresh as Sessions grow; a Rebuild control wipes and re-sweeps; re-ingest is idempotent by `event_id`.
- After 53: every Usage Event carries a Notional Cost; a Tokens/Cost toggle is meaningful.
- After 54: the Home Screen's default pane is the global Usage view — stat cards (tokens + Notional Cost) and a day/week/month usage trend across all Projects.
- After 55: by-project breakdown ranks Projects by usage; the session explorer lists Sessions by usage and drills into one, with a jump into its transcript/Pty Tab via the v5 three-tier resolution.
- After 56: single-clicking a sidebar Project opens its **Project Screen** (Usage strip → Analyze → Analysis accordion); double-click still opens the Workspace; the Recent Projects cards view is deleted and the Stats Row relocates to the Project Screen.
- After 57: v7 formally closes — ADR-0009/0010/0011 recorded, PRD-v7 committed, `v0.7.0` tagged.

## Implementation Decisions

### Networked Quota (Slice 51) — ADR-0011

**Quota is Mesh's single, opt-in, ring-fenced exception to local-first.**

- A main-process module (`quota/`, isolated from the Usage ingest pipeline) reads the **Claude Code OAuth token** from the OS keychain via `safeStorage` and fetches `GET https://api.anthropic.com/api/oauth/usage` with a `User-Agent: claude-code/<version>` header. The token is used only in the `Authorization` header, never persisted, never logged, never sent to the renderer.
- **The credential is the OAuth login token, not an `sk-ant-` API key.** An `sk-ant-` key exposes only pay-as-you-go tier RPM/TPM, not subscription windows — the wrong data. v7 needs no `sk-ant-` key for anything (Notional Cost is pure math).
- **Pure parser, network at the edge.** The payload→`QuotaSnapshot` transform (mapping `five_hour`/`seven_day` windows to percent-used + reset time) is a pure, unit-tested function. The fetch, credential read, and cache are the thin untested shell (live endpoint + keychain).
- **Opt-in, default off.** A Settings toggle enables Quota; the outbound call happens only when enabled. On-demand fetch with a ~5-minute in-process cache; a `429` serves the last snapshot rather than re-hammering the aggressively rate-limited endpoint. Any failure → the chip hides.
- **Account-global surface.** One `QuotaSnapshot` renders in a single persistent **top-bar chip** (two mini-gauges: 5-hour + weekly), visible identically on every screen. Per the reduced-color-vision constraint, percent-used is encoded with **fill length + numeric % + label**, never hue alone (precedent: the v5 live-session indicators).

### Usage ingest + rebuildable cache (Slice 52) — ADR-0009

**Usage Events are a rebuildable cache, a category distinct from authored augmentation.**

- **Derivation reuses the line-parse logic** `session-reader` already runs, but is driven by its own **sweep** over all Projects/Sessions (the transcript reader is on-demand and would never populate never-opened Sessions). A Usage Event is emitted per assistant turn that reports `usage`, keyed by the message `uuid`, attributed to a Project by its containing folder's **Encoded Path** (not `cwd`, which is demoted to provenance).
- **`usage_events` is a rebuildable cache**, populated via migration `0006_usage_events.sql`. It holds only data derivable from JSONL; provenance columns (`event_id`, `source_file`, `source_line`) make every row traceable and re-ingest idempotent. The invariant: **drop the table and rebuild yields the identical result.** The upgrade-cycle harness covers the new migration automatically.
- **Freshness = async startup sweep + watcher tail-ingest + manual Rebuild.** The startup sweep runs after first paint (Home renders immediately with an indexing shimmer that fills in). The existing chokidar session-watcher re-ingests only appended lines via a tracked byte offset (Sessions are append-only). A **Rebuild** control in Settings wipes and re-sweeps from scratch.

### Pricing table + Notional Cost (Slice 53) — ADR-0010

**Usage is priced as Notional Cost (API rates), never money spent.**

- A per-Model **pricing table** ships in-repo (Claude model rates, service-tier aware since `service_tier` is pricing-relevant), the equivalent of TUA's `pricing.json`. It is a snapshot, not a live feed; drift when Anthropic changes prices is acceptable for an intensity gauge and surfaced in-app.
- Notional Cost is computed from Usage Event token counts × rates, distinguishing fresh input, Cache-Read, and Cache-Write tokens (priced differently). Unknown models fall back gracefully (counted in tokens, flagged as unpriced).
- The **Tokens/Cost metric toggle** works across all Usage views; "Cost" always means Notional Cost and always carries the clarifier *"at API rates — not money spent."*

### Global Usage views + Home Screen rework (Slices 54–55)

- **A Zustand `usage` store** (per the v6 store-per-domain pattern, ADR-0007) holds the derived aggregates and the active metric/range filters; selector granularity keeps high-frequency ingest from re-rendering unaffected views.
- **Slice 54** replaces the Home Screen's default right pane with the global Usage view: stat cards (Sessions, total tokens, Notional Cost) and a usage trend with a day/week/month granularity toggle and a range filter, spanning all Projects.
- **Slice 55** adds the **by-project breakdown** (Projects ranked by Usage — the sidebar's analytic twin) and the **session explorer** (Sessions ranked by Usage; a detail view of one Session's turns). Selecting a Session in the explorer jumps to it through the v5 **three-tier Jump-to-session** resolution (live Pty Tab by `ptyId` → any live tab for `sessionId` → read-only transcript).

### Project Screen (Slice 56)

- **A new `'project'` Screen** in the navigation store (ADR-0007). Single-clicking a sidebar Project opens its Project Screen; **double-click still opens the Workspace** (both interactions from the old Home Screen are preserved). The altitude ladder is Home (all Projects) → Project (overview) → Workspace (deep work).
- **Layout, top to bottom:** the Project's Usage strip, the **Analyze** bar + button, and the **Analysis** in a collapsible accordion (collapsed by default, expands on Analyze or on click). The **Stats Row** relocates here.
- **The Recent Projects cards view is deleted, not hidden** — the activity-sorted sidebar absorbs its navigation role.
- **Realization note (Slice 56, as shipped).** The Project Screen was implemented as the Home Screen's right-pane *selected state* (the sidebar is retained for one-click switching) rather than as a distinct top-level `'project'` route in the navigation store. The altitude ladder, single-click → Project overview / double-click → Workspace behavior, and the deletion of the Recent Projects cards all hold as specified; only the routing mechanism is the pragmatic one. Promote to a full top-level Screen if a future slice needs Project-Screen state to survive independently of the Home selection.

### CONTEXT.md changes

Unlike v6, v7 introduces substantial domain vocabulary, already written into CONTEXT.md during the planning grill: the **Usage** section (Usage, Usage Event, Cache-Read/Write Tokens, Notional Cost, Subscription Utilization, Quota, Quota Reset), the redefined **Home Screen** and new **Project Screen**, extended Relationships, and two Flagged ambiguities (the "Utilization" split; "Analytics" banned in favor of "Usage"). Implementation vocabulary — *ingest*, *sweep*, *rebuildable cache*, *pricing table* — is deliberately kept OUT of the glossary (the same call v6 made for "portal host" / "store").

### PRD-v7 + ADRs + release ceremonials (Slice 57)

Mirrors the v4/v5/v6 closing-slice pattern.

1. **ADR-0009 / 0010 / 0011 committed** — drafted into the working tree during planning (rebuildable cache; Notional Cost not spend; networked Quota exception).
2. **`docs/PRD-v7.md` committed** — this document, held across Slices 51–56.
3. **PRD-v6 dated note.** Its "pattern matchers are the leading v7 candidate" statement gains: `Update — 2026-07-13: v7 became Usage (token analytics + Quota); pattern-matching notification kinds move to v9.` v6's body otherwise untouched.
4. **Release ceremonials.** `package.json` 0.6.0 → 0.7.0. CHANGELOG `[Unreleased]` → `[0.7.0] — YYYY-MM-DD`; new empty `[Unreleased]` opens for v8. `git tag v0.7.0`.
5. **HITL verification** (the parts tests can't reach) — see Testing Decisions.

## Testing Decisions

v7 keeps the v6 test policy: **renderer-touching slices ship renderer tests**, and main-process logic ships node tests. The network boundary and visual/chart surfaces are HITL, as xterm and Monaco already are.

| Module | Test? | Pattern |
|---|---|---|
| Quota payload → `QuotaSnapshot` parser | ✅ | Pure function over fixtures (5-hour + weekly windows, missing-window, malformed) |
| Quota opt-in gating + cache/429 logic | ✅ | Injected fetch/clock; asserts no call when disabled, last-snapshot on 429, TTL expiry |
| Quota network fetch + keychain read | ❌ HITL | Live endpoint + OS keychain prompt; Slice 57 gate |
| Usage Event derivation from JSONL | ✅ | Pure parse over fixture Sessions; per-turn fields, Encoded-Path attribution, no-usage lines skipped |
| Ingest idempotency + watcher tail-offset | ✅ | Re-ingest dedups by `event_id`; appended-line tail parse from tracked offset |
| Migration `0006_usage_events` | ✅ | Upgrade-cycle harness walks the chain from v1 |
| Pricing / Notional Cost math | ✅ | Rates × counts, service-tier + cache token classes, unknown-model fallback |
| `usage` Zustand store (aggregates, filters) | ✅ | Plain vitest; metric/range transitions, selector granularity |
| Stat cards / trend / by-project / session explorer | ✅ | RTL over accessible queries; explorer → Jump-to-session (three-tier) |
| Top-bar Quota chip (gauges, hide-on-failure) | ✅ (logic) / ❌ (visual) | RTL asserts %/label/hide states; hue-independence is HITL |
| Navigation: Project Screen + single/double-click | ✅ | Navigation store transitions; RTL for click routing |
| Charts' pixel rendering (SVG trend, bars) | ❌ HITL | jsdom has no layout; visual correctness in Slice 57 gate |

**Estimated test delta:** 326 → ~370.

**Slice 57 HITL gate:**
- Enable Quota with a live Claude Code login; the keychain prompt appears once; the chip shows plausible 5-hour + weekly percentages and reset countdowns matching Claude Code's own `/usage`; disable it and the chip disappears; revoke/expire the credential and the chip hides without error.
- The Quota gauges are legible with color removed (fill length + % + label carry the state).
- Land on Home after a cold start: the indexing shimmer resolves into populated stat cards and trend without blocking first paint.
- by-project ranking and session-explorer figures match a hand-spot-check against Claude Code's raw usage for one Project.
- Jump from the session explorer lands on the right Pty Tab / transcript across all three resolution tiers.
- Single-click a Project → Project Screen (Usage strip, Analyze works, Analysis accordion opens/closes); double-click → Workspace; the Recent Projects cards are gone and nothing references them.
- SVG trend and bars render correctly in both themes.

## Out of Scope (deferred)

**v8 (Usage fast-follows):**
- **Activity heatmap**, **token composition** (input/output/cache split), **by-model breakdown**, and the **Subscription Utilization gauge** (with its required plan-fee setting). These land on the v7 spine.

**v9:**
- **Pattern-matching Notification kind subtypes** (`approval` / `complete` / `question`) via PTY-stdout parsing — the former leading v7 candidate, still fully pre-staged (open `kind` column, reserved `--timeline-*` tokens, the `IdleDetector.onPtyData` seam). Displaced by Usage; unchanged in readiness.

**Not planned under any current release:**
- **Codex or any second Provider.** ADR-0002 holds; Mesh stays Claude-Code-only. The `usage_events` schema may carry a single-valued `provider` column as cheap, non-committal future-proofing, but no second ingest path ships.
- **Real spend / billing-API integration** — ADR-0010 forbids it without a new ADR.
- **`sk-ant-` API key usage** — the wrong credential for Quota; needed for nothing in v7.
- **Scheduled Analysis, Analysis quality evals, error observability, the Go-Public checklist** — unchanged from PRD-v6's deferral list.

## Risks and Open Items

- **The Quota endpoint is undocumented and rate-limited.** Anthropic can change or remove `/api/oauth/usage` without notice, and frequent polling earns `429`s. Mitigation: on-demand + ~5-min cache + last-snapshot-on-429; any failure hides the chip; the feature is opt-in so a break never degrades the core app. This is the sharpest external dependency Mesh has ever taken and is contained by ADR-0011 accordingly.
- **The IA rework deletes a working view.** Removing the Recent Projects cards and introducing a new Screen touches the navigation store, App.tsx routing, and the Home Screen's most-used pane. Mitigation: the cards' only job (navigation) is fully covered by the sidebar; navigation-store transitions ship with tests (v6 precedent); the change lands as its own slice (56) after the Usage views it depends on are proven.
- **Pricing-table drift.** Rates are a snapshot and will diverge from Anthropic's when prices change. Mitigation: ADR-0010 frames Notional Cost as an intensity proxy, not an invoice; the in-app clarifier sets the expectation; unknown models degrade to unpriced rather than guessing.
- **Ingest scale.** 34 Session files today; the sweep is trivial now but grows. Mitigation: byte-offset tail-ingest keeps steady-state cost proportional to new turns, not total history; the async-after-first-paint sweep keeps launch instant; Rebuild is the only full re-parse and is user-initiated.
- **Reduced-color-vision correctness on the gauges.** A headroom bar that signals "near the cap" by turning red is invisible to the user. Mitigation: fill length + numeric % + label are load-bearing; hue is decorative only; an explicit HITL check with color removed.
- **A feature release across every layer risks slice bleed.** Quota (network), ingest (DB), views (renderer), IA (navigation) are different subsystems. Mitigation: quota-first ordering ships the self-contained high-value slice before the coupled ones; each slice is independently demoable; the spine (52–53) is proven before the views (54–55) render over it.

## Slice Index

| # | Title | Issue |
|---|---|---|
| 51 | Networked Quota module (opt-in, safeStorage OAuth, 429-safe) + top-bar chip | #51 |
| 52 | Usage ingest + `usage_events` cache (migration 0006, async sweep + watcher tail) | #52 |
| 53 | Pricing table + Notional Cost over ingested events | #53 |
| 54 | Home Screen → global Usage views (stat cards + cost, usage trend) | #54 |
| 55 | by-project breakdown + session explorer (jump reuses v5 Jump-to-session) | #55 |
| 56 | Project Screen (Usage strip → Analyze → Analysis accordion); delete Recent Projects cards | #56 |
| 57 | PRD-v7 + ADR-0009 + ADR-0010 + ADR-0011 + v0.7.0 release ceremonials | #57 |

Per v1–v6 workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; manual verification before close; `hitl` label on the closing slice.

## Further Notes

- v7 keeps `~/.claude/projects/` as the canonical Project source (ADR-0002, clarified by ADR-0009), the provider mechanism (ADR-0003/0005), read-only Monaco (ADR-0004), the notification subsystem (ADR-0006), Zustand stores (ADR-0007), and the portal PtyHost (ADR-0008) all in force.
- `token-usage-analytics` is the reference implementation for the parser shapes, the OAuth fetch mechanics (User-Agent, 429 handling, cache TTL), and the view layouts. No code crosses over — v7 re-expresses it in Mesh's stack.
- Runtime dependency additions are expected to be minimal or none (charts are hand-rolled SVG, matching the mockup's approach). Any addition is called out in its slice.
- v8 planning (Usage fast-follows) happens when v7 ships; the Subscription Utilization work will define the plan-fee setting and the utilization gauge on the spine v7 lays down.
