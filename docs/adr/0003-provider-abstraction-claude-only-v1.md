# Provider abstraction in code; only Claude is functional in v1

The Model Settings modal shows three Provider pills (`Claude` / `OpenAI` / `Local`), but only Claude is wired through in v1; OpenAI and Local are visible but disabled with a "Coming in v1.1" tooltip. The provider-agnostic `ModelClient` interface and per-Provider secret storage (via `safeStorage`) exist from day one so adding a new Provider later is just implementing the interface — not refactoring the analyzer, the IPC contract, or the schema.

## Considered Options

- **Ship all three Providers in v1** — rejected: triples the QA matrix, and structured-output reliability varies wildly across providers (especially Local), pushing v1 beyond a reasonable scope
- **Claude-only UI (no Provider pills at all)** — rejected: doesn't telegraph the multi-Provider future, and v1.1 would require a UI rebuild to introduce the picker

## Consequences

- A reader who opens the app and clicks `OpenAI` will see a tooltip, not a broken state — the disabled affordance is the contract
- The `analyses` table stores `provider` and `model` columns from day one so historical Analyses remain attributable when more Providers go live
- Switching the Active Provider is a v1.1 capability; v1 effectively pins the user to Claude after first-time setup

## Update — 2026-06-29

The "v1.1" references in this ADR reflect then-current planning. v1.1 never happened: v2 went straight to a different polish pass, and v3 is an internal-hardening pass that ships no new Providers. Functional OpenAI + Local Providers are now candidates for v4+ per [`PRD-v3.md`](../PRD-v3.md)'s "Out of Scope" section — no committed version.

The ADR's actual decision — provider abstraction in code; only Claude functional; OpenAI/Local pills present but disabled — **remains in force**. The `ModelClient` interface, the disabled-pill UI affordance, and the `provider` + `model` columns on the `analyses` table are unchanged. Live code comments and UI tooltip strings have been rephrased from "Coming in v1.1" to "Coming soon" so they don't chase versions through code when plans shift again.

## Update — 2026-06-29 (v4 ships)

Superseded in part by [ADR-0005](./0005-openai-as-second-functional-provider.md). v4 turns `OpenAIClient` from a stub into a real `ModelClient`, makes Active Provider a globally switchable setting (`active_provider`), and lights up the OpenAI pill in Settings → Model. The orchestrator no longer hardcodes Claude — a factory reads `active_provider` at Analyze time and instantiates the correct client.

The **"abstraction in code"** decision this ADR introduced is unchanged and is now validated by a second functional implementation: a new Provider lit up without refactoring the orchestrator, the IPC contract, the SQLite schema, or the `analyses` row shape — exactly the seam this ADR was designed to preserve. `LocalClient` remains a stub gated by `available: false`; functional Local is a candidate for v5+. See ADR-0005 for the v4 affirmative decisions (structured-output strategy, Active Provider scope, catalog shape).
