# Claude Quota is fetched from Anthropic's OAuth endpoint — the one deliberate exception to local-first

Mesh is local-first (ADR-0002): every byte it reads is on disk under `~/.claude/`, and it makes no network calls. **Quota** — the Claude subscription's 5-hour and weekly windows, each with a percent-used and a reset time — is the single most valuable signal for a user actively working in AI sessions, but it is **absent from local logs**. It exists only behind an undocumented Anthropic endpoint, `GET https://api.anthropic.com/api/oauth/usage`, authenticated with the **Claude Code OAuth token** stored in the OS keychain (verified live against `token-usage-analytics`'s implementation). This ADR accepts that endpoint as Mesh's **single networked exception**, ring-fenced so tightly that the local-first guarantee holds everywhere else.

The credential distinction is load-bearing: the subscription windows ride the **OAuth login token**, *not* a pay-as-you-go `sk-ant-` API key. An `sk-ant-` key only exposes tier RPM/TPM limits — a different thing that cannot answer "how much of my weekly window is left." So there is no alternative credential and no local substitute.

## Considered Options

- **Local approximation** (rolling 5h/weekly token sums from ingested Usage Events) — rejected: it is not Anthropic's metric. The windows meter server-side against opaque, plan-dependent limits Mesh cannot see; a local sum would diverge from Claude Code's own `/usage` number. A confidently-wrong headroom gauge is worse than no gauge for a figure the user is trying to trust mid-session.
- **`sk-ant-` API key polling** — rejected: wrong data. That credential exposes pay-as-you-go tier rate limits, never the subscription windows.
- **Drop Quota, stay purely local** — rejected: it is the user's top-priority signal, and the fetch is already proven to work. Ideological purity is not worth forfeiting the highest-value view.
- **Networked OAuth fetch, opt-in and ring-fenced** — chosen: the only path to the real number, contained so the exception cannot leak into the rest of the app.

## Consequences

- **Off by default.** A Settings opt-in enables Quota; the outbound call happens *only* when enabled. A user who never opts in runs a Mesh that is still 100% local.
- **Isolated module.** Quota lives in its own module and IPC path, entirely separate from the `usage_events` ingest pipeline. A Quota reading is a live `QuotaSnapshot`, never a Usage Event, never cached in SQLite.
- **Credential hygiene.** The OAuth token is read from the OS keychain via `safeStorage`, used only in the `Authorization` header to `api.anthropic.com`, and is never persisted by Mesh, never logged, and never sent to the renderer. Reading Claude Code's own keychain entry may trigger a one-time OS keychain prompt — **that prompt is the consent gate.**
- **Rate-limit-safe.** On-demand fetch with a ~5-minute in-process cache; a `429` serves the last snapshot rather than re-hammering. Requires a `User-Agent: claude-code/<version>` header.
- **Brittle-by-nature, degrades quietly.** The endpoint is undocumented; Anthropic may change or remove it. On any failure (disabled, no credential, 429, shape change) Quota simply **hides** — no view blocks, nothing else breaks.
- **Account-global surface.** One `QuotaSnapshot` is shown identically across the Home, Project, and Workspace screens via a single persistent top-bar chip (two mini-gauges: 5-hour + weekly). Per the reduced-color-vision constraint, percent-used is encoded with **fill length + numeric % + label**, never hue alone.
