# Usage Events are a rebuildable cache in SQLite — a category distinct from authored augmentation

Mesh v7 introduces the **Usage** domain: token consumption derived from Session JSONL. Its atomic unit, the **Usage Event**, is a *pure function of the filesystem* — every field comes from an assistant turn's `usage` object and the line around it. Persisting Usage Events in SQLite appears to collide with ADR-0002, which states the database holds "only *augmentation* … never a second source of truth that can drift."

It does not collide, and this ADR records why. The database now holds **two clearly-separated categories**:

1. **Authored augmentation** — Analyses, accent color, Hidden flag, name overrides, notifications, mute state. Data that exists *nowhere else*, can drift from nothing (there is no upstream), and is kept deliberately minimal (ADR-0002).
2. **Derived cache** — `usage_events`. A pure function of Session JSONL that *cannot* drift, because its contract is: **drop the table, re-sweep the JSONL, and you get the byte-identical result.** The filesystem remains the source of truth; this is an index over it, exactly as `token-usage-analytics` records in its own ADR-0001.

Performance forces persistence rather than on-the-fly computation. The Home Screen aggregates *every* assistant turn across *every* Project; re-parsing all JSONL on each render is not interactive at any real history size. The cache is populated by an async startup sweep, kept fresh by the existing chokidar session-watcher (tail-ingesting appended lines via a tracked byte offset), and can be wiped and rebuilt from a manual **Rebuild** control in Settings.

## Considered Options

- **Compute on-the-fly, no persistence** — rejected: keeps the DB purely authored (ADR-0002 untouched), but the Home Screen re-parses all history on every load. No realistic path to an interactive heatmap/trend/breakdown past a few hundred Sessions. The feature fails at its headline job.
- **In-memory index only** (parse once per launch into RAM) — rejected: pays the full re-parse cost on *every* launch, grows memory unbounded with history, and persists nothing across runs. Rebuilding the same index from the same immutable files thousands of times is work done once and cached.
- **Persist as authored data** (treat Usage Events like Analyses) — rejected: this is the actual ADR-0002 violation. Authored rows carry no rebuild contract, so a future reader could mistake them for a source of truth and let them drift. The whole point is that the cache is *disposable*.
- **Rebuildable cache with an explicit documented boundary** — chosen: the only option that is both interactive and drift-proof.

## Consequences

- **New migration `0006_usage_events.sql`.** The upgrade-cycle test harness walks it from v1 automatically — the migration-chain safety net built in earlier releases covers it for free.
- **The database's role is clarified, not reversed.** "Augmentation only" becomes "authored augmentation + rebuildable cache." ADR-0002's principle — *the filesystem under `~/.claude/projects/` is the source of truth* — is unchanged and, if anything, reinforced: the cache exists precisely so nothing needs to be authored.
- **Every row carries provenance** — `event_id` (the assistant message uuid), `source_file`, `source_line` — so any row traces to its JSONL origin and re-ingest is idempotent by `event_id`.
- **Freshness is async-startup + watcher-tail + manual Rebuild.** The startup sweep runs after first paint (Home renders immediately with an indexing shimmer); the watcher re-ingests only appended lines; Rebuild wipes and re-sweeps from scratch.
- **The invariant a future reader must preserve:** dropping `usage_events` and rebuilding must be semantically a no-op. Nothing may ever be written to the cache that isn't derivable from JSONL. The moment something authored lands there, this ADR is violated.
