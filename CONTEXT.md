# Mesh

Mesh is the AI workspace OS for managing Claude Code projects — a desktop app that lists every directory you've opened Claude Code in, lets you trigger LLM analyses of recent activity, browse past sessions, and resume them with a live terminal.

## Language

### Identity

**Mesh**:
The desktop application itself; an "AI workspace OS" for managing Claude Code projects.

**Project**:
A directory you've opened Claude Code in. Auto-discovered from `~/.claude/projects/`; Mesh never registers Projects independently of Claude Code's own data.
_Avoid_: Workspace, repo, folder

**Session**:
A single Claude Code conversation, persisted as one `<uuid>.jsonl` file in a Project's `~/.claude/projects/<encoded-path>/` folder.
_Avoid_: Chat, conversation, thread

**Sidechain**:
A sub-conversation within a Session, created by Claude Code's Agent tool. Rendered as an inline `↳ sub-agent (N messages)` indicator within the parent Session's transcript — not enumerated as its own Session.

**Encoded Path**:
A Project's source path with `/` replaced by `-` — Claude Code's own naming scheme for project folders (e.g., `-Users-richardhaar-Desktop-Mesh`). Used as a Project's primary key.

**Source Path**:
A Project's decoded absolute path on disk (e.g., `/Users/richardhaar/Desktop/Mesh`).

### Screens

**Home Screen**:
Mesh's landing view: Project sidebar on the left, selected Project's Analysis on the right. Single-click selects; double-click opens the Workspace Screen.

**Workspace Screen**:
The per-Project view: file tree on the left, Sessions list in the middle, transcript or file content on the right.

**Mode Tab**:
The `Sessions` / `File Editor` toggle at the top of the Workspace Screen's right area, switching what fills that area.

### Analysis

**Analyze** (verb):
The user-initiated action that calls the active Provider's Model to produce an Analysis for a Project. Mesh never analyzes automatically.

**Analysis** (noun):
The LLM-produced three-section update for a Project — Summary of Recent Sessions, Next Steps, and Suggested Improvements. Stored with history kept; the latest is shown on the Home Screen.
_Avoid_: Summary (when referring to the whole Analysis), report, briefing

**Stats Row**:
The three deterministic counts displayed above an Analysis: Sessions, Files Touched, Last Activity. Computed from Project state without the LLM.

**Activity** / **Last Activity**:
The timestamp of the newest event in any of a Project's Sessions. Drives both sidebar sort order and the Last Activity stat.

### Sessions and terminals

**Pty Tab**:
A tab in the Workspace's right pane backed by a live `claude --resume <session-id>` pseudo-terminal. Distinct from Session — Sessions are recorded JSONL files; Pty Tabs are live processes spawned from one.
_Avoid_: Terminal (ambiguous between transcript view and live pty)

**Resume** (verb):
The action that opens a Pty Tab for a recorded Session. Default click behavior on a Session row is read-only transcript view; Resume is an explicit click in the transcript pane.

### Providers and models

**Provider**:
An LLM service backing analyses — one of `Claude`, `OpenAI`, or `Local`. v1 ships with only Claude functional; OpenAI and Local pills are present but disabled.

**Active Provider**:
The currently selected Provider whose Model is used for every Analyze call. Exactly one Provider is Active at a time.

**Model**:
A specific LLM within a Provider (e.g., `claude-haiku-4-5`, `gpt-4o-mini`, `llama3.1:8b`).

### Project state

**Hidden**:
A Project the user has flagged to not appear in the Home Screen sidebar. Recoverable via the Project's settings.

**Source-Missing**:
A Project whose Source Path no longer exists on disk (folder deleted/moved). Rendered greyed-out in the sidebar; Workspace actions (file tree, Resume) are disabled. Distinct from Hidden.

## Relationships

- A **Project** contains 0..N **Sessions** (one `.jsonl` per Session)
- A **Session** may contain 0..N **Sidechains** (rendered inline, not enumerated separately)
- A **Project** has 0..1 latest **Analysis**; older Analyses are kept as history
- An **Analysis** is produced by exactly one **Model** of one **Provider**
- A **Pty Tab** corresponds to exactly one **Session** being Resumed
- Multiple **Pty Tabs** can exist per Project; all die when Mesh's process exits
- A **Project**'s **Activity** is derived from its Sessions' newest event timestamp

## Example dialogue

> **Dev:** "When the user clicks **Analyze** on a **Project**, do we re-read every **Session** in `~/.claude/projects/<encoded-path>/`?"
>
> **Domain expert:** "No — we send `min(5 most-recent Sessions, Sessions in last 14 days)` to the **Active Provider**'s **Model**, with each Session compressed to its `away_summary` if present."

> **Dev:** "If the user **Resume**s a **Session** and then quits Mesh, what happens to the live `claude` process?"
>
> **Domain expert:** "All **Pty Tabs** are children of Mesh's main process — they die when Mesh quits. If any Pty Tab is mid-execution at quit time, Mesh confirms before killing."

> **Dev:** "What's the difference between a **Hidden** **Project** and a **Source-Missing** one?"
>
> **Domain expert:** "Hidden is the user's choice — they decided not to see it. Source-Missing is reality — the folder is gone from disk. Both are recoverable, but the recovery actions are different."

## Flagged ambiguities

- **"Summary"** — used ambiguously between *the whole Analysis* and *its first sub-section*. Resolved: **Analysis** for the whole artifact; the first sub-section is *Summary of Recent Sessions* (with the qualifier), never bare "Summary".
- **"Terminal"** — used ambiguously between *the transcript view* (read-only rendered JSONL) and *the live pty* (a running `claude --resume`). Resolved: *transcript* for the rendered JSONL view; **Pty Tab** for the live process.
- **"Dashboard"** — used in early discussion. Resolved: **Mesh** for the product, **Home Screen** for the landing view.
- **"Suggestion" / "chip"** — discussed in early Analysis design (a fourth panel of clickable actions); deferred to v2. Not part of v1 vocabulary.
