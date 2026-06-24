# Provider abstraction in code; only Claude is functional in v1

The Model Settings modal shows three Provider pills (`Claude` / `OpenAI` / `Local`), but only Claude is wired through in v1; OpenAI and Local are visible but disabled with a "Coming in v1.1" tooltip. The provider-agnostic `ModelClient` interface and per-Provider secret storage (via `safeStorage`) exist from day one so adding a new Provider later is just implementing the interface — not refactoring the analyzer, the IPC contract, or the schema.

## Considered Options

- **Ship all three Providers in v1** — rejected: triples the QA matrix, and structured-output reliability varies wildly across providers (especially Local), pushing v1 beyond a reasonable scope
- **Claude-only UI (no Provider pills at all)** — rejected: doesn't telegraph the multi-Provider future, and v1.1 would require a UI rebuild to introduce the picker

## Consequences

- A reader who opens the app and clicks `OpenAI` will see a tooltip, not a broken state — the disabled affordance is the contract
- The `analyses` table stores `provider` and `model` columns from day one so historical Analyses remain attributable when more Providers go live
- Switching the Active Provider is a v1.1 capability; v1 effectively pins the user to Claude after first-time setup
