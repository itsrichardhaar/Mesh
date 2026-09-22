# Mesh v11 — Product Requirements Document

> Glossary terms (**Worktree Run**, **Gate Run**, **Parent Project**, **Project**, **Session**, **Encoded Path**, **Source Path**, **Source-Missing**, **Usage**, **Usage Event**, **Notional Cost**, **Usage Filter**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v10 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force. **v11 records one new ADR — [ADR-0014](./adr/0014-worktree-runs-nested-under-parent.md)** — Worktree Runs nest under their Parent Project (recognized from the path or via git), the no-mistakes Gate Run subtype is attributed and enriched by a ring-fenced state read, and run Usage is folded into the Parent at query time.
>
> **v11 makes no SQLite schema change.** `kind`, `parentEncodedPath`, and the gate metadata are derived at discovery time from the Source Path / git plus the ring-fenced read — nothing new is persisted in `mesh.db`. The `usage_events` cache is untouched (ADR-0009); the run→Parent rollup is a query-time projection, not a stored re-attribution.

## Goal

**v11 stops treating git worktrees as new Projects and shows them as what they are — work on a branch of an existing Project.** The acute case is the `no-mistakes` gate: every run executes Claude Code in a throwaway worktree, so Claude Code writes a Session under an Encoded Path Mesh has no choice but to discover — and today each becomes a phantom top-level **Project**: a raw ULID name, flagged **Source-Missing** the moment its branch merges and the worktree is deleted, stacked above the real Project it validated. Building `moves` yesterday produced 13 of them. v11 recognizes any worktree-backed Project as a **Worktree Run** of a **Parent Project** and presents it accordingly, with the `no-mistakes` **Gate Run** subtype enriched with its pass/fail status and PR.

v11 ships three things:

1. **Recognition + honest labeling.** A Project whose Source Path is a git worktree is recognized as a **Worktree Run** — via the anchored `.no-mistakes/worktrees/<repoId>/<runId>` path pattern (a **Gate Run**, works even after the worktree is deleted) or, for a still-live worktree, via git plumbing. Its row no longer shows the alarming **Source-Missing** state (a merged, cleaned-up worktree is *expected*, not an error) and instead carries an unmistakable **no-mistakes** or **worktree** tag with the run's branch/intent as its label.
2. **Nesting under the Parent Project.** Runs are attributed to the real Project they belong to and rendered as a collapsed-by-default **`▸ Worktree runs (N)` / `▸ Gate runs (N)`** sub-group beneath it in the sidebar — each run individually openable (read-only transcript view), each Gate Run enriched with its pass/fail status and a link to its PR.
3. **Usage rolled up to the Parent.** A run's token consumption folds into its Parent Project's Usage — the by-Project breakdown, a Project-scoped filter, and the Project Screen's own stats (tokens, Notional Cost, **and Session count**) all count the runs as part of the Project whose work they were. Runs stop appearing as their own line items and stop cluttering the Usage Filter's Project dropdown.

**Driven by dogfooding.** This is the friction v11 exists to remove: the sidebar became unreadable after a day of gated development, and the same phantom runs were double-listed in the Usage by-Project view. The gate is a permanent part of this project's workflow (`memory/no-mistakes-gate.md`), so its footprint in Mesh needs a permanent home.

## Context

Facts, verified live, that set v11's shape:

1. **The worktree layout is stable and self-describing.** no-mistakes runs each gate in `…/.no-mistakes/worktrees/<repoId>/<runId>/`; Claude Code records the worktree as the Session's `cwd`, which Mesh already reads during discovery. So *recognition* of a Gate Run — and extraction of its `repoId`/`runId` — needs nothing but the path Mesh already has, and works after the worktree is deleted. A **live** worktree (generic, non-no-mistakes) is instead recognizable via `git-common-dir`, which also yields its Parent in one step.
2. **no-mistakes keeps an authoritative local state store.** `~/.no-mistakes/state.sqlite` has a `repos` table (`id → working_path`, e.g. `018d9e76994c → /Users/richardhaar/Documents/moves`) and a `runs` table (`id → status, pr_url, pr_state, branch, intent`), where `runs.id` is the worktree ULID. This is the single read that turns a `repoId` into a named **Parent Project** and a `runId` into rich per-run metadata (a `failed`/`completed` status, a `merged`/`none` PR state, a branch like `16-event-detail-sheet`, and an `intent` like *"Build issue #16, the consumer event detail sheet"*).
3. **The Usage cache keys on the literal Encoded Path.** `usage_events.encoded_path` is the attribution key for every aggregation (`GROUP BY encoded_path`), and 1,551 gate-run Usage Events already sit in the cache. Rolling them up is a matter of mapping a run's Encoded Path to its Parent's — the only question is *where* the map is applied.
4. **A deleted run's changes remain recoverable.** The no-mistakes bare repo retains each run's branch, and `runs` stores `base_sha`/`head_sha` — so `git diff base..head` reconstructs what a merged-and-cleaned run changed. This makes an in-app diff view feasible, but it is a distinct capability **deferred to v12**; v11 covers "what changed" for merged runs via the PR link.

Governing decisions (ADR-0014):

- **Recognize by two paths.** The disk-independent path pattern for Gate Runs (works after deletion); git plumbing for live generic worktrees. Recognition alone tags the row and suppresses Source-Missing.
- **Attribution/enrichment via a ring-fenced, read-only, best-effort read of `state.sqlite`.** Contained to `src/main/gate/`, never written — a second deliberate exception to local-first alongside the networked Quota fetch (ADR-0011).
- **Usage folds at query time, never at ingest.** Rewriting the cache's Encoded Path would break ADR-0009's faithful-mirror guarantee and go stale whenever the read is unavailable. The rollup is a projection in main's aggregation layer, correct-at-read-time, mirroring ADR-0013.
- **Every Parent stat is inclusive.** Tokens, Notional Cost, *and* Session count roll up, so each Parent figure means the same thing ("everything that happened for this Project").
- **Degrade quietly.** If `state.sqlite` is unreadable, recognized runs still tag and suppress Source-Missing and collapse under a synthetic grouping node (repo name if known, else `repoId`) that is *not* a fabricated Project (ADR-0002 holds).

What v11 changes relative to `v0.10.x`:

- **The sidebar drowns in phantoms.** One top-level ULID-named, Source-Missing Project per run — 13 for a single day on `moves` — above the real Projects.
- **"Source-Missing" cries wolf.** A merged run's deleted worktree is normal housekeeping, but Mesh renders it with the same greyed-out alarm as a genuinely lost Project.
- **Usage double-counts by-Project.** Each run is its own by-Project row and its own Project-dropdown entry, so a Project's real spend is scattered across a dozen ULIDs instead of attributed to the Project.

## Problem Statement

As a Claude Code power user who gates every change through `no-mistakes`, I open Mesh after a day of building and my Project sidebar is buried under a stack of identical-looking ULID entries, every one flagged "Source missing" as if something broke. They're not broken and they're not projects — they're the gate's validation runs for the one project I was actually working on. I can't tell at a glance which project they belong to, whether each run passed or failed, or where its PR went. And when I open Usage to see what that project cost me, its spend is smeared across a dozen phantom rows instead of totaled under the project's name. I want the runs tracked and revisitable — just presented as what they are: worktree runs of their parent project.

## Solution

A Project whose Source Path is a git worktree is recognized as a **Worktree Run** and never shown as a phantom top-level Project again. In the sidebar its Parent Project gains a quiet, collapsed **`▸ Worktree runs (N)`** disclosure (**`Gate runs (N)`** for no-mistakes); expand it and each run is one indented row carrying a **no-mistakes** / **worktree** tag, and — for a Gate Run — a ✓/✗ for pass/fail, the run's intent (or branch) as its label, and a link to its PR. No run shows the "Source missing" alarm; a cleaned-up worktree is expected. Click a run to open its read-only Sessions/transcript view and inspect that single run. And in the Usage views, each run's tokens fold into its Parent Project — the by-Project breakdown totals them under the project's name, selecting that project in the Usage Filter includes them, and the Project Screen's own headline (tokens, cost, sessions) counts them — so a project's real spend reads as one number instead of a dozen ULIDs.

## User Stories

1. As a Mesh user, I want a worktree recognized automatically as a run of its parent project, so that I never have to identify one by hand.
2. As a user, I want a no-mistakes run recognized even after its worktree is deleted, so that merged runs are still classified correctly.
3. As a user, I want a run to *not* show the "Source missing" state, so that routine, merged, cleaned-up runs don't look like broken projects.
4. As a user, I want each run to carry an obvious **no-mistakes** or **worktree** tag, so that I can tell at a glance it's a run and not a real project.
5. As a user, I want runs nested under the real project they belong to as a `Worktree runs (N)` / `Gate runs (N)` sub-group, so that they're grouped with the work they're part of.
6. As a user, I want the runs group collapsed by default, so that my sidebar stays as clean as it was before I started gating.
7. As a user, I want to expand a project's runs group, so that I can review its runs when I want to.
8. As a user, I want each gate-run row labeled by its intent or branch, so that I can tell what that run was building without decoding a ULID.
9. As a user, I want each gate-run row to show whether it passed or failed, so that I can spot the failed runs at a glance.
10. As a user with reduced color vision, I want pass/fail conveyed by a glyph and label, not hue alone, so that I can read a run's outcome regardless of color perception.
11. As a user, I want a link to a gate run's PR when it has one, so that I can jump to the pull request from Mesh.
12. As a user, I want to open a single run, so that I can inspect that run's Sessions/transcript read-only, with Resume and the file tree disabled when the worktree is gone.
13. As a user, I want a project's runs' token spend counted in that project's Usage totals, so that its real spend is attributed to it.
14. As a user, I want the by-Project Usage breakdown to total each project's runs under the project's name, so that I don't see a dozen ULID rows.
15. As a user, when I select a project in the Usage Filter, I want its runs' Usage included, so that the filtered views show the project's complete spend.
16. As a user, I want runs omitted from the Usage Filter's Project dropdown, so that the dropdown lists only real projects.
17. As a user, I want a project's Project Screen stats — Sessions, tokens, Notional Cost — to include its runs, so that every parent stat means the same thing.
18. As a user, I want runs still tracked and reachable even when no-mistakes' state can't be read, so that a missing state store degrades to plain runs, not phantoms.
19. As a user, I want a run whose parent can't be resolved grouped under a single synthetic node (repo name if known), so that unattributable runs still don't clutter the top level.
20. As a user, I want searching the sidebar to match a run's intent/branch and reveal its parent, so that I can find a run by what it built.

## Implementation Decisions

Governing ADR: **ADR-0014**. New glossary terms: **Worktree Run**, **Gate Run**, **Parent Project**. No schema change; no persisted run state.

**Recognition (M1).** `recognizeWorktreeRun(sourcePath, { onDisk }) → { kind, repoId?, runId? } | null` combines two detectors: (a) an anchored regex matching `.no-mistakes/worktrees/<repoId>/<runId>` anywhere in the decoded Source Path — `<repoId>` hex, `<runId>` ULID — classifying a **Gate Run** disk-independently; (b) for a still-on-disk Source Path that isn't a Gate Run, `git-common-dir` classifies a generic **Worktree Run** and yields its main worktree. Pure where possible; the git call is isolated and only fires for live, non-gate dirs.

**Ring-fenced no-mistakes reader (M2, best-effort).** `src/main/gate/no-mistakes-state.ts` opens `~/.no-mistakes/state.sqlite` **read-only** and returns two maps: `repoId → workingPath` (from `repos`) and `runId → { status, prUrl, prState, branch, intent }` (from `runs`). Any failure (absent file, lock, shape change) resolves to empty maps — never throws. Contained to `src/main/gate/`; the local-state analog of ADR-0011's credential hygiene. A short in-process cache avoids re-opening per `projects:list` / `usage:get-dashboard` call.

**Attribution in discovery (M3).** The `projects:list` handler enriches each `DiscoveredProject`: a recognized run sets `kind: 'worktreeRun'` and a `subtype: 'gate' | 'plain'`; `parentEncodedPath` resolves via the M2 `repos` map (Gate Runs) or git plumbing (live worktrees) → the discovered Project sharing that Source Path (normalized/realpath-compared), encoded back to its Encoded Path; Gate Runs attach the `runId`'s metadata; `sourceMissing` semantics are decoupled — the badge is suppressed for runs while the disk-gone *behavior* still keys off actual on-disk existence. An unresolved Parent yields a synthetic grouping node id (repo name if `working_path` known, else `repoId`).

**Project type (shared/types.ts).** `Project` gains `kind: 'project' | 'worktreeRun'`, `subtype: 'gate' | 'plain' | null`, `parentEncodedPath: string | null`, and `gate: { repoId, runId, status, prUrl, prState, branch, intent } | null`. All derived at list time; none persisted.

**Sidebar tree (M4).** `SidebarBody` groups the flat `Project[]` into a tree: top-level rows are `kind === 'project'` plus synthetic grouping nodes; each parent's runs render as indented children under a `▸ Worktree runs (N)` / `▸ Gate runs (N)` disclosure, **collapsed by default**. Collapse state is renderer-local (keyed by parent Encoded Path), session-only. Top-level sort unchanged (Activity descending); runs sort within their group by Activity. Search matches a parent's name *or* a child's intent/branch, auto-expanding a parent on a child match.

**Run row presentation (M5).** Each child row shows: a **no-mistakes** / **worktree** tag (labeled pill, never hue-only), for a Gate Run a status glyph (✓ `completed`/`merged`, ✗ `failed`), a label resolved as `intent → branch → short runId`, the relative Activity time, and — when `prUrl` is present — an affordance opening the PR in the default browser. No Source-Missing pill. Reduced-color-vision: shape + text carry state.

**Open-a-run behavior (M5).** Clicking a run reuses the existing read-only transcript/Sessions view; Resume and the file tree are disabled when the worktree is gone (the existing Source-Missing *behavior*, now driven by on-disk existence rather than the badge). No new screen.

**Usage rollup (M6, query-time).** A run-attribution resolver in main exposes `displayEncodedPath(encodedPath) → parentEncodedPath | self` and `membersOf(parentEncodedPath) → [parent, ...runs]`, both built from the M2 maps + recognition. Applied at the aggregation layer only:
- **By-Project breakdown** merges each run's aggregate into its Parent's row (tokens summed, distinct sessions summed — Session ids are globally unique across worktrees — `lastActivity` maxed).
- **Project-scoped filter** (`usage:get-dashboard` with a Parent `encodedPath`) expands the predicate to `encoded_path IN membersOf(parent)`.
- **Project Screen** (`usage:get-project-summary`, `projectUsageCounts`) resolves its `encodedPath` to `membersOf(parent)` before counting — including Session count.
- **Notional Cost** (ADR-0010) rolls up automatically.
- The **Usage Filter Project dropdown** lists only `kind === 'project'` Projects.
The `usage_events` cache and its keys are untouched (ADR-0009).

**Degrade-quietly (M7).** With empty M2 maps, Gate Runs are still recognized (M1) and tagged, Source-Missing suppressed, and nest under a synthetic grouping node keyed by `repoId` (labeled by `runId`, no status/PR); Usage folds under that node. No view blocks.

## Testing Decisions

**What makes a good test here:** exercise external behavior through a module's public interface. v11's correctness-critical logic is path recognition, the best-effort read, and the query-time rollup — all pure or DB-level and testable without Electron.

- **`recognizeWorktreeRun` (M1, pure).** Real gate-run paths → `{kind:'gate', repoId, runId}`; ordinary Project paths and near-misses (`.no-mistakes/repos/*`, a path merely *containing* the segment mid-way, a non-ULID/non-hex id) → `null`; the git-plumbing branch is exercised against a temp worktree fixture. Prior art: the pure helpers in `util/`.
- **`no-mistakes-state` reader (M2, main + temp DB).** A seeded temp `state.sqlite` yields the expected `repos`/`runs` maps; an absent file, a locked file, and a missing-column shape each resolve to empty maps without throwing. Prior art: `tests/usage-repository.test.ts` (temp SQLite).
- **Attribution (M3, main + in-memory DB).** A discovered gate-run dir resolves to the right `parentEncodedPath` when its `repoId`'s `workingPath` matches a discovered Project; the badge is suppressed while disk-gone behavior still keys off existence; an unresolved `repoId` yields the synthetic node. Prior art: the enumerator tests.
- **Usage rollup (M6, main + in-memory DB).** Seed a Parent and two of its runs across models; assert the by-Project breakdown returns one merged row (tokens/sessions/cost summed) and no ULID rows; a Parent-scoped `usage:get-dashboard` includes the runs; the Project summary counts them (incl. sessions). Prior art: `tests/usage-dashboard.test.ts`, `tests/usage-repository.test.ts`.
- **Renderer (M4/M5, RTL).** The runs group renders collapsed, expands on click, hides the Source-Missing pill, shows the tag + (gate) pass/fail glyph + intent label + PR affordance, and reveals the parent when a search matches a child. Prior art: the v6 RTL harness (`tests/renderer/*`, `window.api` mock in `test-utils`).

Tests assert observable outputs (returned aggregates, rendered rows, resolved maps), never internal query structure.

## Out of Scope

- **In-app read-only diff viewer** ("view what a run changed", incl. failed-run and offline diffs) — **deferred to v12**; feasible via `git diff base_sha..head_sha` against the bare repo. v11 covers merged-run diffs through the PR link.
- **Modifying no-mistakes.** Mesh reads its state; it never writes to `~/.no-mistakes/` or changes how the gate runs.
- **Persisting run metadata in `mesh.db`.** Everything is derived at list time; no migration, no stored re-attribution.
- **Ingest-time Usage re-attribution.** Rejected by ADR-0014; the cache stays a faithful mirror and the rollup is query-time.
- **Cleaning up or deleting stale Claude Code session dirs** for merged runs. Mesh presents them; housekeeping of `~/.claude/projects/` is not Mesh's job.
- **Fabricating a Parent Project row** for a gate-only repo — a non-Project synthetic grouping node is used instead (ADR-0002 holds).
- **Per-run Notification / Pattern-Matcher changes.** Runs surface in the sidebar and Usage; the notification subsystem (ADR-0006/0012) is unchanged.
- **A dedicated Worktree Run detail screen.** Opening a run reuses the existing read-only transcript view scoped to its Encoded Path.

## Further Notes

- **CONTEXT.md** gains **Worktree Run**, **Gate Run** (its no-mistakes subtype), and **Parent Project** this cycle; **Source-Missing** is amended to note the badge/behavior decoupling. **ADR-0014** records the recognition/attribution/rollup decision.
- **Reduced-color-vision** (`memory/user-reduced-color-vision.md`) governs the new tag and pass/fail glyph: shape + label first, hue only as reinforcement.
- **Ring-fenced dependency** (`memory/no-mistakes-gate.md`): v11 is the first time Mesh reads no-mistakes' own state. Read-only, best-effort, contained to `src/main/gate/`, exactly the posture ADR-0011 established for the Quota exception.
- **Slicing (tracer-bullet, foundation-first).** Filed under parent issue #77; slice issues #78–#82:
  - *Slice A* (#78) — **Recognize + tag (no-mistakes path pattern), flat.** `recognizeWorktreeRun` path detector (M1) + `kind`/`subtype` on `Project` (M3, recognition-only) + sidebar **no-mistakes** tag, Source-Missing badge suppressed, badge/behavior decoupled (still flat). Self-contained; fixes the visceral symptom on day one. No external read.
  - *Slice B* (#79) — **Attribution + nesting + generic worktrees.** The ring-fenced reader's `repos` map (M2) + the git-plumbing detector for live worktrees (M1) + `parentEncodedPath` (M3) + the collapsible `Worktree runs (N)` / `Gate runs (N)` tree with the synthetic-node fallback (M4/M7). Depends on A.
  - *Slice C* (#80) — **Gate enrichment.** The reader's `runs` map (M2) + gate-run row status glyph, intent/branch label, and PR link (M5). Depends on B.
  - *Slice D* (#81) — **Usage rollup.** The run-attribution resolver + by-Project merge, Parent-scoped expansion, Project-summary rollup (incl. Session count), and Project-dropdown filtering (M6). Depends on A + B.
  - *Slice E* (#82, HITL) — **PRD-v11 + ADR-0014 close-out + CONTEXT terms + v0.11.0 release ceremonials + packaged-build install + `pnpm dev` smoke** (`memory/verify-dev-not-only-dist.md`). Planning artifacts committed at planning time, so the closing slice does not re-commit them (mirrors Slice 57/61/67/74).
- v11 keeps `~/.claude/projects/` as the canonical source (ADR-0002/0009), Notional Cost (ADR-0010), the networked Quota exception (ADR-0011), the parameterized Usage Filter (ADR-0013), and the notification subsystem (ADR-0006/0012) all in force and unchanged.
