# Mesh

Mesh is the AI workspace OS for managing Claude Code projects — a desktop app that lists every directory you've opened Claude Code in, lets you trigger LLM analyses of recent activity, browse past sessions, and resume them with a live terminal.

## Language

### Identity

**Mesh**:
The desktop application itself; an "AI workspace OS" for managing Claude Code projects.

**Project**:
A directory you've opened Claude Code in. Auto-discovered from `~/.claude/projects/`; Mesh never registers Projects independently of Claude Code's own data.
_Avoid_: Workspace, repo, folder

**Session**:
A single Claude Code conversation, persisted as one `<uuid>.jsonl` file in a Project's `~/.claude/projects/<encoded-path>/` folder.
_Avoid_: Chat, conversation, thread

**Sidechain**:
A sub-conversation within a Session, created by Claude Code's Agent tool. Rendered as an inline `↳ sub-agent (N messages)` indicator within the parent Session's transcript — not enumerated as its own Session.

**Encoded Path**:
A Project's source path with `/` replaced by `-` — Claude Code's own naming scheme for project folders (e.g., `-Users-richardhaar-Desktop-Mesh`). Used as a Project's primary key.

**Source Path**:
A Project's decoded absolute path on disk (e.g., `/Users/richardhaar/Desktop/Mesh`).

### Screens

**Home Screen**:
Mesh's landing view: Project sidebar on the left, the global **Usage** views on the right (across all Projects). Single-click a Project in the sidebar opens its **Project Screen**; double-click opens its **Workspace Screen**.

**Project Screen**:
A single Project's overview — the "refresh myself after stepping away" view. Top to bottom: the Project's **Usage** strip, the **Analyze** bar, and the **Analysis** in a collapsible accordion beneath it. The middle altitude between the Home Screen (all Projects) and the Workspace Screen (deep work in one Project).

**Workspace Screen**:
The per-Project view: file tree on the left, Sessions list in the middle, transcript or file content on the right.

**Mode Tab**:
The `Sessions` / `File Editor` toggle at the top of the Workspace Screen's right area, switching what fills that area.

### Analysis

**Analyze** (verb):
The user-initiated action that calls the active Provider's Model to produce an Analysis for a Project. Mesh never analyzes automatically.

**Analysis** (noun):
The LLM-produced three-section update for a Project — Summary of Recent Sessions, Next Steps, and Suggested Improvements. Stored with history kept; the latest is shown on the Home Screen.
_Avoid_: Summary (when referring to the whole Analysis), report, briefing

**Stats Row**:
The three deterministic counts displayed above an Analysis: Sessions, Files Touched, Last Activity. Computed from Project state without the LLM.

**Activity** / **Last Activity**:
The timestamp of the newest event in any of a Project's Sessions. Drives both sidebar sort order and the Last Activity stat.

### Usage

**Usage** (domain):
The token-consumption domain — everything Mesh derives from the token counts recorded in Session JSONL: totals, trends, breakdowns, and Notional Cost. Distinct from **Analysis** (the LLM-written report): Usage is deterministic and derived; Analysis is generated. Never called "Analytics" (one letter from Analysis, different meaning).
_Avoid_: Analytics, metrics, telemetry

**Usage Event**:
The atomic record of one assistant turn's token consumption within a Session — input, output, and Cache-Read / Cache-Write token counts, the Model, and timestamp. Derived entirely from the Session's JSONL (never authored); identified by the assistant message's uuid for idempotent re-ingest. Attributed to a Project by its containing folder's Encoded Path (the `cwd` field is provenance only, never the attribution key). The canonical unit every Usage view aggregates from.
_Avoid_: entry, row, record, sample, turn

**Cache-Read Tokens** / **Cache-Write Tokens**:
Input tokens served from (read) or committed to (write) a prompt cache — priced differently from fresh input, so tracked separately. In Claude Code's JSONL these are `cache_read_input_tokens` and `cache_creation_input_tokens`.
_Avoid_: cached tokens (ambiguous — always say read or write)

**Notional Cost**:
The value of Usage priced at published API rates, regardless of the user's actual plan — a measure of usage *intensity*, not money spent. Computed from Usage Event token counts and a per-Model pricing table; it never reflects an invoice. The "Cost" metric toggle in Usage views always means Notional Cost, and is always shown with a clarifier ("at API rates — not money spent").
_Avoid_: cost (bare), spend, price, bill, invoice

