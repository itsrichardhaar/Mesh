# Changelog

All notable changes to Mesh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Mesh is currently in **beta**. Pre-1.0 versions (`0.x.y`) may include breaking
changes between releases — the SQLite schema, IPC contracts, the `ModelClient`
interface, and the Analysis output schema are all free to change until `1.0.0`.
The stable `1.0.0` release ships once every item in the
[Production Checklist](./docs/DEPLOYMENT.md#production-checklist-100) passes.

---

## [Unreleased]

### Added
- **Slice 4: Project header + Stats Row.** Clicking a sidebar Project shows its name, auto-detected subtitle, and the deterministic Stats Row (Sessions / Files Touched / Last Activity) in the right pane, with a `Not analyzed yet` empty state below.
- `MetadataDetector` (`src/main/projects/metadata-detector.ts`) — derives a Project's humanized `autoName` and `autoSubtitle` from canonical files (`package.json` with Next.js / React / TypeScript / Node.js refinement, `Cargo.toml`, `go.mod`, `pyproject.toml` / `requirements.txt`, `Package.swift`) with a dominant-extension fallback.
- `StatsComputer` (`src/main/projects/stats-computer.ts`) — walks a Project's `.jsonl` files to compute Sessions count, unique Files Touched (from `Edit`/`Write`/`Read` `tool_use` events), and the precise newest event timestamp.
- `projects:stats` IPC handler and `MeshApi.projects.stats(encodedPath)` for on-demand Stats Row computation.
- `autoSubtitle` on the `Project` shape and `ProjectStats` type in `shared/types.ts`.

### Changed
- `upsertDiscovered` no longer overwrites `auto_name` on conflict — that column is now detector-owned after first detection, so the humanized name survives every list refresh.
- The Home Screen's project-list state lifted into `useProjectList` so the right-pane detail re-renders with fresh metadata after a sidebar refresh.

---

## [0.1.0] — 2026-06-24

### Added
- **Documentation foundation** — established the project's documentary spine before any code lands. All subsequent work references this as canon.
- `CONTEXT.md` — project glossary defining 16 domain terms (Mesh, Project, Session, Analysis, Pty Tab, Workspace Screen, Mode Tab, Provider, Active Provider, Model, Stats Row, Activity, Hidden, Source-Missing, Sidechain, Encoded Path) with relationships, example dialogues, and four resolved ambiguities.
- `docs/PRD.md` — v1 product requirements: problem statement, solution, 66 user stories, implementation decisions across 11 architectural areas (stack, source of truth, persistence, secrets, Analysis, Providers and Models, Project metadata, navigation and windows, Workspace layout, File Editor, transcript renderer, pty lifecycle, state management, IPC contract, themes, modules), test coverage plan, 18 explicitly-deferred items, and a 9-slice build sequence.
- `docs/adr/0001-electron-vite-react.md` — chose Electron + Vite + React over Tauri / Next.js / native for `node-pty` maturity; accepted the ~150MB bundle as the cost of a working embedded terminal.
- `docs/adr/0002-claude-projects-is-source-of-truth.md` — Projects are auto-discovered from `~/.claude/projects/`; Mesh maintains no Project registry, only augmentation keyed by Encoded Path.
- `docs/adr/0003-provider-abstraction-claude-only-v1.md` — `ModelClient` interface and per-Provider secret storage exist from day one; only Claude is functional in v1, with OpenAI/Local pills visible-but-disabled.
- `docs/adr/0004-read-only-file-editor.md` — Monaco is read-only in v1; edits flow through Claude in a Pty Tab.
- Repository initialized at `github.com/itsrichardhaar/Mesh` (private).
- `.gitignore` covers macOS, Node, Electron, secrets, and IDE artifacts.

---

## Upcoming

### [1.0.0] — Planned

`1.0.0` will be Mesh's first stable release. Until it ships, every release is beta.

Graduation criteria (full list in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md#production-checklist-100)):

1. All nine v1 vertical slices from the PRD demonstrate end-to-end
2. The nine deep main-process modules + `TranscriptRenderer` have unit / snapshot test coverage
3. `electron-builder` produces a clean signed and notarized `.dmg`
4. The `.app` launches on a fresh machine with no dev dependencies installed
5. Mesh successfully analyzes its own `~/.claude/projects/-Users-richardhaar-Desktop-Mesh/` (dogfood test)
6. In-app auto-update via electron-updater is wired and tested

Explicitly **not** required for `1.0.0` (deferred to v1.x or v2 per the PRD):
- Functional OpenAI / Local Providers (interface exists; implementations are v1.1)
- Scheduled / cron-based Analysis (v2 opt-in)
- Suggested Next chips (v2)
- Aurora / Graphite / Nocturne named themes (v2)
- Editable Monaco File Editor (v2)
- Windows / Linux installers (v1.x release config change)
- Multi-window per Project (v2)
