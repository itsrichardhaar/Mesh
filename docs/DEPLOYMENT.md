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

## Production Checklist (1.0.0)

These are the gates `1.0.0` must clear. Beta releases may fail any of them; that's the point of being in beta.

- [ ] All nine v1 vertical slices (per [`PRD.md`](./PRD.md#further-notes)) demonstrate end-to-end
- [ ] All nine deep main-process modules (`ProjectEnumerator`, `MetadataDetector`, `SessionReader`, `StatsComputer`, `AnalysisOrchestrator`, `ModelClient`/`ClaudeClient`, `SecretsVault`, `PtyManager`, `Database` + migration runner) have unit-test coverage with fixture-driven assertions
- [ ] `TranscriptRenderer` has snapshot test coverage with fixture JSONLs (including Sidechain and oversized-tool-result cases)
- [ ] `electron-builder` produces a clean `.dmg` for macOS arm64 and x64
- [ ] Apple Developer ID code signing + notarization configured; Gatekeeper accepts the build without right-click → Open
- [ ] The `.app` launches on a fresh macOS machine with no Node, pnpm, or Xcode tools installed
- [ ] In-app auto-update wired via `electron-updater` against GitHub Releases
- [ ] Mesh dogfoods itself: analyzing `~/.claude/projects/-Users-richardhaar-Desktop-Mesh/` returns a sensible three-section Analysis
- [ ] Schema migration verified through at least one upgrade cycle (e.g., `0.4.0` → `0.5.0` → `1.0.0-rc.1`) with no data loss
- [ ] Crash reporting configured (Sentry or equivalent) so any reports surface during the beta tail
- [ ] `README.md`, `CONTEXT.md`, `PRD.md`, `CHANGELOG.md`, and `DEPLOYMENT.md` are accurate to the shipped state — no stale references to deferred features as if they exist
- [ ] At least one **third-party machine** (not the developer's own laptop) has installed and used Mesh successfully

Once all boxes are checked, tag `1.0.0` and publish via GitHub Releases. The version after that is `1.0.1` (patch), `1.1.0` (minor), or `2.0.0` (major) per semver.
