# Mesh v2 — Product Requirements Document

> Glossary terms (**Mesh**, **Project**, **Session**, **Analysis**, **Pty Tab**, **Home Screen**, **Workspace Screen**, **Mode Tab**, **Provider**, **Hidden**, **Source-Missing**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v2 introduces two new terms (defined inline below): **Top Bar** and **UI Mode** (Mono / Sans). v1 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; v2 revisits none of them.

## Goal

**v2 makes Mesh feel production-level.** A UI/UX polish and information-architecture pass over the v1 surface — no new feature work. Bigger product moves (functional OpenAI/Local providers, editable Monaco, Suggested Next chips, scheduled Analysis, named themes) are deferred to v3.

## Context

v1 shipped 18/18 slices on 2026-06-25 (`main` branch, 165 tests, production build succeeds). It works — sidebar, Analyses, Workspace, Sessions, Resume → Pty Tab, File Editor — but the surface feels assembled, not designed. v2 is the deliberate-design pass: consistent chrome, a real design system, a refined Home model, and visible attention to detail (terminal contrast, file-tree icons, Analysis content treatment).

This is explicitly a refinement v2, not a feature v2. The v1 deferred-to-v2 list in `docs/PRD.md` ("Out of Scope") moves wholesale to v3 instead.

## Scope

Three phases, sequenced for low waste:

1. **Plumbing** (slices 19–20) — typography foundation, token scales, icon library, app icon. Low visible change, high downstream leverage.
2. **IA shell** (slices 21–23) — top bar, Home cards reframe, Workspace tab restructure. Muscle-memory-disruptive; dogfooded heavily.
3. **Per-screen polish** (slices 24–28) — Analyze bar, Analysis content, file tree icons, terminal palette, scrollbar/focus/motion capstone.

Plumbing lands first (counter to a strict "IA-first" sequence) because typography tokens aren't polish — they're tokens the IA slices use. Building the design plumbing once, before IA churn, avoids re-touching every component twice.

## Implementation Decisions

### Top Bar (new, v2)

App-wide chrome row across every screen. Replaces the floating Settings gear (commit `0d19095`) and per-screen drag strips.

**Layout (left → right):**

```
[ traffic lights ]  [ Mesh icon ][ Mesh wordmark ]  ............  [ ☀/🌙 ][ ⚙ ]
```

- Mesh wordmark click = navigate to Home Screen (no breadcrumb chrome).
- Theme toggle is **binary** (sun ↔ moon), reflects current *effective* theme. Settings retains the tri-state (Light / Dark / System).
- Settings icon opens Settings; same handler as `⌘,`.
- Entire strip is a single `-webkit-app-region: drag` region. Interactive elements inside it are `no-drag`. This resolves the v1 drag-region gotcha (per CHANGELOG `[Unreleased]`) — the top bar IS the canonical drag region.
- `< Home` button in the Workspace screen is kept as a secondary in-context affordance. The Mesh wordmark in the top bar is the global home button (works from anywhere); the Workspace's `< Home` is the contextual one when you're inside a Project.

### Home Reframe

**Right pane on app launch:** cards grid of recent Projects (top 12 active in the last 14 days). Replaces the "selected Project's Analysis" landing of v1.

**Card anatomy:**

```
┌──────────────────────────────────┐
│▌ Mesh                            │   ← title (link to Analysis)
│  React TypeScript                │   ← auto-subtitle (muted)
│                                  │
│  2h ago · 4 sessions · 12 files  │   ← inline metrics
│                                  │
│  Analyzed 1h ago                 │   ← analysis status (muted)
│                                  │
│                Open Workspace →  │   ← CTA (link to Workspace)
└──────────────────────────────────┘
```

- Click anywhere on card → Analysis. Click `Open Workspace →` → Workspace.
- A11y: card-as-link with stretched pseudo-element (Inclusive Components pattern). Title is the link, button is a sibling, no nested interactive elements, distinct `aria-label`s.
- Hidden Projects: never on cards.
- Source-Missing Projects: excluded from cards, visible only in sidebar.
- Projects active >14d ago: excluded from cards, visible only in sidebar.
- Empty state (0 projects): centered headline + paragraph. Copy: *"No projects yet. Mesh discovers projects automatically from `~/.claude/projects/`. Open Claude Code in any folder to get started — it'll appear here on next launch."* Coexists with the existing API-key onboarding banner.

**Sidebar:** collapsible "Projects" dropdown listing all Projects (no card limit).

**Active / Idle / Source-Missing rendering:**

- Threshold: **14 days** (matches cards window and Analysis input contract — single horizon across the app).
- Default state (Active): plain text, no pill.
- Idle (>14d): grayed text + muted "Idle" pill.
- Source-Missing: grayed text + amber "Source missing" pill (warning tone).
- No italics anywhere in the sidebar (italic on monospace renders as fake-italic in Mono mode — looks broken).

### Workspace Tab Restructure

**Mode Tabs span the entire content area** (everything right of the file tree), not just the right pane.

```
Workspace Screen:
├─ File tree (left, collapsible — chevron toggle, persisted globally)
└─ Content area:
   ├─ Mode Tabs: [ 📁 Sessions ] [ 📝 File Editor ]   ← spans full content width
   └─ Below tabs:
      ├─ Sessions mode: [ session list | transcript or Pty Tab xterm ]
      └─ File Editor mode: [ file editor (full width) ]
```

- Session list column is no longer always-visible. It lives *inside* the Sessions tab and disappears in File Editor mode.
- File tree is always visible by default; chevron/splitter toggle hides it. Hidden state persists globally (one preference, not per-Project).
- Pty Tab bar location unchanged: top of the live-terminal area, inside the Sessions tab's right column.
- Resume button location unchanged: top-right of transcript pane.
- Clicking a file in the tree from Sessions mode auto-switches to File Editor mode (current Slice 18 behavior preserved).

### Design System

**Two foundational `data-*` attributes on `<html>`:**

- `data-theme` — light / dark (v1, unchanged).
- `data-ui-mode` — sans / mono (v2, new).

**Typography (Slice 19):**

- Fonts: **Inter** (sans) and **JetBrains Mono** (mono), both self-hosted as variable-font files (~120KB each).
- `--font-sans`, `--font-mono`, `--font-ui` (the last flips between the first two based on `data-ui-mode`).
- Size scale: `--text-xs / -sm / -base / -md / -lg / -xl / -2xl` (11 / 13 / 14 / 15 / 18 / 22 / 28 px).
- Weights: `--weight-regular / -medium / -semibold` (400 / 500 / 600).
- Line heights: `--line-tight / -normal / -relaxed` (1.2 / 1.5 / 1.7).
- Letter spacing: `--tracking-tight / -normal / -wide`.
- Monaco and xterm both follow `--font-mono`.

**UI Mode toggle (Settings):**

- Two-option control: `Mono / Sans` with one-line hint per option.
- Settings retains its existing tri-state theme picker; UI Mode is independent.
- `data-ui-mode="mono"` flips `--font-ui`, tightens `--radius-base` (8 → 4px), nudges `--tracking-normal` slightly wider.
- v2 default: **Sans** (matches v1 visual; existing users see no jolt).
- v3 onboarding will let new users pick on first launch.

**Tokens added in v2 (Slice 20, then incrementally per polish slice):**

- Spacing: `--space-1` (4px) through `--space-12` (48px), semantic naming preferred where useful.
- Radii: `--radius-sm / -md / -lg / -full`; `--radius-base` is the one `data-ui-mode` flips.
- Shadows: `--shadow-sm / -md / -lg` (vs the single v1 `--shadow-popover`).
- Motion: `--duration-fast / -base / -slow` and `--ease-default`.

**Naming convention:** semantic, not numeric. `--space-md`, not `--space-4`.

**Icon library:** Lucide React (UI chrome). 2px stroke, tree-shakeable, MIT.

**File-type icons:** Material Icon Theme (file tree only). VS Code-style colored folders by name + special-file glyphs (CHANGELOG, README, .gitignore, package.json, tsconfig.json, etc.).

### Analyze Bar + Project Header

**Unified state-aware bar** above the Analysis content. Consolidates v1's three separate banners (in-flight / success / failed) plus the never-analyzed empty state.

| State | Bar content (left) | Button (right) |
|---|---|---|
| Never analyzed | "Not yet analyzed" | + Analyze |
| Analyzing | "Analyzing…" + spinner | hidden |
| Success | "Analyzed from N sessions (last 14 days) · Xm ago · Claude Haiku 4.5" | + Re-analyze |
| Failed | "Last attempt failed: <message>" | + Try again |

**Project header (single inline row):**

```
Mesh   ~/Desktop/Mesh   React TypeScript
↑           ↑                  ↑
title    muted path      subtitle
```

- Title: `--text-2xl`, `--weight-semibold`, `--text-primary`.
- Path: `--text-base`, `--text-muted`. Tilde-shortened when under `~/`. Long paths ellipsize, full path on hover.
- Subtitle: `--text-base`, `--text-secondary` (current treatment).

### Analysis Content Styling

Section structure (Summary of Recent Sessions / Next Steps / Suggested Improvements) is unchanged; visual treatment is rebuilt.

- **Section headers:** small-caps text, `--text-sm`, `--weight-semibold`, `--text-secondary` color, `--tracking-wide`. Icon inline at left (`FileText` / `ListChecks` / `Lightbulb`), 16px, same color as text. Subtle 120px-wide `--border-subtle` rule beneath.
- **Accent is preserved as a CTA color** — section headers do NOT use accent. Accent stays reserved for buttons, active states, selected items.
- **Next Steps:** filled `--accent-soft` circular badges (20px), number in `--text-primary`. Generous spacing (`--space-4` between items).
- **Suggested Improvements:** 6px filled dots in `--accent` color (this is the controlled accent moment in Analysis content).
- **Section spacing:** `--space-8` between sections.

### File Tree

- Material Icon Theme integration via `material-icon-theme` package SVG assets.
- VS Code-style colored folders by name (src/ blue, tests/ yellow, docs/ purple, node_modules/ grey, .git/ red, etc.) — Material Icon Theme's built-in mappings.
- Special-file glyphs for CHANGELOG / README / LICENSE / CONTRIBUTING / .gitignore / .env / package.json / tsconfig.json / etc. Full set, not curated.
- Ignored / hidden files: text stays muted (current behavior); icon renders at full opacity. Icon = type signal, mute = ignored signal.
- Icon size: 16px. Gap to filename: 8px. Chevron remains a separate UI element from the folder icon (chevron is interactive, icon is not).

### Terminal Palette

Light-mode terminal contrast bug (yellow on cream is unreadable) is fixed by providing explicit ANSI palettes for both modes.

- **Mesh Light ANSI** — derived from Solarized Light, accent slots warmed toward Mesh peach (yellow → `#a36a30`, brightYellow → `#c08540`). All 16 ANSI slots contrast-verified against `--bg-canvas` (`#faf8f4`).
- **Mesh Dark ANSI** — explicit palette for symmetry; values start from xterm defaults and adjust only where contrast is poor against `#1a1814`.
- Palettes live as **TypeScript constants** (`MESH_LIGHT_ANSI`, `MESH_DARK_ANSI`), not CSS tokens. ANSI palettes are coherent groups that change together; CSS tokens are for surfaces.
- `background` / `foreground` / `cursor` / `cursorAccent` / `selectionBackground` continue to read CSS tokens (current behavior).

### App Icon

- Apply Mesh icon (blue-purple gradient with grid glyph) as v2 placeholder. Provided assets:
  - `build/icon.icns` (macOS bundle, electron-builder picks this up)
  - `build/icon.png` (1024px, for `BrowserWindow({ icon })` in dev mode)
  - Renderer `public/icon.png` referenced from `index.html` for favicon
- Icon style is NOT brand-aligned (gradient palette doesn't match Mesh's warm cream/peach). Brand-aligned redesign deferred to a v2.x slice or v3 once design system is bedded in.

### Scrollbars + Capstone (Slice 28)

Cross-cutting polish that's awkward to do per-screen — done once at the end, applied everywhere.

- Custom scrollbar styling: thin (8px), themeable, hover-prominent. Webkit `::-webkit-scrollbar` rules + Firefox `scrollbar-width: thin`.
- Focus rings: consistent shape (2px accent-tinted outline, `--radius-base`), applied at the global level for all focusable elements.
- Motion: consistent use of `--motion-*` tokens across transitions (hover state changes, theme/mode flips, card hover lifts).

## Slice Index

| # | Phase | Title | Issue |
|---|---|---|---|
| 19 | Plumbing | Typography foundation + Mono/Sans toggle | [#19](https://github.com/itsrichardhaar/Mesh/issues/19) |
| 20 | Plumbing | Icon library + token scales + app icon | [#20](https://github.com/itsrichardhaar/Mesh/issues/20) |
| 21 | IA shell | Top bar (app-wide chrome) | [#21](https://github.com/itsrichardhaar/Mesh/issues/21) |
| 22 | IA shell | Home cards reframe + sidebar Active/Idle/Source-Missing pills | [#22](https://github.com/itsrichardhaar/Mesh/issues/22) |
| 23 | IA shell | Workspace tab restructure | [#23](https://github.com/itsrichardhaar/Mesh/issues/23) |
| 24 | Polish | Unified Analyze bar + project header path | [#24](https://github.com/itsrichardhaar/Mesh/issues/24) |
| 25 | Polish | Analysis content styling | [#25](https://github.com/itsrichardhaar/Mesh/issues/25) |
| 26 | Polish | File tree icons (Material Icon Theme) | [#26](https://github.com/itsrichardhaar/Mesh/issues/26) |
| 27 | Polish | Terminal palette (Mesh Light / Mesh Dark ANSI) | [#27](https://github.com/itsrichardhaar/Mesh/issues/27) |
| 28 | Polish | Scrollbars + focus + motion capstone | [#28](https://github.com/itsrichardhaar/Mesh/issues/28) |

Per v1's workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; smoke test in `pnpm dev` and verify with user before close.

## Out of Scope (deferred to v3)

These items move from v1's "Out of Scope" list to v3:

- Functional OpenAI and Local Providers (only `ClaudeClient` is implemented in v2).
- Scheduled / cron-based Analysis.
- Suggested Next chips (fourth Analysis panel).
- Aurora / Graphite / Nocturne named themes (Light/Dark only in v2).
- Editable Monaco file editor (ADR-0004 holds; v2 keeps `readOnly: true`).
- Multi-window per Project.
- Inline editing UI for Project rename / accent color.
- Right-click context menus.
- File tabs in File Editor mode.
- Click-to-expand for tool calls in transcripts.
- Sidechain inline expansion.
- Per-project `.mesh/CONTEXT.md` materialized to disk.
- Windows / Linux installers.
- Code signing / Apple notarization.
- Playwright e2e tests.
- Cross-Project search of Analysis content.
- Cancellation of in-progress Analyses.
- Background auto-analyze on file changes.
- Git HEAD indicator in project header (seen in mockups; not in scope).
- Soft onboarding flow with UI Mode preselect (lands in v3 alongside multi-Provider).

## Risks and Open Items

- **App icon palette mismatch.** Placeholder icon is blue-purple gradient; Mesh's brand is warm cream/peach. Visible inconsistency. Mitigation: ship placeholder in v2, schedule brand-aligned redesign for v2.x or v3.
- **Material Icon Theme bundle weight.** 1500+ SVGs total. Mitigation: lazy-load on demand, or bundle full set (~600KB compressed — acceptable for desktop app). Measure during Slice 26 implementation.
- **Light-mode ANSI palette tuning.** Starting values in Slice 27 are best-guess; actual implementation requires visual contrast verification against the live light canvas. Budget for 1–2 hours of palette tweaking in the slice.
- **Mono mode visual QA surface.** Every component change in v2 must look reasonable in 4 combinations: Light+Sans, Light+Mono, Dark+Sans, Dark+Mono. Each polish slice gets verified across all four before close.
- **No new ADRs expected.** v2 doesn't revisit any v1 ADR (provider abstraction, read-only editor, etc.). If an unexpected architectural decision surfaces, it gets a new numbered ADR.

## Further Notes

- v2 keeps `~/.claude/projects/` as the canonical Project source (ADR-0002 unchanged).
- v2 keeps SQLite + safeStorage + the existing IPC surface. No schema migrations unless a slice explicitly calls for one.
- The Mono/Sans toggle ships in Settings in Slice 19. The soft-onboarding flow that pre-selects it for new users is v3 — not v2.
- The handoff doc warned about reflexive use of `improve-codebase-architecture` and `code-review`. v2 changes a lot of UI surfaces; targeted manual review per slice is sufficient. Architectural review tools are not appropriate until v3 work begins.
