# Mesh v1 — Product Requirements Document

> **Update — 2026-06-29.** This is the v1 PRD. v1 shipped (tag `v0.1.0`). Current source of truth for what Mesh is becoming is split across [`PRD-v2.md`](./PRD-v2.md) (v2 — design system, IA, polish; shipped as `v0.2.0`) and [`PRD-v3.md`](./PRD-v3.md) (v3 — internal hardening; shipping as `v0.3.0`). The body of this file is preserved as the v1 historical record — references to "v1.1" within it reflect then-current planning; v1.1 never happened (v2 went straight to a different polish pass), and the candidates listed there are now distributed across v4+ and Go-Public per `PRD-v3.md`'s "Out of Scope" section.

> Glossary terms (**Mesh**, **Project**, **Session**, **Analysis**, **Analyze**, **Pty Tab**, **Home Screen**, **Workspace Screen**, **Mode Tab**, **Provider**, **Active Provider**, **Model**, **Stats Row**, **Activity**, **Hidden**, **Source-Missing**, **Sidechain**, **Encoded Path**, **Source Path**) are defined in [`/CONTEXT.md`](../CONTEXT.md). Architecturally load-bearing decisions are recorded in [`/docs/adr/`](./adr/).

## Problem Statement

A developer using Claude Code accumulates dozens of project folders over time, each with its own Session history and ongoing work. Today there's no way to see them all in one place, understand what state each is in, or quickly jump back into a half-finished thread. Context-switching means digging through `~/.claude/projects/` by hand or relying on shell history. The valuable work — the decisions made, the half-formed next steps, the things one said to do tomorrow — is buried in JSONL files no one reads.

## Solution

**Mesh** is a desktop app — an "AI workspace OS" — that surfaces every Claude Code **Project** in one sidebar, lets the user trigger an LLM **Analysis** of recent work (Summary of Recent Sessions, Next Steps, Suggested Improvements), and provides a **Workspace Screen** to browse past **Sessions**, view files, and **Resume** any Session in a live terminal. Mesh reads `~/.claude/projects/` directly — no setup, no project registration. The user opens Claude Code as they always do; Mesh sees the work immediately.

## User Stories

