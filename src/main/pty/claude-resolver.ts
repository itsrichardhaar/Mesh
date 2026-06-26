import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Locate the `claude` binary on the user's `PATH`. Returns the
 * absolute path on success, or `null` when nothing was found —
 * the Resume code path renders an install-instructions banner
 * instead of spawning anything in that case.
 *
 * We invoke `command -v` rather than `which` because it's a POSIX
 * shell builtin (no external binary dependency) and gives a stable
 * exit code regardless of the user's shell flavor. The PATH that
 * GUI Electron apps inherit on macOS is the "launchd" PATH which
 * does NOT include shell-rc additions (~/.zshrc etc.) — so we run
 * the user's login shell explicitly so the resolver matches what
 * the user gets in their terminal.
 */
export async function resolveClaudeBinary(): Promise<string | null> {
  const shell = process.env['SHELL'] ?? '/bin/zsh'
  try {
    const { stdout } = await execAsync(
      `${shell} -ilc 'command -v claude'`,
      { timeout: 5000 }
    )
    const trimmed = stdout.trim()
    if (trimmed.length === 0) return null
    // `command -v` may print an alias or function definition; only
    // accept absolute paths to a real binary.
    if (!trimmed.startsWith('/')) return null
    return trimmed
  } catch {
    return null
  }
}
