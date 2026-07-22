# Mesh — Technical Descriptions

Two versions: a short block for a resume, and a long-form writeup for a portfolio case study page.

---

## Resume version

**Mesh** — AI Workspace OS for Claude Code *(Electron, React, TypeScript, SQLite, node-pty)*

Desktop app that gives Claude Code power users visibility over their scattered AI coding sessions: auto-discovers every project, renders session transcripts, resumes sessions in live embedded terminals, and generates LLM-powered activity analyses.

- Architected a local-first Electron app (React 18 + TypeScript) over Claude Code's own filesystem data, with a SQLite augmentation layer, versioned schema migrations, and an upgrade-cycle test harness that verifies every migration chain from v1.
- Built a multi-tab embedded terminal system on node-pty + xterm.js, including an App-level portal host that decouples terminal view lifetime from React navigation — scrollback and buffer state survive arbitrary screen switches.
- Designed a provider-agnostic LLM layer (`ModelClient` abstraction) running Claude and OpenAI models against schema-validated (Zod) structured outputs, with API keys encrypted at rest via the OS keychain.
- Shipped an event-driven notification subsystem: a main-process idle detector over PTY output streams, persistent SQLite-backed notifications over typed IPC channels, toast/dropdown UI, and two-tier mute controls.
- Built a local-first Usage analytics layer over Claude Code's token stream: a rebuildable SQLite cache of per-day/per-project/per-model usage, a range-aware Home dashboard (token composition, activity heatmap, notional cost at API rates), and a Subscription Utilization gauge — all reduced-color-vision safe by design.
- Maintained engineering discipline solo: 431 tests across split node/jsdom vitest projects, 11 architecture decision records, a per-release PRD process, and 61 tracer-bullet vertical slices shipped across 8 tagged releases.

---

## Portfolio case study version

# Mesh: an AI Workspace OS for Claude Code

**Role:** Solo designer/engineer · **Stack:** Electron, React 18, TypeScript, SQLite, node-pty, xterm.js, Zustand, Zod, Vitest · **Status:** v0.8.0, in daily use

## The problem

Claude Code accumulates state you can't see. Every conversation is a JSONL file in `~/.claude/projects/`; after a month of real use you have dozens of sessions across many projects, plus live agents running in terminals you've navigated away from. The CLI itself can't answer the questions that matter as usage compounds: *Which of these projects do I care about? What happened in them last week? Which agents are running right now — and which one is stuck waiting on me?*

Mesh is the answer to those questions: a desktop dashboard that reads the filesystem Claude Code already writes, adds its own metadata layer, and puts browsing, live terminals, LLM-generated analysis, and notifications on top. The more you use Claude Code, the more Mesh compounds.

## Architecture

**Filesystem as source of truth.** Mesh never asks users to register anything. It enumerates Claude Code's own project directory, parses session JSONLs (including sub-agent sidechains, rendered inline), and derives activity timestamps, stats, and transcripts from data that already exists. An architectural decision record locks this in: Mesh's SQLite database is an *augmentation* layer — user overrides, analyses, notifications — never a second source of truth that can drift.

**Versioned migrations with an upgrade-cycle harness.** Every schema change is a numbered migration, and a dedicated test walks the full chain from the very first migration on every run — asserting that a database created by any past version upgrades cleanly to the current one. When later releases added notification tables and mute columns, the safety net was already in place.

**Provider-agnostic LLM analysis.** The Analyze action compresses a project's recent sessions into a prompt and asks an LLM for a three-section structured analysis (recent work summary, next steps, suggested improvements), validated against a Zod schema at the boundary. A `ModelClient` abstraction isolates providers; when OpenAI support landed two releases after Claude, the orchestrator, IPC contract, and storage layer didn't change. API keys are encrypted with Electron's `safeStorage` (OS keychain) and never reach the renderer in plaintext.

