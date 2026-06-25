/**
 * Lazy-loaded Monaco. Dynamic `import('monaco-editor')` defers the
 * ~4 MB editor bundle until the first time the user enters File
 * Editor mode. The promise is cached so subsequent file opens
 * resolve immediately.
 *
 * No language workers are configured — Monaco's basic features
 * (monarch tokenizers, find widget, line numbers) work without them,
 * and v1's editor is strictly read-only per ADR-0004 so we don't
 * need TypeScript IntelliSense or other worker-backed services.
 * Stubbing `MonacoEnvironment.getWorker` keeps the editor from
 * trying to spawn worker URLs that don't exist.
 */

type Monaco = typeof import('monaco-editor')

let monacoPromise: Promise<Monaco> | null = null
let themesInstalled = false

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    MonacoEnvironment?: {
      getWorker?: (...args: unknown[]) => Worker
    }
  }
}

export function getMonaco(): Promise<Monaco> {
  if (monacoPromise) return monacoPromise
  // Stub the worker factory before Monaco loads so language services
  // gracefully degrade instead of throwing on missing worker URLs.
  window.MonacoEnvironment = {
    getWorker: () => {
      const blob = new Blob([''], { type: 'application/javascript' })
      return new Worker(URL.createObjectURL(blob))
    }
  }
  monacoPromise = import('monaco-editor').then((m) => {
    installMeshThemes(m)
    return m
  })
  return monacoPromise
}

/**
 * Resolve a CSS variable (`--bg-canvas`) against the document root
 * and return its computed value, stripped of whitespace. Monaco
 * needs hex strings, so callers should only pass tokens that store
 * hex values.
 */
function tokenValue(varName: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw
}

/**
 * Register the `mesh-light` and `mesh-dark` themes once. Theme color
 * keys map onto the design tokens defined in `styles.css` so editor
 * surfaces stay in lock-step with the rest of the app.
 */
function installMeshThemes(m: Monaco): void {
  if (themesInstalled) return
  themesInstalled = true

  // We probe the DOM in both palettes to capture both sets of token
  // values without forcing a runtime theme swap. To do that we
  // temporarily flip `data-theme`, read, and flip back. The visible
  // app doesn't repaint within a single synchronous burst.
  const html = document.documentElement
  const prior = html.getAttribute('data-theme')

  html.setAttribute('data-theme', 'light')
  const light = readMeshThemeColors()

  html.setAttribute('data-theme', 'dark')
  const dark = readMeshThemeColors()

  if (prior === null) html.removeAttribute('data-theme')
  else html.setAttribute('data-theme', prior)

  m.editor.defineTheme('mesh-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: light
  })
  m.editor.defineTheme('mesh-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: dark
  })
}

function readMeshThemeColors(): Record<string, string> {
  const canvas = tokenValue('--bg-canvas')
  const surface = tokenValue('--bg-surface')
  const elevated = tokenValue('--bg-elevated')
  const border = tokenValue('--border-subtle')
  const primary = tokenValue('--text-primary')
  const secondary = tokenValue('--text-secondary')
  const muted = tokenValue('--text-muted')
  const accent = tokenValue('--accent')
  return {
    'editor.background': canvas,
    'editor.foreground': primary,
    'editorLineNumber.foreground': muted,
    'editorLineNumber.activeForeground': secondary,
    'editorCursor.foreground': accent,
    'editor.selectionBackground': elevated,
    'editor.inactiveSelectionBackground': surface,
    'editor.lineHighlightBackground': surface,
    'editor.lineHighlightBorder': border,
    'editorIndentGuide.background1': border,
    'editorIndentGuide.activeBackground1': muted,
    'editorWidget.background': surface,
    'editorWidget.border': border,
    'editorSuggestWidget.background': surface,
    'editorSuggestWidget.border': border,
    'editorSuggestWidget.foreground': primary,
    'editorGutter.background': canvas,
    'scrollbarSlider.background': `${border}80`,
    'scrollbarSlider.hoverBackground': `${muted}80`,
    'scrollbarSlider.activeBackground': muted,
    'minimap.background': canvas,
    focusBorder: accent
  }
}

const EXT_TO_LANG: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  dockerfile: 'dockerfile'
}

/** Map a filename to a Monaco language id. Plain text fallback. */
export function languageForFilename(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  const lower = base.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'shell'
  const dot = base.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

export function meshThemeFor(effective: 'light' | 'dark'): 'mesh-light' | 'mesh-dark' {
  return effective === 'dark' ? 'mesh-dark' : 'mesh-light'
}
