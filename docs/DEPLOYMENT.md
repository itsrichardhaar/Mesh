# Deployment Guide

Mesh is an Electron desktop application. There's no server to provision, no PHP to install, no database to set up — install the `.app`, drag it to Applications, launch it.

This guide covers the current **beta** install method (build from source), where Mesh's data lives, what to back up, and the gates that `1.0.0` must clear before promoting from beta to stable.

> **Beta notice.** Mesh is pre-1.0. There is no signed installer yet — macOS Gatekeeper will warn about an unidentified developer on first launch. See [First Launch](#first-launch). Code signing and notarization land before `1.0.0`.

---

## Requirements

| Requirement | Details |
|---|---|
| macOS | 12.0+ (Monterey or newer) |
| Disk space | ~250 MB for the `.app` + ~50 MB for user data |
| RAM | 8 GB minimum; 16 GB recommended when running multiple Pty Tabs |
| Claude Code CLI | Required for the Resume / Pty Tab feature — `claude` must be on `PATH` |
| Anthropic API key | Required for Analysis — get one at [console.anthropic.com](https://console.anthropic.com) |
| Internet | Required only for Analysis (LLM API calls); everything else works offline |

Verify the `claude` CLI is reachable before launching Mesh:

```bash
which claude && claude --version
```

If `claude` isn't installed, Resume will fail with a helpful error in the workspace; the rest of Mesh still works (sidebar, transcript viewing, file tree, File Editor).

---

## Build Requirements (beta only)

To produce a `.app` from source you also need:

| Tool | Version |
|---|---|
| Node.js | 20+ (LTS) |
| pnpm | 9+ (recommended); npm works too |
| Xcode Command Line Tools | latest (for native module compilation: `better-sqlite3`, `node-pty`) |

```bash
xcode-select --install   # if not already installed
node --version           # should print v20.x or newer
pnpm --version           # should print 9.x or newer
```

---

## Building from Source (beta)

```bash
git clone git@github.com:itsrichardhaar/Mesh.git
cd Mesh
pnpm install
pnpm package
```

The build produces `dist/Mesh.app`. Move it to your Applications folder:

```bash
mv dist/Mesh.app /Applications/
```

A future v1.x release will ship `.dmg` artifacts via [GitHub Releases](https://github.com/itsrichardhaar/Mesh/releases) and you'll be able to skip the build step entirely.

---

## First Launch

**On an unsigned beta build, macOS Gatekeeper will block the first launch.**

1. Right-click `Mesh.app` in Finder → **Open** → confirm the dialog. (This is a one-time bypass; subsequent launches behave normally.)
2. Mesh opens to the **Home Screen**. The sidebar populates from `~/.claude/projects/` — every directory you've used Claude Code in appears automatically.
3. A soft onboarding banner points to **Settings → Model**. Open Settings (⌘,) and paste your Anthropic API key. Mesh validates it with a single-token ping and shows `✓ Connected` on success.
4. Click any Project in the sidebar → **Analyze** to confirm end-to-end. The three-section Analysis (Summary of Recent Sessions, Next Steps, Suggested Improvements) renders in the right pane.

If the API-key validation fails:
- Confirm the key starts with `sk-ant-…`
- Confirm your machine has internet access
- Confirm the Anthropic console shows the key as active

---

## Data Locations

| Path | Purpose | Owner |
|---|---|---|
| `~/Library/Application Support/Mesh/mesh.db` | All Mesh data: Analyses, Project augmentation, settings | **Mesh** |
| macOS Keychain (entry: `Mesh`) | Anthropic API key, encrypted via `safeStorage` | **Mesh** |
| `~/.claude/projects/<encoded-path>/*.jsonl` | Sessions — source of truth for Mesh's Project list | **Claude Code** |
| `~/.claude/sessions/`, `~/.claude/cache/`, etc. | Other Claude Code state | **Claude Code** |

**Mesh never writes to `~/.claude/`.** It reads Project folders and Session JSONLs; everything Mesh generates lives in `~/Library/Application Support/Mesh/`. Uninstalling Mesh has no effect on Claude Code's data.

---

## Backup

Everything Mesh owns is in two places. To back up:

```bash
# 1. Mesh's database (Analyses, settings, Project augmentation)
cp ~/Library/Application\ Support/Mesh/mesh.db ~/backups/mesh-$(date +%Y%m%d).db

# 2. The Anthropic API key lives in macOS Keychain and travels with the OS user.
#    Time Machine backs it up automatically. No manual export needed.
```

To also back up the underlying Claude Code data (the conversations Mesh analyzes), back up `~/.claude/projects/`. That's outside Mesh's scope — it belongs to Claude Code — but worth doing for the same reasons you'd back up any working directory.

| Path | On backup |
|---|---|
| `~/Library/Application Support/Mesh/mesh.db` | **Back up** — Mesh's content |
| macOS Keychain | Backed up automatically with Time Machine |
| `~/.claude/projects/` | Recommended — Mesh's data source |
| `~/Applications/Mesh.app` | Don't back up — rebuild from source instead |

Simple daily cron backup:

```bash
0 2 * * * cp ~/Library/Application\ Support/Mesh/mesh.db ~/backups/mesh-$(date +\%Y\%m\%d).db
0 2 * * * find ~/backups/ -name "mesh-*.db" -mtime +30 -delete
```

---

## Updates (beta)

In beta, updates are manual:

```bash
cd path/to/Mesh
git pull
pnpm install                          # only needed when dependencies changed
pnpm package
mv dist/Mesh.app /Applications/       # replaces the existing .app
```

Your `mesh.db` and Keychain entry are preserved across rebuilds. SQLite schema migrations apply automatically on first launch after an update — you don't run them manually.

A future v1.x release will add an in-app auto-updater via `electron-updater` + GitHub Releases. Until then, watch the [CHANGELOG](../CHANGELOG.md) for new versions.

---

## Uninstalling

```bash
# Remove the app
rm -rf /Applications/Mesh.app

# Remove Mesh's data (irreversible)
rm -rf ~/Library/Application\ Support/Mesh/

# Remove the API key from Keychain:
# Open Keychain Access.app → search "Mesh" → delete the entry
```

Mesh leaves nothing behind outside those locations. `~/.claude/` is untouched — Mesh never wrote to it.

---

## Production Checklist

Restructured in v3 (see [`PRD-v3.md`](./PRD-v3.md)) into two sections: items closed by v3's **Internal Hardening** pass, and **Go-Public** items deferred to a future `1.0.0` release. Public release is deferred until v4/v5 feature work makes Mesh complete enough to publish.

### Internal Hardening (v3) — closed

These gates were closed during v3 (`0.3.0`). Mesh is now production-grade internally: real installer artifact, migration safety net, end-to-end packaged-app verification, docs aligned to shipped reality.

- [x] **`TranscriptRenderer` snapshot coverage** — satisfied at the `SessionReader` layer pre-v3 (`tests/session-reader.test.ts`). The reader produces the structured event stream the renderer consumes, and its fixture-driven tests pin transcript output deterministically, including Sidechain handling.
- [x] **`electron-builder` produces a clean `.dmg` for macOS x64** (Slice 29). `pnpm dist` produces `dist/Mesh-<version>.dmg`. arm64 is deferred to Go-Public, pending arm64 hardware for verification.
- [x] **Schema migration verified through an upgrade cycle with no data loss** (Slice 30). Two new tests under `data preservation across migrations` in `tests/migrations.test.ts` exercise the *mechanism* — partial-apply → insert → finish, and step-through with representative data inserted at each stage. Pattern extends naturally to future real cross-version migrations.
- [x] **Packaged-app smoke test + dogfood** (Slice 31). The `.dmg` from Slice 29 was installed to `/Applications/Mesh.app` and the full v1+v2 user journey was walked through on the packaged build (not `pnpm dev`). Mesh dogfooded itself by analyzing `~/.claude/projects/-Users-richardhaar-Desktop-Mesh/`. Slice 31 surfaced one real bug — a native-module ABI mismatch in the packaged build (fixed in [`9344bd3`](https://github.com/itsrichardhaar/Mesh/commit/9344bd3)) — exactly the kind of breakage the slice exists to catch.
- [x] **Docs accuracy audit** (Slice 32). This file restructured; `PRD-v3.md` published; `ADR-0003` amended with a dated update note; live code comments and UI strings neutralized (`'Coming in v1.1'` → `'Coming soon'`). CHANGELOG history preserved verbatim per the A+B+C cleanup principles.

### Go-Public (future `1.0.0`) — deferred

These gates remain open and gate the eventual public `1.0.0` release. They are deferred because v3 is explicitly an internal-only hardening pass — public release is not the goal until v4/v5 feature work makes Mesh complete enough to publish.

- [ ] **`.dmg` for macOS arm64.** Needs arm64 hardware for verification. Adding arm64 once that's available is a single-line `arch: [x64, arm64]` change in `electron-builder.yml` plus a re-run of Slice 31's smoke-test journey on the arm64 build.
- [ ] **Apple Developer ID code signing + notarization.** Needs an Apple Developer account + Developer ID cert. With signing in place, Gatekeeper accepts the build without right-click → Open.
- [ ] **In-app auto-update wired via `electron-updater`** against GitHub Releases. Needs a public release channel — published `.dmg` + `.dmg.blockmap` artifacts per release. Pre-Go-Public, updates are manual (see [Updates](#updates-beta)).
- [ ] **The `.app` launches on a fresh macOS machine** with no Node, pnpm, or Xcode tools installed. Needs a true clean-room Mac to verify. v3's Slice 31 verified the weaker form — launching from `/Applications/` on the developer's own machine, which still has dev tools — and that's all internal hardening requires.
- [ ] **At least one third-party machine has installed and used Mesh successfully.** "Stranger's Mac" interpretation. Distinct from the clean-room launch above — this also tests the install + onboarding experience on a user who isn't the developer.
- [ ] **Crash reporting configured (Sentry or equivalent).** Dropped from v3 scope since there are no users yet to surface reports from. Revisited at Go-Public when there are.

Once all Go-Public boxes are checked, tag `1.0.0` and publish via GitHub Releases. The version after that is `1.0.1` (patch), `1.1.0` (minor), or `2.0.0` (major) per semver.
