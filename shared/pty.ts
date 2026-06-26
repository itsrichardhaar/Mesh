// Wire shapes for the live `claude --resume` pty layer (Slice 16).
// Renderer-importable — must stay Electron-free.

export interface PtyCreateRequest {
  /** Project the pty's cwd derives from. */
  encodedPath: string
  /** Session id passed to `claude --resume <id>`. */
  sessionId: string
  cols: number
  rows: number
}

/** Reasons a `pty.create` call may refuse to spawn. */
export type PtyCreateErrorCode = 'claude-not-found' | 'project-not-found' | 'source-missing'

/**
 * Discriminated response shape so the renderer can switch on the
 * outcome without parsing free-form error strings. Same envelope
 * convention as `files.read` from Slice 18 — Electron's IPC layer
 * strips custom properties off rejected errors, so failure metadata
 * lives on the success payload.
 */
export type PtyCreateResponse =
  | { ok: true; ptyId: string }
  | { ok: false; code: PtyCreateErrorCode; message: string }

/** Streamed-event payload. The renderer routes by `ptyId`. */
export interface PtyDataEvent {
  ptyId: string
  data: string
}

export interface PtyExitEvent {
  ptyId: string
  exitCode: number
}
