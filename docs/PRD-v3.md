# Mesh v3 — Product Requirements Document

> Glossary terms (**Mesh**, **Project**, **Session**, **Analysis**, **Pty Tab**, **Home Screen**, **Workspace Screen**, **Mode Tab**, **Provider**, **Hidden**, **Source-Missing**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1 and v2 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force; v3 revisits none of them. v3 introduces no new glossary terms — "internal hardening" and "Go-Public" are release-management vocabulary, not domain language.

## Goal

**v3 makes Mesh production-grade internally.** Stabilize the runtime substrate — build chain, migration safety, packaged-app verification, docs alignment — so v4 and v5 feature work has a regression net and a real installable artifact to iterate against. No new user-facing features.

This is explicitly *not* a release-prep pass. **Public release is deferred** until v4–v5 feature work makes Mesh complete enough to publish. The Production Checklist's public-release subset (code signing, notarization, auto-updater, true clean-room verification, third-party install) moves to a future **Go-Public (v1.0.0)** release whose timing is TBD.

## Context

v2 shipped 10 slices on 2026-06-29 (`main` branch, 165 tests, production build succeeds), tagged `v0.2.0`. Together with v1, that delivered: project discovery from `~/.claude/projects/`, Analyses with persisted history, Workspace Screen with file tree + Sessions list + transcript + read-only Monaco, Resume → multi-tab Pty Tabs, full design system, top bar, Home cards reframe.

What's *not* yet done at v0.2.0:
- The `electron-builder` config produces a dev-only `.app` directory, not a real `.dmg` installer.
- There's no test that proves migrations don't lose data when applied on top of populated tables.
- The packaged build has never been verified end-to-end as an installed `.app` (the dogfooding has always been against `pnpm dev`).
- Several docs (ADR-0003, v1's PRD, UI tooltip strings) reference "v1.1" as the home for deferred work, but v1.1 never happened — v2 went straight to a different polish pass, and v3 explicitly defers what v1.1 had been planning.

v3 closes those gaps and updates the docs to match reality.

## Scope

Four slices, sequenced linearly:

```
Slice 29   electron-builder: x64 unsigned .dmg
Slice 30   Schema migration upgrade-cycle data-preservation test
Slice 31   Packaged-app smoke test + dogfood gate (on dev Mac)
Slice 32   Docs alignment — this PRD, DEPLOYMENT.md restructure, A+B+C cleanup
```

Unlike v2's three-phase plumbing→IA→polish sequence, v3 is single-track: each slice closes a Production Checklist gate, the order reflects dependency (31 depends on 29's `.dmg`; 32 documents what 29–31 shipped), and there's no thematic grouping above "internal hardening."

## Implementation Decisions

### Build chain (Slice 29)

`electron-builder.yml` `mac.target` switches from the dev-only `target: dir + arch: [arm64]` to **`target: dmg + arch: [x64]`** — matching the developer's actual hardware. `pnpm dist` now produces `dist/Mesh-<version>.dmg` (~134 MB) with both native modules (`better-sqlite3`, `node-pty`) rebuilt cleanly for x64. `pnpm package` continues to produce `dist/mac/Mesh.app` via the `--dir` CLI override for dev use; both scripts produce valid outputs.

The build remains **unsigned**: `identity: null`, `hardenedRuntime: false`, `gatekeeperAssess: false` are retained. Code signing and notarization are Go-Public concerns. First-launch Gatekeeper is bypassed once with right-click → Open; the bypass is documented in `DEPLOYMENT.md`.

**arm64 is explicitly deferred** until arm64 hardware is accessible for verification. Building arm64 from an x64 host requires cross-compiling `node-pty`'s native bindings, and an unverifiable arm64 `.dmg` would be a false-done. Adding arm64 later is a single-line `arch: [x64, arm64]` change once a target machine is available — no code is being built around an arm64-absent assumption.

**Known follow-up (non-blocking):** electron-builder surfaces a deprecation notice — `@electron/rebuild` is redundant since electron-builder calls it internally. The current `electron-rebuild` script still works correctly; replacing it with `electron-builder install-app-deps` is a future micro-cleanup, not a v3 item.

### Migration safety (Slice 30)

The existing migrations tests cover fresh-apply, idempotency, tracking, and transactional rollback, but none started from a *populated intermediate state*. Slice 30 adds two tests under a new `data preservation across migrations` describe block:

- **Partial apply → insert → finish:** apply only the first two migrations (`0000_init` + `0001_projects`), insert a Project row under that schema, then apply the remaining migrations. The Project row is still queryable; `settings` and `analyses` tables exist.
- **Step-through:** apply migrations one at a time, inserting representative data at each stage (a seeded `meta` row from the init migration, a Project, a setting, an Analysis). After the full chain runs, every piece of inserted data is still present, joins across `projects` ↔ `analyses` work, and all four migration ids are recorded in the tracking table.

Test count: 165 → 167. No new dev dependencies. Pattern is extensible — future migrations between minor versions extend this by adding one stage each.

Real cross-version upgrade tests (e.g., `v0.3.0 → v0.4.0`) will use the same harness when migrations between actual released versions exist.

### Packaged-app verification (Slice 31)

End-to-end verification that the `.dmg` from Slice 29 runs the full v1+v2 user journey when launched from `/Applications/Mesh.app` (not via `pnpm dev`). Combines two Production Checklist gates:

- **#6 (fresh-machine launch — partial):** the packaged app runs without depending on dev-only tools. Under v3's internal-only framing, "fresh machine" is reinterpreted as "launching from `/Applications/`, not from the dev terminal" — real clean-room verification (a Mac with no Node / pnpm / Xcode CLT installed) is deferred to Go-Public.
- **#8 (dogfood):** analyzing Mesh's own `~/.claude/projects/-Users-richardhaar-Desktop-Mesh/` returns a sensible three-section Analysis describing recent v3 work.

The slice's value is empirical: install, launch, click through the journey, dogfood. Any breakage becomes a follow-up issue — minor cosmetic findings can move to v4 backlog; real breakage gets fixed in v3 before the slice closes.

Optional bonus: install + smoke-test on a second personal/trusted Mac if convenient. Not required.

### Docs alignment (Slice 32)

Three pieces of work, all docs/text:

**1. This file (`docs/PRD-v3.md`).** Canonical record of v3's identity, scope, and deferred-public-release framing. Mirrors PRD-v2's structure.

**2. Restructure `docs/DEPLOYMENT.md` Production Checklist** into two sections:
- **Internal Hardening (v3)** — items closed by v3: TranscriptRenderer snapshots (already satisfied at the SessionReader layer pre-v3), packaged-app build for x64, migration data-preservation test, packaged-app smoke test + dogfood, docs accuracy audit.
- **Go-Public (future v1.0.0)** — items that move to a future release: code signing + notarization, auto-updater via `electron-updater`, arm64 `.dmg`, true clean-room launch verification, third-party machine install, crash reporting (currently dropped from scope; may be revisited at Go-Public).

**3. A+B+C cleanup pass.** Three principles, ratified during planning:

- **A. Preserve all CHANGELOG entries unchanged.** Each entry records what was true when the slice shipped. Future-tense statements like "v1.1 providers slot in" are honest history. Editing them would rewrite the record.
- **B. Amend ADRs and old PRDs with dated update notes rather than rewriting bodies.** `docs/adr/0003-provider-abstraction-claude-only-v1.md` gets an `## Update — 2026-MM-DD` section explaining that "v1.1" referenced then-current planning; functional OpenAI/Local now target v4+; the ADR's decision remains in force. `docs/PRD.md` (v1's PRD) gets a header note linking to PRD-v2 and PRD-v3 as current source of truth; body untouched.
- **C. Rewrite live code comments and UI strings to neutral phrasing.** `shared/models.ts`'s `comingSoonNote: 'Coming in v1.1'` becomes `'Coming soon'`. Code comments in `src/main/models/openai-client.ts` and `local-client.ts` and the inline comment in `SettingsScreen.tsx` lose their version-specific references. Generic phrasing means we don't chase versions through code when plans shift again.

