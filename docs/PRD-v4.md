# Mesh v4 — Product Requirements Document

> Glossary terms (**Mesh**, **Project**, **Session**, **Analysis**, **Pty Tab**, **Provider**, **Active Provider**, **Model**, **Hidden**, **Source-Missing**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v3 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; v4 records one new ADR (ADR-0005) and amends one existing (ADR-0003). v4 introduces no new glossary terms — "Active Provider" was already in CONTEXT.md and now becomes meaningful.

## Goal

**v4 makes Mesh multi-Provider in practice, not just in code.** ADR-0003 promised a provider abstraction; v1 shipped only `ClaudeClient` functional, with `OpenAIClient` as a stub that throws. v4 honors the abstraction by lighting up OpenAI as a second real Provider — pills become interactive, Active Provider becomes a globally switchable setting, the orchestrator picks its client at Analyze time.

No other features. The candidate pool in PRD-v3's "Out of Scope" list contained Scheduled Analysis, soft onboarding flow, expanded tool-call rendering, and others. v4 ships exactly one item from that pool: functional OpenAI Provider. Scheduled Analysis moves to v5.

## Context

v3 shipped 4 slices on 2026-06-29 (`main` branch, 167 tests, production build succeeds), tagged `v0.3.0`. v3 was internal hardening only — no new user-facing features — and the Production Checklist was restructured into Internal Hardening (closed) and Go-Public (deferred).

What's *not* yet done at `v0.3.0` that v4 closes:

- `OpenAIClient` is a stub — every method throws.
- The OpenAI pill in Settings → Model is presentational (Slice 9 shipped the shape; clicking is a no-op).
- There is no way to switch Active Provider — Claude is hard-coded.
- The orchestrator's `SYSTEM_PROMPT` contains Claude-specific output-format language ("Emit your output by calling the `emit_daily_summary` tool"), coupling the orchestrator to one Provider's structured-output mechanism.
- No `active_provider` settings key exists; switching is not a concept the schema or IPC surface knows about.
- ADR-0003's "Switching the Active Provider is a v1.1 capability" line is the only architectural commitment around switching; the actual mechanism has never been built.

v4 closes those gaps.

## Scope

Four slices, sequenced linearly with tracer-bullet seams between each:

```
Slice 34   OpenAIClient implementation + prompt decoupling + tests
Slice 35   OpenAI catalog activation + Settings UI lights up OpenAI
Slice 36   Active Provider switching mechanism + Analyze button subtitle
Slice 37   ADR-0005 + ADR-0003 amendment + PRD-v4 + v0.4.0 release
```

(Slice numbers continue from v3's `32`. Issue `#33` was a non-slice fix discovered during v3's Slice 31 smoke test; v4 slice numbers resume sequential alignment with issue numbers from `34`.)

Each slice is independently committable and demoable:
- After 34: `OpenAIClient` passes its tests; catalog still gated (`available: false`).
- After 35: User can paste OpenAI key + validate; OpenAI pill is enabled but clicking does not yet switch Active Provider.
- After 36: Pill click switches Active Provider; Analyze button subtitle shows what's about to run; orchestrator selects the right client at Analyze time.
- After 37: v4 formally closes — ADRs and PRDs current, `v0.4.0` tagged.

## Implementation Decisions

### `OpenAIClient` implementation (Slice 34)

The functional `OpenAIClient` mirrors `ClaudeClient`'s shape: a constructor that takes a model ID + API key + injectable factory; a `validate()` method that issues a minimal `chat.completions` probe (the OpenAI equivalent of Claude's 1-token Messages probe); an `analyzeProject()` method that issues a structured-output completion and validates with Zod before returning.

**Structured output strategy: Native Structured Outputs**, via `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`. OpenAI guarantees schema conformance at decode time when `strict: true` is set. Zod parse remains as defense-in-depth — the retry-once path that exists for Claude's `SchemaViolationError` is preserved for symmetry but will rarely fire in practice (OpenAI's strict mode is genuinely strict).

