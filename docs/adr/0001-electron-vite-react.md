# Electron + Vite + React for the desktop runtime

Mesh's central feature is an embedded live Claude Code terminal (xterm.js + node-pty). We chose Electron over Tauri because `node-pty` in Electron is battle-tested — VS Code uses this exact combination — while Tauri's Rust-side pty story is immature, and the embedded terminal is the load-bearing affordance of the Workspace Screen. We accept Electron's ~150MB install / ~200MB idle-RAM cost as the price of a working terminal.

## Considered Options

- **Tauri + React** — rejected: smaller binary and lower RAM, but the pty story isn't there yet for v1
- **Next.js as a local webapp** — rejected: pty over websocket adds a second process, and it loses native-app affordances (dock presence, menu bar, Keychain)
- **SwiftUI** — rejected: macOS-only forever, and forfeits the React/Monaco/xterm ecosystem