**Token Composition**:
The share of a period's Usage tokens across the four token classes — Input, Output, Cache-Read, and Cache-Write. Answers "what *kind* of tokens did I consume?" Always expressed as token shares, never as Notional Cost (cache-read tokens are cheap, so a cost split would tell a different, misleading story). A breakdown view, not a time series.
_Avoid_: token breakdown, token mix, token split (say Token Composition)

**Activity Heatmap**:
A calendar view of Usage intensity — each day of a recent span shaded by that day's total, so streaks and gaps read at a glance. One of two view modes (with the usage trend) of the Home Screen's time-visualization; intensity follows the active Tokens / Notional Cost metric. **Always global** — a rolling-year calendar across all Projects, unaffected by the Usage Filter (the one filtered-area view that opts out). Per the reduced-color-vision constraint, intensity is encoded by lightness *and* cell fill *and* an on-hover value, never hue alone.
_Avoid_: contribution graph, calendar chart, activity grid

**Usage Filter**:
The Home Screen control set that re-scopes the Usage views: the **Tokens / Notional Cost** metric toggle, a **Project** selector, and a **Timeframe** selector. It drives the *filtered* views — the usage trend, Token Composition, By-model, and the Sessions table — but never the **Metric Cards** or the **Activity Heatmap**, which stay global. Selecting a specific Project also hides the By-project breakdown (the view is already that one Project). Mesh has no Provider filter (Claude-only, ADR-0003) and no session search.
_Avoid_: query, search, facet