**Why not function calling (1:1 mirror of Claude's `tool_use`)?** The `ModelClient` interface already abstracts the wire-level mechanism — the orchestrator only sees `analyzeProject(input): AnalysisOutput`. Mirroring tool_use one-to-one is unnecessary, and Native Structured Outputs has half the surface area to maintain (one `response_format` parameter + `JSON.parse(content)`, vs. tool definitions + tool_choice forcing + response parsing to find the function-call block).

**SDK seam.** A new `OpenAILike` interface (mirroring `AnthropicLike`) defines the minimal surface tests need to inject a fake: `{ chat: { completions: { create(params): Promise<unknown> } } }`. `OpenAIFactory` mirrors `AnthropicFactory`. Default factory wraps the `openai` npm package.

**Error humanization.** `humanizeOpenAIError()` mirrors `humanizeAnthropicError`: maps 401/403/429/5xx + network errors to short actionable strings, falls back to the SDK's own message. Lives next to `OpenAIClient` in `src/main/models/openai-client.ts`.

**Prompt decoupling.** The Claude-specific line `Emit your output by calling the \`emit_daily_summary\` tool` moves out of `orchestrator.ts`'s `SYSTEM_PROMPT` and into `ClaudeClient` as a client-side suffix on the system prompt it sends. `OpenAIClient` adds its own equivalent suffix (`Return JSON conforming to the schema below.`). The orchestrator's `SYSTEM_PROMPT` becomes Provider-agnostic; each client owns its output-format directive. This is a minimal refactor — one sentence moves, ~6 lines touched in `orchestrator.ts`, +1 line in `ClaudeClient`, identical line introduced in `OpenAIClient`. Existing Claude behavior is preserved bit-for-bit (the final prompt sent to Anthropic is byte-identical).

**Tests.** The existing `OpenAIClient` / `LocalClient` stub tests in `tests/model-clients.test.ts` (which currently assert `not implemented`) are replaced for OpenAI with real coverage mirroring the `ClaudeClient` test patterns: `validate` happy path, `validate` failure modes (401, 429, 5xx, network), `analyzeProject` structured-output decode, Zod retry-once on the rare miss. `LocalClient` stub tests remain unchanged — Local is still a stub. Estimated test delta: 167 → ~185.

### OpenAI catalog activation + Settings UI (Slice 35)

`shared/models.ts`: the `openai` `ProviderDescriptor` flips from `available: false` to `available: true`, the `comingSoonNote` field is removed, and the `models` array is populated with three `ModelDescriptor` entries:

| Tier | Subtitle | Model ID (baseline) |
|---|---|---|
| **Recommended default** | `fast & cheap` | `gpt-4o-mini` |
| Balanced | `balanced` | `gpt-4o` |
| Most capable | `most capable, most $$` | current OpenAI flagship with Native Structured Outputs support |

The "most capable" slot is filled at slice-implementation time against the live OpenAI pricing page and model availability — `gpt-4.5-preview`, `gpt-5` non-reasoning variant, `gpt-4-turbo`, whatever is current as of the slice's actual ship date. Cost numbers (`approxCostPerAnalysisUSD`) are also computed at slice-implementation time; the PRD does not lock specific dollar figures because they evolve faster than the document does.

**Reasoning models are explicitly NOT in the catalog.** Mesh's Analysis task is summarization + extraction, not deep reasoning. o-series models are slow, expensive, and optimized for the wrong shape of work. Their Native Structured Outputs support has also historically been less consistent than non-reasoning chat models, which would force per-model caveats in the catalog. If reasoning models become useful for Analyses later, that's a v6+ addition, not v4.

**Settings → Model UI.** The OpenAI pill becomes interactive when an OpenAI key is stored. Disabled state (no key stored) shows a tooltip prompt `Add an OpenAI API key in Settings → Model` — mirrors today's pattern for the still-stubbed Local pill, which keeps its `Coming soon` tooltip. The model dropdown's existing `ModelSelect({ provider })` component already takes a `provider` prop; no structural change needed — it lights up for OpenAI automatically once the catalog flips.

**Validation flow.** Already provider-keyed in v1. The existing 1-token-probe UI (green check, "last verified Xs ago") works for OpenAI unchanged, routing through `OpenAIClient.validate()` from Slice 33.

**Pill state model.** The pill is `enabled` if and only if `descriptor.available && hasStoredKey`. This single boolean source-of-truth removes the need for separate "active / inactive / unavailable / unkeyed" states. Validation state is a softer signal, not gating — a stored-but-stale key still allows the pill to be clicked; Analyze surfaces the validation error in its own banner (the existing Slice 12 error path).

**Settings layout chicken-and-egg.** Keys are entered *below* the pills in Settings → Model, but the pill above is enabled only after the key below is saved. Users scan down to paste a key, scan up to click the pill. Acceptable for a once-per-Provider setup flow — not worth restructuring the layout to fix.

### Active Provider switching mechanism + Analyze button subtitle (Slice 36)

**New settings row.** Key: `active_provider`. Value: `claude` | `openai` | `local`. Default: `claude`. Existing installs with no `active_provider` key read as `claude` — backward-compatible, no data migration required.

**New IPC surface.** Two methods on the `settings` IPC namespace: `settings.getActiveProvider(): Promise<ProviderId>` and `settings.setActiveProvider(provider: ProviderId): Promise<void>`. A new IPC event channel `settings:activeProviderChanged` lets all subscribers (Settings, Analyze button, anything else that needs the current Provider) update live without polling.

**Renderer wiring.** The Settings → Model pill row reads from `getActiveProvider()` on mount and subscribes to the change event. Clicking an enabled, non-active pill calls `setActiveProvider(provider)`; the renderer's local highlighted-pill state updates from the change event, not optimistically — ensures the UI matches persisted state.

**Orchestrator wiring.** `AnalysisOrchestrator` is constructed with a *factory* that resolves the current `ModelClient` at Analyze time: it reads `active_provider`, reads the selected model for that Provider (`model:{provider}` settings key — already exists per Provider), reads the encrypted API key (via existing safeStorage flow), and instantiates the appropriate client (`ClaudeClient` or `OpenAIClient`). Existing Analyze invocations that pass a client directly (tests, etc.) still work — the factory pattern is additive.

**Analyze button subtitle.** Single small, muted, single-line subtitle beneath the existing button label: `via Claude · Haiku 4.5` (or OpenAI / gpt-4o-mini / whatever is currently active). Renders the Provider's display label + the selected Model's display label. Subscribes to `settings:activeProviderChanged` *and* the existing model-change event so it updates live when the user switches in Settings — without re-rendering Home Screen or interrupting an in-progress view.

**Why this slice combines the mechanism and the subtitle.** The subtitle is ~30 lines of JSX reading state Slice 36 already ships. Splitting it into a separate slice would be a v3-cadence stylistic choice, but the cost-benefit doesn't justify it — the subtitle has zero standalone value (no switching mechanism = nothing to show) and is conceptually inseparable from "switching is real." Recommend combined; can split if the v3 "one mechanism per slice" pattern is preferred.

### ADR-0005 + ADR-0003 amendment + PRD-v4 + v0.4.0 release (Slice 37)

Three pieces of work, all docs/text — mirrors v3's Slice 32 closing-slice pattern.

**1. New ADR-0005 "OpenAI as second functional Provider."** Records the affirmative new decision: abstraction proven, OpenAI ships, Active Provider is a global setting, Native Structured Outputs is the OpenAI-side schema strategy, the catalog is 3-tier non-reasoning. Captures Q2/Q3/Q4 of the v4 planning grilling session in ADR form. References ADR-0003 as predecessor.

**2. ADR-0003 final `## Update — 2026-MM-DD` section.** Marks ADR-0003's "Claude only, OpenAI/Local are stubs" decision as superseded in part by ADR-0005. The original "abstraction in code" architectural decision remains in force (and is now validated — a real second Provider lit it up). The Slice 32 update note already mentioned that functional OpenAI was a v4+ candidate; this final note records that it landed in v4.

**3. `docs/PRD-v4.md` published** — canonical record of v4's identity, scope, and decisions. (You're reading it.)

