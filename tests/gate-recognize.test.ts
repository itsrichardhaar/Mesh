import { describe, it, expect } from 'vitest'
import { recognizeGateRunEncodedPath, recognizeWorktreeRun } from '@main/gate/recognize'

describe('recognizeWorktreeRun', () => {
  it('recognizes a no-mistakes gate worktree under the home layout', () => {
    const r = recognizeWorktreeRun(
      '/Users/richardhaar/.no-mistakes/worktrees/018d9e76994c/01M320PARHRXZETXMJX80Z382A'
    )
    expect(r).toEqual({
      kind: 'gate',
      repoId: '018d9e76994c',
      runId: '01M320PARHRXZETXMJX80Z382A'
    })
  })

  it('recognizes a gate worktree with a trailing slash', () => {
    const r = recognizeWorktreeRun(
      '/Users/x/.no-mistakes/worktrees/f9184ba0b6db/01M2TV2SCPHEPT96DGDETQE6VH/'
    )
    expect(r?.repoId).toBe('f9184ba0b6db')
    expect(r?.runId).toBe('01M2TV2SCPHEPT96DGDETQE6VH')
  })

  it('recognizes a store_in_repo layout (prefix not anchored to $HOME)', () => {
    const r = recognizeWorktreeRun(
      '/Users/x/Documents/moves/.no-mistakes/worktrees/018d9e76994c/01M320PARHRXZETXMJX80Z382A'
    )
    expect(r?.kind).toBe('gate')
  })

  it('returns null for an ordinary Project path', () => {
    expect(recognizeWorktreeRun('/Users/richardhaar/Documents/moves')).toBeNull()
    expect(recognizeWorktreeRun('/Users/richardhaar/Desktop/Mesh')).toBeNull()
  })

  it('returns null for the no-mistakes bare-repos dir (not a worktree)', () => {
    expect(
      recognizeWorktreeRun('/Users/x/.no-mistakes/repos/018d9e76994c-git')
    ).toBeNull()
  })

  it('returns null when the segment appears mid-path (a file inside the worktree)', () => {
    expect(
      recognizeWorktreeRun(
        '/Users/x/.no-mistakes/worktrees/018d9e76994c/01M320PARHRXZETXMJX80Z382A/src/index.ts'
      )
    ).toBeNull()
  })

  it('returns null for a non-hex repoId', () => {
    expect(
      recognizeWorktreeRun('/Users/x/.no-mistakes/worktrees/NOTHEXXX/01M320PARHRXZETXMJX80Z382A')
    ).toBeNull()
  })

  it('returns null for a non-ULID runId (wrong length)', () => {
    expect(
      recognizeWorktreeRun('/Users/x/.no-mistakes/worktrees/018d9e76994c/short')
    ).toBeNull()
  })

  it('returns null for a runId containing ULID-excluded letters (I/L/O/U)', () => {
    // 26 chars but includes 'I' and 'O', which Crockford base32 excludes.
    expect(
      recognizeWorktreeRun('/Users/x/.no-mistakes/worktrees/018d9e76994c/01MIOU5ZN39S8EF7YEKPAAN2KC')
    ).toBeNull()
  })
})

describe('recognizeGateRunEncodedPath', () => {
  it('recognizes a Gate Run from its Encoded Path (both / and . flattened to -)', () => {
    // The real Claude Code encoding of
    // /Users/richardhaar/.no-mistakes/worktrees/f9184ba0b6db/01M089YQEMNS34T9ZAZBZWB6S8
    const r = recognizeGateRunEncodedPath(
      '-Users-richardhaar--no-mistakes-worktrees-f9184ba0b6db-01M089YQEMNS34T9ZAZBZWB6S8'
    )
    expect(r).toEqual({
      kind: 'gate',
      repoId: 'f9184ba0b6db',
      runId: '01M089YQEMNS34T9ZAZBZWB6S8'
    })
  })

  it('splits repoId (lowercase hex) from runId (uppercase ULID) unambiguously', () => {
    const r = recognizeGateRunEncodedPath(
      '-Users-x-Documents-moves--no-mistakes-worktrees-018d9e76994c-01M320PARHRXZETXMJX80Z382A'
    )
    expect(r?.repoId).toBe('018d9e76994c')
    expect(r?.runId).toBe('01M320PARHRXZETXMJX80Z382A')
  })

  it('returns null for an ordinary Project Encoded Path', () => {
    expect(recognizeGateRunEncodedPath('-Users-richardhaar-Desktop-Mesh')).toBeNull()
    expect(recognizeGateRunEncodedPath('-Users-richardhaar-Documents-moves')).toBeNull()
  })

  it('returns null when the run segment is not the final one (a nested path)', () => {
    expect(
      recognizeGateRunEncodedPath(
        '-Users-x--no-mistakes-worktrees-018d9e76994c-01M320PARHRXZETXMJX80Z382A-src'
      )
    ).toBeNull()
  })
})