**Timeframe**:
The Usage Filter's date-window selector: **All time**, **This Month**, **Last 7 Days**, **Last 30 Days**, or **Last 90 Days**. Scopes the filtered Usage views to events within the window.
_Avoid_: date range, period, window (that's a Quota term)

**Metric Card**:
One of the four headline figures atop the Home Screen's Usage views — **Today** (tokens + sessions), **7-Day** (tokens + active days), **This Month** (tokens + average per active day), and **Subscription Utilization**. Always **global** — computed over all Projects on the user's local calendar day, unaffected by the Usage Filter. An **Active Day** is a day with any Usage.
_Avoid_: stat, KPI, tile

**Subscription Utilization**:
A calendar month's Notional Cost compared against a plan's flat monthly fee — answers "is the subscription paying off?" A money metric, and the only thing in Mesh called "Utilization." Requires the user to enter their plan fee. The fee is a flat constant the user states, never decremented per Usage Event — so this remains a fee-ratio, not money spent (ADR-0010 holds). Displayed as a **multiple of the plan fee** (e.g. "3.9× your plan fee") with the notional dollar figure alongside — phrased as "× your plan fee", never "× value".
_Avoid_: ROI, savings, value

**Quota**:
A Claude subscription usage window Anthropic imposes, each with a percent-used and a reset time — Mesh surfaces the **5-hour window** and the **weekly window**. Account-global, not per-Project (the same Quota shows on every Project and the Workspace). Read live from Anthropic's OAuth usage endpoint; absent from local logs, so unavailable unless the user opts into the networked fetch. A window's percentage is its **percent used**, never its "utilization."
_Avoid_: limit, allowance, cap, rate limit, utilization (that's a money term)

**Quota Reset**:
The moment a Quota window rolls over and its percent-used returns to zero.
_Avoid_: refresh, rollover, cycle

### Sessions and terminals

**Pty Tab**:
A tab in the Workspace's right pane backed by a live `claude --resume <session-id>` pseudo-terminal. Distinct from Session — Sessions are recorded JSONL files; Pty Tabs are live processes spawned from one.
_Avoid_: Terminal (ambiguous between transcript view and live pty)

**Resume** (verb):
The action that opens a Pty Tab for a recorded Session. Default click behavior on a Session row is read-only transcript view; Resume is an explicit click in the transcript pane.

**Notification**:
A persistent record of a moment that may need user attention in a Project's Pty Tab. Stored in SQLite with 7-day retention. Surfaced as a top-right toast on creation and as a row in the top-bar bell dropdown until read or cleared. Every Notification has a **Notification Kind**. The **idle** kind is the recall floor — it fires when a live Pty Tab transitions from active to idle (no PTY output for ≥ 8 seconds) while the user is not looking at that Pty Tab, guaranteeing no missed moment. Other kinds are detected earlier and more precisely by **Pattern Matchers**.
_Avoid_: Alert, popup, banner (when referring to the persistent record)

**Notification Kind**:
What a Notification *means* — the state of the Pty Tab that produced it. **Idle** (recall floor: Claude went quiet, reason unknown). **Approval** (Claude is blocked on the user's answer to a tool-permission prompt — highest urgency). **Complete** (Claude finished its turn and returned to an empty input prompt). A reserved **question** kind (Claude asking a free-text clarifying question) is not yet detected. Kinds are stored as open TEXT; the surface renders an unknown kind as **idle**. Approval and Complete arrived in v9; Idle in v5.
_Avoid_: type, category, severity

**Pattern Matcher**:
A detector that recognizes a Notification Kind by reading a Pty Tab's settled terminal screen. Matchers fire a correctly-kinded Notification the moment they recognize the screen — ahead of the idle timer — while the **idle** kind remains the floor if no matcher fires. A broken matcher can only downgrade a Notification to **idle**, never suppress it.
_Avoid_: parser, scanner, detector (say Pattern Matcher)

### Providers and models

**Provider**:
An LLM service backing analyses — one of `Claude`, `OpenAI`, or `Local`. v1 ships with only Claude functional; OpenAI and Local pills are present but disabled.

**Active Provider**:
The currently selected Provider whose Model is used for every Analyze call. Exactly one Provider is Active at a time.

**Model**:
A specific LLM within a Provider (e.g., `claude-haiku-4-5`, `gpt-4o-mini`, `llama3.1:8b`).

### Project state

**Hidden**:
A Project the user has flagged to not appear in the Home Screen sidebar. Recoverable via the Project's settings.

**Source-Missing**:
A Project whose Source Path no longer exists on disk (folder deleted/moved). Rendered greyed-out in the sidebar; Workspace actions (file tree, Resume) are disabled. Distinct from Hidden.

## Relationships

- A **Project** contains 0..N **Sessions** (one `.jsonl` per Session)
- A **Session** may contain 0..N **Sidechains** (rendered inline, not enumerated separately)
- A **Project** has 0..1 latest **Analysis**; older Analyses are kept as history
- An **Analysis** is produced by exactly one **Model** of one **Provider**
- A **Pty Tab** corresponds to exactly one **Session** being Resumed
- Multiple **Pty Tabs** can exist per Project; all die when Mesh's process exits
- A **Project**'s **Activity** is derived from its Sessions' newest event timestamp
- A **Session** comprises 0..N **Usage Events** (one per assistant turn that reports usage)
- A **Usage Event** is attributed to exactly one **Project** (by the containing folder's Encoded Path) and carries a **Notional Cost**
- **Quota** is account-global — tied to neither a Project nor a Session, and read from Anthropic's OAuth endpoint rather than any Session's JSONL

## Example dialogue

> **Dev:** "When the user clicks **Analyze** on a **Project**, do we re-read every **Session** in `~/.claude/projects/<encoded-path>/`?"
>
> **Domain expert:** "No — we send `min(5 most-recent Sessions, Sessions in last 14 days)` to the **Active Provider**'s **Model**, with each Session compressed to its `away_summary` if present."

> **Dev:** "If the user **Resume**s a **Session** and then quits Mesh, what happens to the live `claude` process?"
>
> **Domain expert:** "All **Pty Tabs** are children of Mesh's main process — they die when Mesh quits. If any Pty Tab is mid-execution at quit time, Mesh confirms before killing."

> **Dev:** "What's the difference between a **Hidden** **Project** and a **Source-Missing** one?"
>
> **Domain expert:** "Hidden is the user's choice — they decided not to see it. Source-Missing is reality — the folder is gone from disk. Both are recoverable, but the recovery actions are different."

## Flagged ambiguities

- **"Summary"** — used ambiguously between *the whole Analysis* and *its first sub-section*. Resolved: **Analysis** for the whole artifact; the first sub-section is *Summary of Recent Sessions* (with the qualifier), never bare "Summary".
- **"Terminal"** — used ambiguously between *the transcript view* (read-only rendered JSONL) and *the live pty* (a running `claude --resume`). Resolved: *transcript* for the rendered JSONL view; **Pty Tab** for the live process.
- **"Dashboard"** — used in early discussion. Resolved: **Mesh** for the product, **Home Screen** for the landing view.
- **"Suggestion" / "chip"** — discussed in early Analysis design (a fourth panel of clickable actions); deferred to v2. Not part of v1 vocabulary.
- **"Utilization"** — ambiguous between a Quota window's rate-limit consumption and Notional-Cost-vs-plan-fee. Resolved: **Subscription Utilization** (money) is the only "Utilization"; a Quota window's figure is its **percent used**.
- **"Analytics"** — the token domain is **Usage**, never "Analytics" (one letter from the LLM **Analysis**, entirely different meaning). "Analytics" is not Mesh vocabulary.