After Slice 32 lands: `package.json` 0.2.0 → 0.3.0, CHANGELOG `[Unreleased]` → `[0.3.0] — YYYY-MM-DD`, new empty `[Unreleased]` opens for v4, `git tag v0.3.0`.

## Out of Scope (deferred to v4+ or Go-Public)

Everything PRD-v2's "Out of Scope" list contains stays deferred. v3 ships zero of those items. Specifically:

**Deferred to a future minor release (v4, v5, or later):**
- Functional OpenAI provider (`ClaudeClient` remains the only implementation)
- Functional Local provider
- Scheduled / cron-based Analysis
- Suggested Next chips (fourth Analysis panel)
- Editable Monaco file editor (ADR-0004 remains in force)
- Soft onboarding flow with UI Mode preselect
- Multi-window per Project
- Inline editing UI for Project rename / accent color
- Right-click context menus
- File tabs in File Editor mode
- Click-to-expand for tool calls in transcripts
- Sidechain inline expansion
- Per-project `.mesh/CONTEXT.md` materialized to disk
- Cross-Project search of Analysis content
- Cancellation of in-progress Analyses
- Background auto-analyze on file changes
- Git HEAD indicator in project header
- Aurora / Graphite / Nocturne named themes (Light/Dark only remain)

**Deferred to Go-Public (future v1.0.0):**
- arm64 `.dmg` (needs arm64 hardware for verification)
- Code signing + notarization (needs Apple Developer account + Developer ID cert)
- Auto-updater via `electron-updater` + GitHub Releases (needs public release channel)
- True clean-room fresh-machine launch verification (needs a Mac without dev tools)
- Third-party machine install — "stranger's Mac" interpretation
- Crash reporting via Sentry or equivalent (dropped from v3 scope since there are no users to surface from; may be revisited at Go-Public)
- Windows installer (separate cross-platform pass)
- Linux installer (separate cross-platform pass)
- Playwright e2e tests (deferred as infrastructure investment more relevant to feature work)

