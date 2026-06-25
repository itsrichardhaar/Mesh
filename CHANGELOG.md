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
- **Slice 9: Provider pills + Model dropdown.** Settings → Model now shows three Provider pills (Claude active; OpenAI and Local disabled with a `Coming in v1.1` tooltip) and a Model dropdown for Claude with `Haiku 4.5`, `Sonnet 4.6`, and `Opus 4.7`. Each row carries an approximate per-Analysis cost and Haiku 4.5 is flagged Recommended. The selected Model persists in the `settings` table under `model:claude`.
- `shared/models.ts` — `PROVIDERS` catalog, `ModelDescriptor` / `ProviderDescriptor` shapes, recommended lookup, and the `selectedModelSettingKey(providerId)` helper.
- `ModelClient` interface in `shared/types.ts` with `AnalysisOutput`, `AnalyzeProjectInput`, `ValidationResult`.
- `ClaudeClient` shell (constructor + readonly model/provider) and `OpenAIClient` / `LocalClient` stubs in `src/main/models/`. Method bodies for Claude land in Slices 8/10; the stubs throw `not implemented in v1` per ADR-0003. 8 new tests pin the contract.
- **Slice 7: API key entry + safeStorage round-trip.** Settings → Model now has an Anthropic API key field. Pasting a string that starts with `sk-ant-` auto-saves on the spot; ciphertext is stored as bytes in `settings.value_blob` (encrypted via Electron's `safeStorage`, backed by macOS Keychain). The field renders the stored key masked (`sk-ant-…••••XXXX` = first 7 + last 4) with a Clear button. Restarting Mesh preserves the saved key. When the OS keychain isn't available, the field surfaces an explicit error instead of falling back to plaintext.
- `SecretsVault` (`src/main/secrets/vault.ts`) — encryption-backend seam (so tests can inject a fake), set/get/getMask/clear, refuses to save when encryption is unavailable. 13 vault tests covering round-trip, overwrite, the encryption-unavailable branches, and the masking rules.
- `MeshApi.secrets` — `available()`, `set(provider, plaintext)`, `getMask(provider)`, `clear(provider)`. Plaintext never crosses the IPC bridge in the read direction; the renderer only ever sees the mask.
- `ProviderId` shared type (`claude` | `openai` | `local`) plus a `secret:<provider>` SQLite key namespace so v1.1 providers slot in without a schema change.
- **Slice 6: Light/Dark theming + design tokens.** Mesh now ships matching light and dark palettes switched by `<html data-theme>`. Settings → Appearance lets the user pick `Follow system` (default), `Light`, or `Dark`; the choice persists in SQLite, `nativeTheme.themeSource` mirrors it so the macOS title bar tracks the in-app palette, and `matchMedia('(prefers-color-scheme: dark)')` keeps Mesh in sync with the OS in real time while in `Follow system`.
- `settings` table + migration `0002_settings.sql` (string `value` + reserved `value_blob` for Slice 7 secrets) and a `getSetting` / `setSetting` repository with full test coverage.
- `MeshApi.settings.get/set` (async, SQLite-backed) and `MeshApi.theme.setSource` (one-way, for `nativeTheme`).
- `ThemeProvider` + `useTheme` hook owning the preference, the effective palette, and the live OS-theme subscription.
- `--text-error`, `--shadow-popover`, and a parallel dark palette covering every existing token. Remaining hex / rgba literals removed from component CSS — every color references a token.
- **Slice 5: Settings screen shell + ⌘, shortcut.** `CommandOrControl+,` opens a Settings screen with placeholder `Appearance` and `Model` sections. Esc or `CommandOrControl+W` returns to the previous screen. Settings is a screen (not a modal); the underlying Home Screen stays mounted so state survives the round-trip.
- Application menu (`src/main/menu.ts`) — custom template owns the navigation accelerators (`CommandOrControl+,`, `CommandOrControl+W`) so the renderer can interpret each based on the active screen.
- `window:close` IPC + `MeshApi.window.close()` so the renderer can delegate the hide-on-close behavior when ⌘W is pressed outside Settings.
- `MeshApi.menu` event subscriptions (`onOpenSettings`, `onCloseRequested`) bridging menu clicks/accelerators into the renderer.
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
