# File Editor mode is read-only; edits flow through Claude

The Workspace's File Editor mode embeds Monaco with `readOnly: true` — no save, no edit, no `Cmd+S`. Mesh is a dashboard, not a code editor; editing in v1 is done by asking Claude in a Pty Tab, which writes to disk and chokidar's file-tree watcher picks up the change. This avoids the complexity of save semantics, dirty-file tracking, conflict reconciliation with external edits, undo/redo, and line-ending preservation — none of which are core to Mesh's value as an AI workspace OS.

## Considered Options

- **Fully editable Monaco** — rejected: meaningful complexity tax with no differentiated value; users have VS Code/Cursor for editing
- **Read-only by default with an explicit "Edit" toggle** — rejected: stateful UI mode invisible from the file's appearance; users would type into what they thought was an editable buffer and lose keystrokes

## Consequences

- The File Editor mode is for *context-checking* ("let me glance at this before asking Claude to refactor it"), not editing sessions
- A future contributor who sees Monaco embedded should not assume editing is missing-by-mistake — read-only is the deliberate stance
- v2 may add editing as an opt-in capability; the default and the philosophical stance remain