The "deferred to Go-Public" list IS the new "Go-Public" section in `DEPLOYMENT.md`'s restructured Production Checklist.

## Risks and Open Items

- **No external feedback informing v4/v5.** Internal-only iteration means feature priorities are shaped only by the developer's own usage. Long deferral of Go-Public risks building toward priorities that wouldn't survive contact with real users. Mitigation: keep the Go-Public bar (signed `.dmg` + auto-updater + arm64) as ~1–2 slices of work — when it's time, it's a short sprint, not a redesign.
- **arm64 absence in v3 means Apple Silicon machines can't run the packaged build.** Acceptable for now (developer is on Intel), but limits who can test v4/v5 builds. Mitigation: track arm64 hardware acquisition; first Apple Silicon machine triggers a follow-up slice to add `arch: [x64, arm64]` and re-verify Slice 31's checklist on it.
- **Migration test is synthetic.** All four of Mesh's existing migrations are nominally from v1; the test exercises the mechanism, not a real cross-version upgrade. First real v0.3.0 → v0.4.0 migration in v4 will be the live exercise. Mitigation: the test pattern is in place; future migrations just extend it.
- **Slice 31 is HITL — its findings are unknown until it runs.** Possible outcomes: (a) clean run, slice closes; (b) cosmetic findings, follow-ups go to v4 backlog; (c) real breakage in the packaged build, follow-up slices in v3 before Slice 32 lands. Mitigation: PRD-v3.md (this file) is written speculatively against the clean-run outcome and gets updated if 31 surfaces material findings.
- **No new ADRs expected.** v3 doesn't revisit any v1/v2 ADR. The "defer public release" decision is reversible and lives here in the PRD, not as an ADR.

## Slice Index

| # | Title | Issue |
|---|---|---|
| 29 | electron-builder: x64 unsigned `.dmg` | [#29](https://github.com/itsrichardhaar/Mesh/issues/29) |
| 30 | Schema migration upgrade-cycle data-preservation test | [#30](https://github.com/itsrichardhaar/Mesh/issues/30) |
| 31 | Packaged-app smoke test + dogfood gate | [#31](https://github.com/itsrichardhaar/Mesh/issues/31) |
| 32 | Docs alignment — PRD-v3.md, DEPLOYMENT.md restructure, A+B+C cleanup | [#32](https://github.com/itsrichardhaar/Mesh/issues/32) |

Per v1/v2 workflow conventions (kept): one issue per slice; commit body ends with `Closes #N` + the Co-Authored-By trailer; CHANGELOG `[Unreleased]` block per slice; `pnpm typecheck && pnpm test && pnpm build` green before commit; manual verification before close.

## Further Notes

- v3 keeps `~/.claude/projects/` as the canonical Project source (ADR-0002 unchanged).
- v3 keeps SQLite + `safeStorage` + the existing IPC surface. No schema migrations in v3 — Slice 30 only adds tests around the existing four.
- v3 keeps Claude as the only functional Provider (ADR-0003 unchanged; live code/UI tooltip strings rephrased from "v1.1" to "Coming soon" in Slice 32).
- v3 keeps Monaco read-only (ADR-0004 unchanged).
- v3 does not introduce any new top-level CONTEXT.md terms — "internal hardening" and "Go-Public" are release-management vocabulary, not domain language, and live only in this PRD and the restructured DEPLOYMENT.md.
- v4 planning is deliberately not specified here. When v3 ships, the next planning session decides what feature work v4 takes on first — likely some subset of: functional OpenAI provider + soft onboarding flow, or scheduled Analysis, or expanded tool-call/sidechain rendering. The "deferred to v4+" list above is a *pool of candidates*, not a sequenced backlog.