**Live terminals with lifetime guarantees.** Resuming a session spawns `claude --resume` in a node-pty pseudo-terminal, rendered through xterm.js in a multi-tab strip. The hard problem was lifetime: React's natural component tree ties a terminal's DOM to the screen that renders it, so navigating between projects destroyed xterm buffers even though the underlying processes survived. The fix is an App-level portal host — each terminal view portals into a stable wrapper element exactly once, and the host moves wrappers between the visible workspace pane and an offscreen holding container with imperative DOM moves React never sees. Terminal view lifetime now equals process lifetime: scrollback, buffer, and selection survive any navigation. (The subtle trap, documented in the ADR: portaling into a *changing* container remounts the subtree and disposes the terminal — the exact bug being fixed.)

**Event-driven notifications.** A main-process idle detector watches each live terminal's output stream; when an agent goes quiet past a threshold while the user is looking elsewhere, it persists a notification row and emits over a typed IPC channel. The renderer surfaces toasts and a notification-center-style dropdown with jump-to-session navigation that resolves through three fallback tiers (exact process → same session → read-only transcript). Mute controls are two-tier (global + per-project) and deliberately gate *toast emission, not storage* — matching macOS Do Not Disturb semantics, because the feature's whole point is not missing things. The `kind` column is open-ended by design so future detectors (approval prompts, task completion) are code changes, not schema migrations.

**State management that can be tested without a browser.** Renderer state lives in Zustand vanilla stores — navigation, live-session registry, notifications cache — with thin selector-based React bindings. The stores are framework-free and unit-tested like any other module; selector granularity means high-frequency PTY output never re-renders components whose derived state didn't change. The renderer treats itself as a cache over the main process's authoritative SQLite: actions write through IPC and state follows the echo event, so the UI can never show unpersisted state.

## Engineering process

Mesh is also an experiment in running a solo project with team-grade discipline:

- **A living domain glossary** (`CONTEXT.md`) pins vocabulary — Project, Session, Pty Tab, Analysis, Notification — and every PRD, ADR, and commit uses it. Ambiguous terms get resolved and recorded, not worked around.
- **Eleven architecture decision records** capture the choices that would surprise a future reader: filesystem-as-truth, the provider abstraction, in-window-only notifications, read-only editing, the state-store selection, the portal host, the rebuildable usage cache, notional-cost-not-spend, and the ring-fenced networked-quota exception to local-first. Each records the rejected alternatives and why.
- **PRD → vertical slices → issues.** Each release starts with an adversarial planning session that walks the decision tree, produces a PRD, and breaks into tracer-bullet slices — thin end-to-end cuts that are independently committable and demoable. Sixty-one slices shipped this way across eight tagged releases, each gated on typecheck, tests, build, and manual verification.
- **Testing where it pays.** 431 tests across two vitest projects: a node suite over the main process (SQL boundaries, timing logic with injected clocks, migration chains) and a jsdom suite over the renderer (React Testing Library against accessible queries, with a typed mock of the entire IPC surface). Surfaces that can't run headless — xterm, Monaco — are excluded deliberately and covered by a written human-verification gate per release instead of pretending jsdom coverage means anything there.
- **Dogfood-driven prioritization.** Mesh analyzes its own development sessions daily. Real-use friction has reordered the roadmap more than once — a planned feature was displaced by a hardening release when testing showed the renderer's untested surface growing faster than its features.

## Selected details

- Accessibility is a first-class constraint: live-session indicators pair color with shape and position cues (accent bars, spinners) so state is never encoded in hue alone.
- The transcript renderer handles Claude Code's full JSONL event stream, including inline sub-agent conversations, with virtualized scrolling for long sessions.
- The file browser is gitignore-aware and live (chokidar), with syntax-highlighted read-only viewing through Monaco and Shiki.
- Terminal color palettes are derived from the app's design tokens at runtime with a WCAG-AA minimum-contrast floor enforced inside xterm — CLIs that set same-color foreground/background stay readable in both themes.

## Outcomes

Eight releases (v0.1 → v0.8) spanning discovery/browsing, analysis, live terminals, packaging, multi-provider support, visibility/notifications, renderer hardening, and a full Usage analytics arc (token analytics, notional cost, activity heatmap, subscription utilization). In daily use as the operating surface for the multi-agent Claude Code workflow it was built to manage — including its own development.