**4. PRD-v3 dated note in its "Out of Scope" section.** A single line under "Deferred to a future minor release": `Functional OpenAI provider — landed in v4 (2026-MM-DD)`. v3's body otherwise untouched, per Slice 32's principle A.

**5. Release ceremonials.** `package.json` 0.3.0 → 0.4.0. CHANGELOG `[Unreleased]` → `[0.4.0] — YYYY-MM-DD`. New empty `[Unreleased]` opens for v5. `git tag v0.4.0`.

**6. HITL verification.** Dogfood v4: run an Analyze on Mesh's own project with OpenAI active, compare output quality with the equivalent Claude Analyze. Findings either tweak in-slice (prompt suffix needs adjustment, schema parsing edge case) or move to v5 backlog (deeper per-Provider prompt tuning). Same HITL shape as v3's Slice 31.

## Out of Scope (deferred to v5+)

Everything PRD-v3's "Out of Scope" list contains stays deferred, minus the OpenAI Provider which v4 ships. Specifically:

**Deferred to v5:**
- **Scheduled / cron-based Analysis** — explicitly named as the v5 feature per the v4 planning Q1 split. Brings its own decision tree (always-on vs OS-scheduled, catch-up semantics, notifications, throttling, per-Project vs global).
  - *Update — 2026-06-30:* v5 shipped active-session indicators + in-window notifications (per PRD-v5.md) instead; Scheduled Analysis moves to v6. The line above is preserved as v4-era history. The notification subsystem v5 introduced is deliberately designed to receive Scheduled Analysis run-completion events when v6 lands — same `notifications` table, same toast, same dropdown.

