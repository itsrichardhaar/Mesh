/**
 * Material Icon Theme integration for the file tree (Slice 26).
 *
 * Bundles the SVG assets from the `material-icon-theme` npm package and
 * resolves filenames / folder names to their VS Code-style icons via the
 * package's prebuilt manifest. All SVGs eager-loaded at build time so
 * lookups are synchronous at render time.
 */

import manifest from 'material-icon-theme/dist/material-icons.json'

interface MaterialManifest {
  file: string
  folder: string
  folderExpanded: string
  fileNames: Record<string, string>
  fileExtensions: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
}

const M = manifest as unknown as MaterialManifest

// Vite eager-globs every SVG in the package's `icons/` directory into a
// map of `{ <path>: <runtime URL> }`. The path-up math reaches the
// workspace `node_modules/` from this file at `src/renderer/src/material-icons/loader.ts`.
const svgUrls = import.meta.glob(
  '../../../../node_modules/material-icon-theme/icons/*.svg',
  { query: '?url', import: 'default', eager: true }
) as Record<string, string>

const urlByName: Record<string, string> = {}
for (const [path, url] of Object.entries(svgUrls)) {
  const match = path.match(/\/([^/]+)\.svg$/)
  if (match) urlByName[match[1]!] = url
}

const DEFAULT_FILE = M.file ?? 'file'
const DEFAULT_FOLDER = M.folder ?? 'folder'
const DEFAULT_FOLDER_OPEN = M.folderExpanded ?? 'folder-open'

/**
 * Resolve a filename to a Material Icon Theme SVG URL. Returns `null` if
 * no icon is bundled — caller can choose to render a neutral fallback.
 */
export function getFileIconUrl(filename: string): string | null {
  const lower = filename.toLowerCase()

  // 1. Exact filename (e.g., `package.json`, `Dockerfile`, `.gitignore`)
  const byName = M.fileNames?.[lower]
  if (byName) {
    const url = urlByName[byName]
    if (url) return url
  }

  // 2. Extension. Walk segments right-to-left so multi-dot files
  // (e.g., `vite.config.ts`) can match either `config.ts` or `ts`.
  const parts = lower.split('.')
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    const byExt = M.fileExtensions?.[ext]
    if (byExt) {
      const url = urlByName[byExt]
      if (url) return url
    }
  }

  return urlByName[DEFAULT_FILE] ?? null
}

/**
 * Resolve a folder name + open/closed state to a Material Icon Theme SVG
 * URL. Returns `null` if no icon is bundled.
 */
export function getFolderIconUrl(name: string, isOpen: boolean): string | null {
  const lower = name.toLowerCase()
  const namedKey = isOpen ? M.folderNamesExpanded?.[lower] : M.folderNames?.[lower]
  if (namedKey) {
    const url = urlByName[namedKey]
    if (url) return url
  }

  const fallback = isOpen ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER
  return urlByName[fallback] ?? null
}
