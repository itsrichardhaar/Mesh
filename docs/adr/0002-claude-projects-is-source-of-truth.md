# Projects are auto-discovered from `~/.claude/projects/`; Mesh keeps no Project registry

Every directory the user has opened Claude Code in already produces a folder at `~/.claude/projects/<encoded-path>/`. Mesh reads this directory as the canonical Project list and stores only *augmentation* keyed by encoded path — Analyses, accent color, Hidden flag, user-set name overrides. There is no Mesh-side `projects` table that gets inserted into when a Project is "added"; Projects appear in the sidebar the moment Claude Code creates their folder.

## Considered Options

- **User-curated list** — rejected: creates parallel bookkeeping that goes stale; the dashboard should reflect reality, not require maintenance
- **Hybrid (auto-discover with two buckets: Active vs Archived)** — rejected for v1: a UI decision masquerading as a data decision; ship the simple model first and split later only if needed

## Consequences

- Hidden and Source-Missing are augmentation states, not registry states — both are recoverable without re-registering
- Mesh has no "Add Project" UI in v1 and shouldn't need one
- The first time the user opens a new directory in Claude Code, it appears in Mesh on next sidebar render — no manual sync step
