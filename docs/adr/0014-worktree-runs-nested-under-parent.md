# Worktree Runs nest under their Parent Project — recognized from the path or via git, no-mistakes Gate Runs attributed and enriched by a ring-fenced state read, Usage folded at query time

Mesh discovers a **Project** for every subdirectory of `~/.claude/projects/` (ADR-0002).
Git worktrees break the one-dir-one-Project assumption: Claude Code run inside a worktree writes its Sessions under that worktree's Encoded Path, so the worktree surfaces as its own top-level Project even though it is really work on a branch *of* an existing repo.

The acute case is the `no-mistakes` validation gate.
It executes each run inside a throwaway worktree at `…/.no-mistakes/worktrees/<repoId>/<runId>/`, then deletes the worktree once the branch merges — so Mesh is left with a phantom top-level Project per run: a raw ULID name, flagged **Source-Missing**, stacked above the real Project it validated (13 for the `moves` repo in a single day). They are not Projects; they are validation runs *of* a Project, and their token consumption *is* that Project's consumption.

This ADR records how Mesh recognizes any worktree-backed Project as a **Worktree Run**, attributes it to its **Parent Project**, enriches the `no-mistakes` **Gate Run** subtype, and rolls run Usage up — without registering Projects independently of Claude Code's data (ADR-0002) and without polluting the rebuildable Usage cache (ADR-0009).

## Decision

**Recognize Worktree Runs by two complementary paths; attribute/enrich the no-mistakes subtype via a ring-fenced, read-only, best-effort state read; fold Usage into the Parent at query time.**

1. **Recognize a Worktree Run.**
   Two detectors, because worktrees may be live or already deleted:
   - **Path pattern (disk-independent).** A Source Path whose decoded form contains the anchored segment `.no-mistakes/worktrees/<repoId>/<runId>` — `<repoId>` shape-validated as hex, `<runId>` as a ULID — is a **Gate Run**. Matched *anywhere* in the path (not `$HOME`-anchored), so it survives no-mistakes' `store_in_repo` layout and any relocated home. This is the only detector that works after the worktree is deleted, and it needs nothing outside Mesh.
   - **Git plumbing (live worktrees).** For a Source Path still on disk that isn't a Gate Run, `git-common-dir` resolves whether it's a worktree and yields its main worktree — recognizing a generic **Worktree Run** and its Parent in one step.
   Recognition alone is enough to tag the row (**no-mistakes** / **worktree**) and suppress its Source-Missing badge.

2. **Attribute and enrich the Gate Run subtype via `~/.no-mistakes/state.sqlite` (ring-fenced, best-effort).**
   That SQLite file holds a `repos` table (`id → working_path`) and a `runs` table (`id → status, pr_url, pr_state, branch, intent`), where `runs.id` is the worktree ULID.
   Mesh opens it **read-only** to map `repoId → working_path` (→ the discovered Parent Project by Source Path equality) and `runId → gate metadata`.
   This is a deliberate, second ring-fenced exception to local-first, alongside the networked Quota fetch (ADR-0011): a read of *another local tool's private state store*, contained to `src/main/gate/`, never written, never surfaced raw, cached briefly in-process.

3. **Fold Usage into the Parent Project at query time, never at ingest.**
   The `usage_events` cache keeps the literal worktree Encoded Path as each Usage Event's attribution key — it stays a faithful, rebuildable mirror of `~/.claude/` (ADR-0009), and the `cwd`-is-provenance-only rule (CONTEXT.md) is untouched.
   The run→Parent rollup is a **presentation projection** applied in main's aggregation layer (where ADR-0013 already scopes the Timeframe/Project filter): the by-Project breakdown merges a run's tokens into its Parent's row, a Project-scoped filter expands a selected Parent to `Parent ∪ its Worktree Runs`, and the Project Screen's own stats — **including Session count** — include its runs. Notional Cost (ADR-0010) rolls up for free, computed on the aggregated result. Worktree Runs are omitted from the Usage Filter's Project dropdown.