1. As a Mesh user, I want every directory I've opened Claude Code in to appear in the sidebar automatically, so that I don't have to register Projects manually.
2. As a Mesh user, I want to see a Project's name, optional subtitle (e.g., `Next.js`), and last-activity timestamp at a glance, so that I can identify what I'm looking at.
3. As a Mesh user, I want each Project's stack to be auto-detected (TypeScript, Rust, Python, etc.) from its canonical files, so that I see meaningful context without configuration.
4. As a Mesh user, I want to rename a Project independently of its directory name, so that ugly auto-generated names don't haunt my sidebar.
5. As a Mesh user, I want to assign an accent color to a Project, so that I can visually distinguish ones I touch often.
6. As a Mesh user, I want to Hide Projects I'm no longer working on, so that my sidebar reflects current work without me deleting folders.
7. As a Mesh user, I want Projects whose Source Path has been deleted to appear greyed out as Source-Missing, so that I know to hide or restore them rather than wondering why they're broken.
8. As a Mesh user, I want to search the Project sidebar by name, so that I can quickly find a Project among many.
9. As a Mesh user, I want the sidebar sorted by most-recent Activity by default, so that what I'm actively working on is at the top.
10. As a Mesh user, I want to single-click a Project to see its latest Analysis on the Home Screen, so that I can check status without committing to opening the Workspace.
11. As a Mesh user, I want the Stats Row (Sessions count, Files Touched, Last Activity) above the Analysis, so that I have concrete numbers I trust regardless of LLM output.
12. As a Mesh user, I want to click "Analyze" to generate or refresh a Project's Analysis on demand, so that I control when LLM calls happen.
13. As a Mesh user, I want the Analysis to show three clear sections (Summary of Recent Sessions, Next Steps, Suggested Improvements), so that I can quickly find what I need.
14. As a Mesh user, I want to know the Analysis was based on N recent Sessions over the last 14 days, so that I trust the scope of what it analyzed.
15. As a Mesh user, I want prior Analyses persisted across app restarts, so that I don't lose context when I reopen the app.
16. As a Mesh user, I want a clear error banner when Analysis fails (bad API key, network issue, schema violation), so that I can fix the problem and retry.
17. As a Mesh user, I want to see a loading state while an Analysis is in flight, so that I know Mesh is working.
18. As a Mesh user, I want Mesh to remember which Analyses came from which Provider and Model, so that historical Analyses remain attributable when I change settings.
19. As a Mesh user, I want to double-click a Project to open the Workspace Screen for it, so that I have a dedicated working view.
20. As a Mesh user, I want a back affordance (and ⌘[) to return to the Home Screen from the Workspace, so that I can navigate between Projects.
21. As a Mesh user, I want my Workspace Screen state preserved when I navigate away and back, so that my Pty Tabs and scroll positions survive.
22. As a Mesh user, I want a file tree on the left of the Workspace rooted at the Project's Source Path, so that I can browse its source files.
23. As a Mesh user, I want the file tree to respect `.gitignore` by default, so that `node_modules` doesn't drown out my actual source.
24. As a Mesh user, I want to toggle showing hidden/ignored files, so that I can see config files when I need to.
25. As a Mesh user, I want the file tree to update automatically when Claude modifies files, so that I see changes the moment they happen.
26. As a Mesh user, I want a list of Sessions for the current Project in the middle column of the Workspace, sorted most-recent first, so that I can pick which conversation to look at.
27. As a Mesh user, I want each Session card to show a preview of its first message and a relative timestamp, so that I can identify Sessions without clicking each one.
28. As a Mesh user, I want to click a Session to see its transcript rendered as readable prose (with markdown and syntax-highlighted code blocks), so that I can browse what happened without launching a process.
29. As a Mesh user, I want each tool call in the transcript rendered as a one-line summary (`● Edit · src/cache.ts`), so that I see what was done without payload bloat.
30. As a Mesh user, I want Sidechain (sub-agent) activity rendered as inline `↳ sub-agent (N messages)` indicators, so that I see they happened without being overwhelmed by detail.
31. As a Mesh user, I want a Resume button in the transcript pane, so that I can explicitly continue a Session in a live terminal when I want to.
32. As a Mesh user, I want each Resumed Session to live in its own Pty Tab, so that I can run multiple Sessions simultaneously without losing any.
33. As a Mesh user, I want my Pty Tabs to persist while Mesh is running, so that navigating to the Home Screen and back doesn't kill my live work.
34. As a Mesh user, I want a visible indicator on a Pty Tab when its Session is mid-execution, so that I can see at a glance which sessions are still working.
35. As a Mesh user, I want to close a Pty Tab with an explicit affordance, so that I can free its `claude` process when I'm done.
36. As a Mesh user, I want a confirm dialog before quitting Mesh if any Pty Tab is mid-execution, so that I don't accidentally interrupt work.
37. As a Mesh user, I want to switch the Workspace's right pane between Sessions and File Editor Mode Tabs, so that I can review code without leaving the Workspace.
38. As a Mesh user, I want to click a file in the file tree to view its contents in the File Editor, so that I can read code with syntax highlighting.
39. As a Mesh user, I want the File Editor to be read-only, so that I'm not tempted to edit Mesh-side and create conflicts — edits flow through Claude.
40. As a Mesh user, I want to copy text from the File Editor, so that I can grab snippets for prompts or other tools.
41. As a Mesh user, I want files larger than 5MB to show a friendly "too large to preview" message instead of locking up Mesh, so that one big log file doesn't ruin my afternoon.
42. As a Mesh user, I want Light and Dark themes that follow my system setting by default, so that Mesh respects my OS preference.
43. As a Mesh user, I want to explicitly choose Light, Dark, or System in Settings, so that I can override the default.
44. As a Mesh user, I want all UI surfaces (sidebar, panels, Monaco, xterm) to honor the active theme, so that nothing looks out of place.
45. As a Mesh user, I want to enter my Anthropic API key in a Model Settings modal, so that I can enable Analysis.
46. As a Mesh user, I want my API key validated immediately on save with a small ping to the Provider, so that I know it works before depending on it.
47. As a Mesh user, I want my API key stored encrypted via my OS keychain, so that it's not in a plaintext file on disk.
48. As a Mesh user, I want pasting an API key to auto-save (no extra click), so that setup feels effortless.
49. As a Mesh user, I want my saved API key shown only in masked form (`sk-ant-…••••2f7`), so that it's never visible on screen after entry.
50. As a Mesh user, I want a "Get a key →" link in the modal that opens `console.anthropic.com`, so that I know where to obtain one.
51. As a Mesh user, I want to see three Provider pills (`Claude` / `OpenAI` / `Local`) in the Model Settings modal even though only Claude works in v1, so that the multi-Provider future is telegraphed.
52. As a Mesh user, I want disabled Provider pills to show a `Coming in v1.1` tooltip, so that I understand they're intentional, not broken.
53. As a Mesh user, I want to choose my Model from a curated dropdown of known models for the active Provider, so that I'm not guessing at model IDs.
54. As a Mesh user, I want a "recommended" indicator on the cheapest sensible default per Provider, so that I get good defaults without research.
55. As a Mesh user, I want approximate cost-per-Analysis shown beside each Model in the dropdown, so that I don't get surprised by Opus 4.7 prices.
56. As a Mesh user, I want to keep using Mesh (browse Sessions, view files) even without an API key configured, so that I can explore before completing setup.
57. As a Mesh user, I want a soft onboarding banner pointing to Settings when I haven't set up a Model, so that I know how to enable Analysis.
58. As a Mesh user, I want closing the Mesh window to hide it (not quit), so that I can re-open quickly from the dock.
59. As a Mesh user, I want ⌘Q to actually quit Mesh, so that I can shut it down when I want.
60. As a Mesh user, I want ⌘K to open a command palette for jumping between Projects, so that I can switch context with the keyboard.
61. As a Mesh user, I want ⌘, to open Settings, so that I can adjust preferences with the keyboard.
62. As a Mesh user, I want my settings (theme, Active Provider, Model, last opened Project, Hidden Projects) to persist across restarts, so that Mesh feels stateful between sessions.
63. As a Mesh user, I want all Mesh data stored locally and never sent anywhere except API calls I authorize, so that I trust Mesh with my project metadata.
64. As a Mesh user, I want Mesh to start fast (warm-launch under a second from the dock), so that it feels like a tool I can check in and out of.
65. As a Mesh user, I want Mesh's behavior to degrade gracefully when `~/.claude/projects/` is empty (first-time user), so that I see a useful empty state, not an error.
66. As a Mesh user, I want clear handling when `claude` CLI is not installed, so that Resume fails with a helpful message instead of a confusing error.

## Implementation Decisions

### Stack and runtime

- **Electron + Vite + React + TypeScript** as the desktop runtime, via the `electron-vite` template. Decision recorded in [ADR-0001](./adr/0001-electron-vite-react.md).
- **macOS-only installer for v1**, produced by `electron-builder`. Code is written cross-platform throughout (`safeStorage` not `keytar`, `CommandOrControl` accelerators, `app.getPath`, no macOS-only `BrowserWindow` options as load-bearing). Windows/Linux installers become a v1.x release config change, not a rewrite.
- **Hide-on-close** window behavior (red-X hides, ⌘Q quits) — preserved for UX even though no background work runs in v1.

### Source of truth

- `~/.claude/projects/` is the canonical Project list. Mesh maintains no Project registry. Decision recorded in [ADR-0002](./adr/0002-claude-projects-is-source-of-truth.md). Mesh stores only *augmentation* keyed by Encoded Path: Analyses, accent color, Hidden flag, name overrides.
- A Project's **Activity** is derived from the newest `.jsonl` mtime in its folder for sidebar sort and the Stats Row; the precise last-event timestamp is read by tailing the newest JSONL on demand for hover/display.
- **Source-Missing** is a state computed at enumeration time (Source Path doesn't exist on disk). It's distinct from Hidden — both are user-recoverable, but the recovery actions differ.

### Persistence

- **SQLite via `better-sqlite3`** at `app.getPath('userData')`. Numbered `.sql` migration files (`0001-init.sql`, `0002-…`) applied by a tiny in-app runner on startup. No ORM in v1.
- Tables: `projects` (augmentation + auto-derived metadata), `analyses` (history of three-section LLM outputs + provider/model attribution + status enum), `settings` (key/value, with `value_blob` column for encrypted secrets).

### Secrets

- Per-Provider API keys encrypted via Electron's **`safeStorage`** API (cross-platform: Keychain on macOS, DPAPI on Windows, libsecret on Linux). Ciphertext stored in the `settings` table. If `safeStorage.isEncryptionAvailable()` returns false (some Linux setups), Mesh refuses to save and surfaces the issue — no plaintext fallback.

### Analysis

- **User-initiated only.** No daily cron in v1. Scheduled Analysis becomes a v1.1 opt-in setting.
- **Input contract** built per call: cached prefix (system instructions, project context including `CLAUDE.md` if present, prior Analysis for continuity) + uncached suffix (Sessions and git activity since last Analysis).
- **Session selection**: `min(5 most-recent Sessions, Sessions in last 14 days)`. Bound is shown to the user in the success banner ("Analyzed from 4 recent sessions").
- **Session compression**: prefer the `away_summary` system event already written by Claude Code; fall back to prose + summarized tool activity (one-line summaries of tool calls) for Sessions without one. The most recent Session (if < 6 hours old) always uses prose+tools to avoid stale `away_summary` content.
- **Output schema** (Claude `tool_use` with `tool_choice` forcing the analyzer tool):
  ```ts
  {
    status: 'ok' | 'failed',
    error_message?: string,
    summary_md: string,                              // SUMMARY OF RECENT SESSIONS
    next_steps: Array<{ text: string }>,             // numbered in UI
    suggested_improvements: Array<{ text: string }>, // bulleted in UI
  }
  ```
- **Validation**: Zod-validate the LLM response before writing to SQLite; one retry on schema violation with the validation error fed back; on second failure, write a `status: 'failed'` row with the error message.
- **Stats Row** is computed deterministically (no LLM): Sessions count = number of `.jsonl` files; Files Touched = unique paths from `tool_use` events in the analyzed window; Last Activity = newest JSONL event timestamp.
- **Prompt caching** (Claude only): `cache_control` markers on system instructions, project context, and prior_analysis sections.

### Providers and models

- **Provider abstraction** in code; only Claude functional in v1. Decision recorded in [ADR-0003](./adr/0003-provider-abstraction-claude-only-v1.md). `OpenAIClient` and `LocalClient` are stub implementations of the `ModelClient` interface that throw "not implemented" if invoked.
- **`ClaudeClient`** uses the official `@anthropic-ai/sdk`, `tool_use` with `tool_choice` for structured output, and prompt caching as above.
- **Default Model**: `claude-haiku-4-5` (recommended in the dropdown). User can choose Sonnet 4.6 or Opus 4.7 with a per-Analysis approximate cost shown in the dropdown.
- **Local provider** API key is optional (most local servers don't require one). Local provider settings include a `base_url` field (default `http://localhost:11434/v1` for Ollama).

### Project metadata

- **Auto name** = humanized basename of the Source Path (e.g., `AI-OS-Dashboard` → `AI OS Dashboard`); `name_override` allows user rename.
- **Auto subtitle** detection via canonical-file priority: `package.json` (with framework refinement: Next.js, React, then plain TypeScript/Node.js) → `Cargo.toml` (Rust) → `go.mod` (Go) → `pyproject.toml` / `requirements.txt` (Python) → `Package.swift` (Swift) → dominant file extension fallback. Top-level files only; monorepos detect the root, not sub-packages.
- **Optional user descriptor** prepended to the subtitle; display form is `[descriptor] · [auto_stack]` with either side optional.
- **No avatars / monograms.** Sidebar rows use a thin left accent strip when an accent color is set; nothing when it isn't.
- **Three-layer caching**: first sighting runs detection async and shows placeholder; result cached in SQLite. Subsequent launches read from SQLite. chokidar watcher on canonical files invalidates the cache on change.

### Navigation and windows

- **Single window, two screens** (Home / Workspace) with breadcrumb back from Workspace. Workspace screen stays mounted (not unmounted) when navigated away, so Pty Tabs and scroll state survive.
- **⌘K command palette** for jumping between Projects from anywhere.
- **⌘,** opens Settings; **⌘[** goes back; **⌘Q** quits.
- Multi-window per Project deferred to v2.

### Workspace layout

- Three columns: file tree (left) | Sessions list (middle) | content pane (right).
- **Mode Tabs** at top of the content pane: `Sessions` / `File Editor` toggle.
- In `Sessions` mode, content pane shows the selected Session's read-only transcript (or — when Pty Tabs exist — the active Pty Tab's xterm). Pty Tab strip lives above the xterm area.
- In `File Editor` mode, content pane shows the file selected in the file tree, rendered by Monaco with `readOnly: true`.

### File Editor

- **Read-only Monaco** in v1. Decision recorded in [ADR-0004](./adr/0004-read-only-file-editor.md).
- Lazy-loaded on first entry to File Editor mode (Monaco is ~5MB; not worth cold-start cost otherwise).
- 5MB file-size cap; oversized files show a friendly "too large to preview" message.
- File tree powered by chokidar in main; renderer subscribes to change events and refreshes affected nodes.

### Transcript renderer

- **Medium fidelity** in v1: prose with full markdown + lazy-loaded `shiki` syntax highlighting; tool calls collapsed to `● <Tool> · <key arg>` one-liners; tool results hidden; system events hidden; Sidechains as inline `↳ sub-agent (N messages)` indicators (not click-expandable in v1).
- Libraries: `react-markdown`, `shiki`, `react-virtuoso` for virtualized scroll of long transcripts.
- Resume button placed top-right of the transcript pane, primary button style.
- Session-level "started / ended" timestamps in the transcript header; no per-message timestamps to preserve visual rhythm.
- Large `tool_result` payloads are skipped at parse time (the JSONL is read line-by-line; oversized result `content` fields are ignored before they enter memory).

### Pty lifecycle

- Multi-tab persistent ptys, **children of Mesh's main process** — die with the process. No detached/orphan ptys.
- Each tab maps 1:1 to a resumed Session. xterm.js instances stay mounted in the DOM across tab switches (`display: none`) so per-tab scrollback survives without main-side replay logic.
- **On quit**: if any Pty Tab is mid-execution, show a confirm dialog. Otherwise SIGTERM all ptys with a 3s SIGKILL grace period, then quit.
- **`pty.list()`** IPC exists for renderer-crash rehydration: if the renderer reloads, it can list existing ptys in main and reconnect xterm instances.

### State management

- **TanStack Query** for all IPC-derived state (projects list, latest analysis per project, sessions list, file tree, file contents, settings). Query keys tied to Encoded Path where relevant.
- **Zustand** for pure-UI state (current screen, selected Project / Session / file, workspace Mode Tab, open modal, sidebar collapsed).
- **Invalidation events** pushed from main to renderer via a typed event bridge (`analysis-complete`, `file-tree-changed`, `project-list-changed`, `sessions-changed`). Renderer subscribes once at app boot and dispatches Query invalidations.
- **Pty data is NOT a Query.** It's a stream subscription. xterm components subscribe directly to `pty-data` events for their ptyId.

### IPC contract

- `contextBridge.exposeInMainWorld('api', ...)`. Preload is a pure forwarding layer with no logic.
- Surface (illustrative, not exhaustive):
  - `projects.list()`, `projects.update(encodedPath, patch)` (hide, accent_color, name_override, etc.)
  - `analyses.latest(encodedPath)`, `analyses.history(encodedPath)`, `analyses.run(encodedPath)`
  - `sessions.list(encodedPath)`, `sessions.readTranscript(sessionId)`
  - `files.tree(encodedPath, opts)`, `files.read(absPath)`
  - `pty.create({ sessionId, cwd, cols, rows })`, `pty.write(id, data)`, `pty.resize(id, c, r)`, `pty.kill(id)`, `pty.list()`
  - `settings.get(key)`, `settings.set(key, value)`, `secrets.set(provider, key)`, `secrets.has(provider)`
  - Streaming `events.on(event, callback)` for the invalidation/pty-data channel.

### Themes

- **Light/Dark only in v1**, with a full design-token layer via CSS custom properties keyed off a `data-theme` attribute on `<html>`. Aurora/Graphite/Nocturne deferred to v2 as additional palette files.
- Monaco theme and xterm theme objects derive from the same token values and update on theme change.
- Tailwind configured to read colors from the CSS variables, not hard-coded — utilities like `bg-surface` resolve through the token layer.

### Modules (per the user-approved sketch)

**Main process (deep, prime test candidates):** `ProjectEnumerator`, `MetadataDetector`, `SessionReader`, `StatsComputer`, `AnalysisOrchestrator`, `ModelClient` interface + `ClaudeClient`, `SecretsVault`, `PtyManager`, `Database` + migration runner.

**Main process (shallow, integration glue):** `FileTreeService`, `IpcRouter`, `WindowManager`, `AppBootstrap`, `SettingsStore`.

**Preload:** `PreloadBridge`.

**Renderer:** `HomeScreen`, `WorkspaceScreen`, `ProjectSidebar`, `AnalysisPanel`, `WorkspaceLayout`, `FileTree`, `SessionsList`, `TranscriptRenderer`, `PtyTabBar` + `TerminalView`, `FileEditor`, `ModelSettingsModal`, `SettingsPage`, `ThemeProvider`, `Queries` (TanStack hooks) + `useUiStore` (Zustand).

## Testing Decisions

**What makes a good test:** External behavior, not implementation. Test that `AnalysisOrchestrator.run(project)` returns a validated three-section result for a given Sessions fixture — not that it builds the prompt in a particular order.

**Modules tested in v1** (per user agreement):

- `ProjectEnumerator` — decodes paths correctly; identifies Source-Missing state from filesystem fixtures.
- `MetadataDetector` — given fixture directories (one with `package.json` + `next` dep, one with `Cargo.toml`, etc.), returns the expected `autoSubtitle`. Pure function; trivial to fixture.
- `SessionReader` — parses fixture JSONLs correctly; surfaces `away_summary` when present; handles malformed lines without crashing; ignores oversized `tool_result.content` at parse time.
- `StatsComputer` — given a Sessions fixture, returns the expected Sessions / Files Touched / Last Activity values.
- `AnalysisOrchestrator` — given a Project fixture and a mocked `ModelClient`, builds the correct input contract (5/14-day window, `away_summary` compression), invokes the client, validates the response, writes to SQLite. The heart of the test suite.
- `ClaudeClient` — given a mocked Anthropic SDK, constructs the correct request (tool_use, tool_choice, cache_control markers), and translates responses correctly. Connection-validation path tested.
- `SecretsVault` — round-trips a secret through a mocked `safeStorage`; correctly refuses to save when `isEncryptionAvailable()` returns false.
- `PtyManager` — given a mocked `node-pty`, transitions through create/write/resize/kill correctly; SIGTERM-then-SIGKILL grace period works; `list()` returns expected state.
- `Database` + migration runner — applies migrations from fixture directory in order; doesn't re-apply already-applied migrations; opens a fresh in-memory DB for tests.
- `TranscriptRenderer` (renderer-side) — snapshot tests with fixture JSONLs (including ones with Sidechains and large tool_results) that verify the rendered React tree matches expected shape.

**Test runner**: Vitest (works natively with Vite; same test runner across main and renderer).

**Fixtures**: real JSONL captures from `~/.claude/projects/` (sanitized of any sensitive content); small synthetic `package.json` / `Cargo.toml` / `go.mod` fixtures for `MetadataDetector`.

**Prior art**: none — Mesh is greenfield. Test patterns will be established during the first deep-module's tests and reused.

**Out of scope for v1 tests**: Playwright / e2e tests; renderer component tests beyond `TranscriptRenderer` snapshots; visual-regression. Deferred to v1.x once UX has stabilized.

## Out of Scope

For v1, the following are explicitly deferred:

- **Suggested Next chips** (the fourth Analysis panel + chip-click flow) and GitHub-issue-based chip sourcing — deferred to v2.
- **Scheduled / cron-based Analysis** — deferred to v2 as an opt-in setting.
- **Functional OpenAI and Local providers** — interface exists in v1; implementations land in v1.1.
- **Aurora / Graphite / Nocturne themes** — Light/Dark only in v1; named palettes are v2 palette files.
- **Editable Monaco file editor** — read-only in v1 ([ADR-0004](./adr/0004-read-only-file-editor.md)).
- **Multi-window per Project** — single window with screen navigation in v1.
- **Inline editing UI for Project rename / accent color** — schema and rendering exist; editing UI is v1.1.
- **Right-click context menus** on Projects, Sessions, file tree nodes — v1.1.
- **File tabs in File Editor mode** — one file at a time in v1.
- **Click-to-expand for tool calls in transcripts** — one-liners only in v1; v1.1 makes them expandable.
- **Sidechain inline expansion** — indicators only in v1; v1.1 opens them in a side panel.
- **Per-project `.mesh/CONTEXT.md`** materialized to disk — context lives in Mesh's DB only in v1.
- **Windows / Linux installers** — Mac-only `.app` for v1; cross-platform code paths exist throughout for v1.x to enable.
- **Code signing / Apple notarization** — personal-use unsigned `.app` for v1.
- **Playwright e2e tests** — manual QA for renderer in v1.
- **Cross-Project search of Analysis content** — possible future SQL-backed feature.
- **Cancellation of in-progress Analyses** — Analyses run to completion in v1.
- **Background auto-analyze on file changes** — Analyze is manual in v1.

## Further Notes

- The **build order** I'd recommend is foundational modules first (`Database`, `ProjectEnumerator`, `ModelClient` interface), then vertical slices that each end in a demonstrable feature: (1) sidebar lists real Projects → (2) Home Screen shows selected Project's stats + empty Analysis state → (3) Analyze button works end-to-end → (4) Workspace Screen opens with file tree + Sessions list → (5) Session click renders transcript → (6) Resume button spawns a working Pty Tab → (7) File Editor mode shows files → (8) Settings + Model Settings modal complete → (9) Theming + polish. Each slice ends runnable.
- The Mesh **`~/.claude/projects/-Users-richardhaar-Desktop-Mesh/`** folder already exists (we've been chatting in it). Once Mesh runs, it will analyze itself — which is the simplest possible dogfood test.
- **`CONTEXT.md`** is the project glossary — use its terms consistently. In particular: **Analysis** for the LLM artifact (never bare "Summary"), **Pty Tab** for live terminals (never bare "Terminal"), **Session** for recorded JSONLs (never "Chat" or "Conversation"), **Workspace Screen** for the per-Project view (never "Dashboard").
- **ADR-0001 to 0004** capture the load-bearing decisions. New decisions that meet the bar (hard-to-reverse + surprising + real trade-off) should be added as numbered ADRs as they're made.
- **Issue tracker**: this PRD lives at `docs/PRD.md` because no issue tracker is configured for the Mesh project. When a GitHub repo (or other tracker) is set up, this PRD can be transferred to a primary tracking issue with the `ready-for-agent` label.
