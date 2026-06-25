import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

/**
 * Derived metadata for a Project — humanized display name plus the
 * auto-detected stack subtitle (e.g., `Next.js`, `Rust`).
 *
 * `autoSubtitle` is `null` when none of the priority canonical files
 * exist and no top-level extension dominates.
 */
export interface DetectedMetadata {
  autoName: string
  autoSubtitle: string | null
}

/**
 * Inspect a Project's Source Path and return its humanized name and
 * an auto-detected subtitle. The subtitle priority list mirrors the
 * PRD's canonical-file order: package.json (with framework refinement)
 * → Cargo.toml → go.mod → pyproject.toml/requirements.txt → Package.swift
 * → dominant top-level extension.
 *
 * Returns `{ autoSubtitle: null }` when the Source Path doesn't exist
 * or is unreadable — Source-Missing Projects still get a humanized
 * name from their cached encoded path.
 */
export async function detect(sourcePath: string): Promise<DetectedMetadata> {
  const autoName = humanize(basename(sourcePath))
  const autoSubtitle = await detectSubtitle(sourcePath)
  return { autoName, autoSubtitle }
}

async function detectSubtitle(sourcePath: string): Promise<string | null> {
  const fromPackageJson = await tryPackageJson(sourcePath)
  if (fromPackageJson) return fromPackageJson

  if (await exists(join(sourcePath, 'Cargo.toml'))) return 'Rust'
  if (await exists(join(sourcePath, 'go.mod'))) return 'Go'
  if (
    (await exists(join(sourcePath, 'pyproject.toml'))) ||
    (await exists(join(sourcePath, 'requirements.txt')))
  ) {
    return 'Python'
  }
  if (await exists(join(sourcePath, 'Package.swift'))) return 'Swift'

  return await dominantExtension(sourcePath)
}

async function tryPackageJson(sourcePath: string): Promise<string | null> {
  const pkgPath = join(sourcePath, 'package.json')
  let raw: string
  try {
    raw = await readFile(pkgPath, 'utf-8')
  } catch {
    return null
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return 'Node.js'
  }

  const deps = mergeDeps(pkg)
  const hasTsConfig = await exists(join(sourcePath, 'tsconfig.json'))
  const hasTypeScript = hasTsConfig || 'typescript' in deps

  if ('next' in deps) return 'Next.js'
  if ('react' in deps) return hasTypeScript ? 'React · TypeScript' : 'React'
  if (hasTypeScript) return 'TypeScript'
  return 'Node.js'
}

function mergeDeps(pkg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const entry = pkg[key]
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      Object.assign(out, entry)
    }
  }
  return out
}

const FRIENDLY_EXT: Record<string, string> = {
  md: 'Markdown',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  yaml: 'YAML',
  yml: 'YAML',
  sh: 'Shell',
  txt: 'Text'
}

async function dominantExtension(sourcePath: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(sourcePath)
  } catch {
    return null
  }

  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = join(sourcePath, entry)
    let s
    try {
      s = await stat(full)
    } catch {
      continue
    }
    if (!s.isFile()) continue
    const dot = entry.lastIndexOf('.')
    if (dot <= 0 || dot === entry.length - 1) continue
    const ext = entry.slice(dot + 1).toLowerCase()
    counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }

  let winner: string | null = null
  let winnerCount = 0
  for (const [ext, count] of counts) {
    if (count > winnerCount) {
      winner = ext
      winnerCount = count
    }
  }
  if (!winner) return null
  return FRIENDLY_EXT[winner] ?? winner.toUpperCase()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Replace dashes and underscores with spaces so directory names like
 * `AI-OS-Dashboard` or `my_great_repo` render naturally in the sidebar.
 * Leaves already-spaced names untouched.
 */
function humanize(name: string): string {
  return name.replace(/[-_]+/g, ' ').trim()
}