4. **Degrade quietly.**
   If `state.sqlite` is absent, locked, or shape-changed, attribution and enrichment drop: recognized Gate Runs still tag and suppress Source-Missing, and collapse under a **synthetic grouping node** — labeled by the repo name when `working_path` is resolvable, else `repoId` — which is *not* a fabricated Project (ADR-0002 holds). Usage folds under that node. No view blocks. Mirrors ADR-0011's failure posture.

## Considered Options

- **Treat worktrees as ordinary Projects (status quo)** — rejected: the reported problem. Phantom ULID rows, all Source-Missing, drowning the real Projects and double-listing their token spend in the by-Project view.

- **Hide worktree dirs entirely** — rejected: the user wants them tracked and revisitable, and their Usage is real spend that belongs to the Parent. Hiding discards a dogfood-relevant signal (what validation costs).

- **Rewrite each Usage Event's Encoded Path to the Parent at ingest** — rejected: bakes a mutable, no-mistakes-derived attribution into the cache, breaking ADR-0009's faithful-mirror guarantee. The cache would hold *wrong* keys whenever `state.sqlite` is unavailable at ingest or a repo is re-registered, and would need a full rebuild to correct. Query-time folding is always correct-at-read-time and leaves the audit trail intact.

- **Attribute Gate Runs by matching each bare repo's git remote to a Project's origin, avoiding `state.sqlite`** — rejected as primary: still reaches into `~/.no-mistakes`, needs a git subprocess per repo, and *fails* when a gated repo's origin differs from the discovered Project's (forks, renames). `state.sqlite` gives `working_path` directly in one read and also carries the run enrichment; the git-remote route survives only as a conceptual fallback.

- **Synthesize a full Parent Project row from `working_path` when the Parent isn't discovered** — rejected: fabricating a Project with no Claude Code Sessions of its own bends ADR-0002. A non-Project grouping node keeps the guarantee and is nearly as informative.

- **Recognize the no-mistakes path pattern only, git plumbing / general worktrees out of scope** — rejected: the user's model is that *no* worktree is a new Project. Generalizing costs one extra detector (standard git plumbing) and future-proofs against any worktree tool; no-mistakes stays the enriched subtype.

- **Recognize both, ring-fence the state read, fold Usage at query time — chosen.**

## Consequences

- **No Mesh schema change.** `kind`, `parentEncodedPath`, and the gate metadata are all *derived* at `projects:list` time from the path/git plus the ring-fenced read — nothing new is persisted in `mesh.db`. Matches v10's no-migration posture.

- **A second ring-fenced local-first exception, documented as such.** ADR-0011 reads Claude Code's credential store and Anthropic's endpoint; ADR-0014 reads no-mistakes' state store (and, in v12, its bare-repo objects for the diff viewer). Both are contained, read-only, and degrade quietly. Everything else stays purely `~/.claude/`-local.

- **Coupled to no-mistakes' on-disk layout and `state.sqlite` shape.** Brittle by nature, like ADR-0011's undocumented endpoint. The `repos(id, working_path)` and `runs(id, status, pr_url, pr_state, branch, intent)` columns are the load-bearing surface; a change there downgrades Gate Runs to the synthetic-node fallback, never a crash.

- **Parent Project totals become inclusive of their Worktree Runs** — tokens, Notional Cost, *and* Session count. This is the intended, more-accurate meaning: everything that happened for that Project reads as one figure, and every Parent stat means the same thing. Individual runs stay openable from the sidebar to inspect a single run's Sessions and cost.

- **Source-Missing badge and disk-gone behavior are decoupled.** A deleted worktree still disables the file tree / Resume (source genuinely gone) but shows the **no-mistakes**/**worktree** tag instead of the Source-Missing alarm. Clicking a run reuses the existing read-only transcript view; no new screen.

- **Reduced-color-vision (memory/user-reduced-color-vision.md).** A run's pass/fail state is a glyph shape + text label, never hue alone; the **no-mistakes** / **worktree** tag is a labeled pill, not a color.

- **v12 follow-on.** An in-app read-only diff view of *what a run changed* — reconstructable via `git diff base_sha..head_sha` against the bare repo (branches and shas persist after worktree deletion) — is deferred. v11 covers "what changed" for merged runs through the PR link; failed-run and offline diffs wait for v12.
