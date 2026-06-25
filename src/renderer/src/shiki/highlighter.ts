/**
 * Lazy-loaded shiki singleton. The dynamic `import('shiki')` defers
 * the highlighter bundle (it's ~hundreds of kB of grammar / theme
 * JSON) until the first transcript actually opens. The singleton
 * `promise` is cached so the second Session in the same window
 * resolves immediately.
 */

type Theme = 'github-light' | 'github-dark'

const THEMES: readonly Theme[] = ['github-light', 'github-dark'] as const

/**
 * Languages we preload. Each name must be importable as a shiki bundle
 * name — keep this list pragmatic; unknown languages fall back to a
 * plain-text render at call sites.
 */
const LANGS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'bash',
  'shell',
  'sh',
  'css',
  'scss',
  'html',
  'md',
  'sql',
  'python',
  'rust',
  'go',
  'yaml',
  'toml',
  'diff'
] as const

type Lang = (typeof LANGS)[number]

type Highlighter = Awaited<ReturnType<typeof import('shiki').createHighlighter>>

let highlighterPromise: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise) return highlighterPromise
  const next = import('shiki').then((shiki) =>
    shiki.createHighlighter({
      themes: [...THEMES],
      langs: [...LANGS]
    })
  )
  highlighterPromise = next
  return next
}

export function isSupportedLang(lang: string | undefined): lang is Lang {
  if (!lang) return false
  return (LANGS as readonly string[]).includes(lang)
}

export function themeFor(effective: 'light' | 'dark'): Theme {
  return effective === 'dark' ? 'github-dark' : 'github-light'
}
