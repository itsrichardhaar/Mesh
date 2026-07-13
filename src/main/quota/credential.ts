import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

/**
 * Reading the Claude Code OAuth token so Mesh can fetch subscription
 * Quota (ADR-0011). The token is Claude Code's *own* credential, not
 * one Mesh stores — so this is NOT `safeStorage` (which only round-trips
 * secrets Mesh itself encrypted). Two real sources, matching
 * `token-usage-analytics`:
 *
 *  - Linux / older installs: the plaintext `~/.claude/.credentials.json`.
 *  - macOS: Claude Code's generic-password Keychain entry
 *    (`Claude Code-credentials`), read via the `security` CLI. The first
 *    read may prompt the user for Keychain access — that prompt is the
 *    consent gate (ADR-0011).
 *
 * The token is returned to the caller for one use (the `Authorization`
 * header) and is never persisted, logged, or handed to the renderer.
 */

const CREDENTIAL_SERVICE = 'Claude Code-credentials'

/** UA version only needs to look like the CLI; the real version is preferred. */
export const FALLBACK_CLAUDE_VERSION = '2.1.0'

function tokenFromBlob(blob: string): string | null {
  try {
    const parsed = JSON.parse(blob) as { claudeAiOauth?: { accessToken?: unknown } }
    const token = parsed?.claudeAiOauth?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch {
    return null
  }
}

export function readOauthToken(): string | null {
  // Plaintext credentials file (Linux / older installs).
  try {
    const file = join(homedir(), '.claude', '.credentials.json')
    const token = tokenFromBlob(readFileSync(file, 'utf8'))
    if (token) return token
  } catch {
    // Not present — fall through to the platform keychain.
  }

  // macOS Keychain via the `security` CLI.
  if (process.platform === 'darwin') {
    try {
      const blob = execFileSync(
        'security',
        ['find-generic-password', '-s', CREDENTIAL_SERVICE, '-a', userInfo().username, '-w'],
        { encoding: 'utf8', timeout: 10_000 }
      )
      return tokenFromBlob(blob)
    } catch {
      return null
    }
  }

  return null
}

/**
 * Best-effort Claude Code version string for the required
 * `User-Agent: claude-code/<version>` header. Given the resolved
 * `claude` binary path (or `null`), runs `claude --version` and extracts
 * the first version-looking token; falls back to a constant so the UA
 * always looks like the CLI.
 */
export function claudeCodeVersion(claudeBin: string | null): string {
  if (!claudeBin) return FALLBACK_CLAUDE_VERSION
  try {
    const out = execFileSync(claudeBin, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    for (const token of out.split(/\s+/)) {
      if (/^\d/.test(token) && token.includes('.')) return token
    }
  } catch {
    // Fall through to the constant.
  }
  return FALLBACK_CLAUDE_VERSION
}