**Deferred to v6 or later:**
- Functional Local Provider (Ollama and OpenAI-compatible self-hosted servers)
- Suggested Next chips (fourth Analysis panel)
- Editable Monaco file editor (ADR-0004 remains in force)
- Soft onboarding flow with UI Mode preselect
- Multi-window per Project
- Inline editing UI for Project rename / accent color
- Right-click context menus
- File tabs in File Editor mode
- Click-to-expand for tool calls in transcripts
- Sidechain inline expansion
- Per-project `.mesh/CONTEXT.md` materialized to disk
- Cross-Project search of Analysis content
- Cancellation of in-progress Analyses
- Background auto-analyze on file changes
- Git HEAD indicator in project header
- Aurora / Graphite / Nocturne named themes (Light/Dark only remain)
- **Per-Project Active Provider** — v4 makes Active Provider global only. If a real demand for per-Project differentiation emerges, layering it on top of "global default" is easier than the reverse.
- **Per-Analysis provider picker** — same reasoning. The Analyze bar stays clean.
- **Spend caps / cost ceilings** — relevant when scheduling exists (v5+). v4's manual-only Analyze keeps costs user-controlled.
- **Deeper per-Provider prompt tuning** — Slice 34's minimal "output-format suffix" split is sufficient. If OpenAI's output quality diverges from Claude's in v4 dogfood (HITL Slice 36), tweaks happen in-slice. Deeper rework is v5+.
- **Reasoning models in any catalog** — Mesh's Analysis task doesn't benefit from reasoning architecture. If a future use case (deep code review, multi-step planning) emerges, that's a feature-level decision, not a model-tier addition.

