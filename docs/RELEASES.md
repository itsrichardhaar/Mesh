# Releases

Mesh's release channels — what's stable enough to use, what's in flight, and the rules for promoting builds between them.

This file replaces the "deployment log" pattern that makes sense for self-hosted apps. Mesh is desktop software, so the equivalent question is *which channel is a given build on?* — not *which environment was it deployed to?*

---

## Current Status

| Channel | Status | Latest version | Notes |
|---|---|---|---|
| `dev` | **Active** | git `HEAD` of `main` | Run via `pnpm dev`; no `.app` artifact |
| `beta` | **Active** ← we are here | `0.1.0` | Documentation-only foundation; no `.app` yet — first beta `.app` ships when slice 1 of the PRD is complete |
| `stable` | Not yet shipped | — | First stable release will be `1.0.0` once the [Production Checklist](./DEPLOYMENT.md#production-checklist-100) passes |

---

## Channel Definitions

### `dev`
Local development running directly from `main` via `pnpm dev`. Always at HEAD. No artifact, no semver version beyond the branch name.

**Audience:** the developer working on Mesh itself.

**Promotion rule:** continuous — every commit on `main` is on `dev` by definition.

### `beta`
Tagged pre-1.0 releases (`0.x.y`). Mesh is in beta from `0.1.0` through every minor and patch version until `1.0.0-rc.1`. Builds are unsigned `.app` artifacts installed manually (see [DEPLOYMENT.md](./DEPLOYMENT.md#building-from-source-beta)).

Breaking changes are permitted between beta releases — the SQLite schema, IPC contracts, the `ModelClient` interface, and the Analysis output schema may all change. Migrations handle data; consumers handle themselves.

**Audience:** the developer dogfooding Mesh + any early collaborators who explicitly opt into the beta.

**Promotion rule:** any tag matching `v0.*.*` is on the beta channel. Mesh ships beta releases as needed — there's no fixed cadence.

### `stable` (planned for `1.0.0`)
Production-ready signed and notarized `.dmg` releases distributed via GitHub Releases. `electron-updater` handles in-app updates.

Within `1.x`, semver guarantees apply:
- **Patch** (`1.0.0` → `1.0.1`): bug fixes only, no API or schema changes
- **Minor** (`1.0.0` → `1.1.0`): additive features, backward-compatible
- **Major** (`1.0.0` → `2.0.0`): breaking changes (rare)

**Audience:** any user who installs Mesh from a public download.

**Promotion rule:** all items in the [Production Checklist](./DEPLOYMENT.md#production-checklist-100) must pass before tagging `1.0.0`. Subsequent stable releases require their respective semver category's bar to be met (bug-only patches, additive minors, etc.).

---

## Beta Cycle Policy

Mesh follows the standard pre-1.0 cycle:

```
0.1.0 → 0.2.0 → 0.3.0 → … → 0.N.0     ← active feature work in beta
                                ↓
                         1.0.0-rc.1   ← release candidate(s) cycle until stable
                                ↓
                         1.0.0-rc.N
                                ↓
                             1.0.0    ← first stable release
                                ↓
              1.0.1 / 1.1.0 / 2.0.0   ← post-1.0 semver
```

Patch versions within beta (`0.1.1`, `0.1.2`, etc.) are reserved for fixes to a feature shipped in the corresponding minor. Most beta work is on the minor track.

The jump from `0.N.0` to `1.0.0-rc.1` happens **only** when every Production Checklist item is realistically within one or two PRs of passing. RC cycles are short — if RC drags past three iterations, fall back to a `0.(N+1).0` beta and re-plan.

---

## What Changes When Between Channels

| Concern | `dev` | `beta` | `stable` |
|---|---|---|---|
| SQLite schema | Free to change daily | Free to change per release with migrations | Frozen within a major version (additive only via migrations) |
| IPC contract | Free to change | Free to change per release | Frozen within a major version |
| `ModelClient` interface | Free to change | Free to change per release | Frozen within a major version |
| Analysis output schema | Free to change | Free to change per release | Frozen within a major version |
| Settings keys | Free to change | Renamed with migration | Renamed with migration + at least one release of dual-read |
| User-visible terminology (per `CONTEXT.md`) | Stable from day one | Stable from day one | Stable forever |

Reading the table: **user-facing language is stable from the start**; everything else is allowed to churn until `1.0.0`.

---

## Install Log

Where Mesh is installed and on what version.

_No installs to log yet — Mesh isn't producing a `.app` artifact at `0.1.0`. The table below will populate once installs begin._

| Machine | Channel | Version | Installed | Notes |
|---|---|---|---|---|

### Adding a machine

When you install Mesh somewhere new (additional personal machine, work machine, a collaborator's laptop), append a row:

```markdown
| machine-label | channel | version | YYYY-MM-DD | notes |
```