**Deferred to Go-Public (future v1.0.0):**
- arm64 `.dmg`
- Code signing + notarization
- Auto-updater via `electron-updater`
- True clean-room fresh-machine launch verification
- Third-party machine install
- Crash reporting
- Windows installer
- Linux installer
- Playwright e2e tests

## Risks and Open Items

- **OpenAI model lineup may have rotated.** Knowledge cutoff is January 2026; v4 ships sometime after 2026-06-29. The "most capable" slot in the catalog is filled at slice-implementation time, not now — same approach v3 used for not locking dollar figures.
- **OpenAI output quality may diverge from Claude's** in ways the shared prompt + per-Provider output-format suffix doesn't fully address. Mitigation: Slice 36's HITL dogfood surfaces real differences; in-slice tweaks address shallow problems; deeper per-Provider prompt tuning is v5+ backlog if Slice 36 surfaces structural quality issues.
- **Native Structured Outputs schema support varies by model.** As of January 2026, mainstream non-reasoning chat models (`gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo` later versions) support `response_format: json_schema, strict: true`. The catalog excludes reasoning models partly for this reason. Mitigation: the catalog only includes models that explicitly support strict structured outputs at slice-implementation time.
- **Active Provider switching is a new IPC channel — bug surface.** Settings → renderer subscribers → orchestrator factory all need to agree on the current Provider. Mitigation: existing tests for the orchestrator and settings repository extend to cover the new key + change event; manual Slice 35 verification walks through switch-while-Analyzing edge cases.
- **No new schema migrations.** v4 adds a settings *row* (`active_provider`), not a schema change. Slice 30's migration test harness doesn't trigger. First real migration after v3 will be in v5+ or beyond.
- **Slice 34's prompt decoupling is the only place existing Claude behavior could regress.** The refactor preserves byte-identical prompts when Claude is active; verified by a snapshot test on the rendered system prompt that ClaudeClient sends.

## Slice Index

| # | Title | Issue |
|---|---|---|
| 34 | `OpenAIClient` implementation + prompt decoupling + tests | [#34](https://github.com/itsrichardhaar/Mesh/issues/34) |
| 35 | OpenAI catalog activation + Settings UI lights up OpenAI | [#35](https://github.com/itsrichardhaar/Mesh/issues/35) |
| 36 | Active Provider switching mechanism + Analyze button subtitle | [#36](https://github.com/itsrichardhaar/Mesh/issues/36) |
| 37 | ADR-0005 + ADR-0003 amendment + PRD-v4 + v0.4.0 release | [#37](https://github.com/itsrichardhaar/Mesh/issues/37) |

Per v1/v2/v3 workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; manual verification before close.

## Further Notes

- v4 keeps `~/.claude/projects/` as the canonical Project source (ADR-0002 unchanged).
- v4 keeps SQLite + `safeStorage` + the existing IPC surface as foundation. Additions: one settings key (`active_provider`), two IPC methods (`getActiveProvider` / `setActiveProvider`), one IPC event channel (`activeProviderChanged`).
- v4 keeps the `AnalysisOutput` schema unchanged (Slice 10's shape from v1). Only the *enforcement mechanism* differs per Provider (tool_use input_schema vs. response_format json_schema). The orchestrator's output validation is identical (Zod parse on the result).
- v4 keeps Monaco read-only (ADR-0004 unchanged).
- v4 makes ADR-0003 partially obsolete; ADR-0005 supersedes the "Claude only" portion while the "abstraction in code" portion remains in force and is now validated by a second functional implementation.
- v4 does not introduce any new CONTEXT.md terms. "Active Provider" was already in CONTEXT.md and now becomes meaningful — its definition (`The currently selected Provider whose Model is used for every Analyze call. Exactly one Provider is Active at a time.`) is unchanged.
- v5 is Scheduled / cron-based Analysis per the planning split. v5 planning happens when v4 ships; the decision tree (always-on vs OS-scheduled, catch-up semantics, notifications, throttling, per-Project vs global) is unresolved and not premature to lock today.
