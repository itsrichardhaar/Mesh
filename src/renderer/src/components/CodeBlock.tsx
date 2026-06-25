import { useEffect, useState } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { getHighlighter, isSupportedLang, themeFor } from '../shiki/highlighter'

interface Props {
  code: string
  /** As written in the markdown fence (e.g. `ts`, `bash`, or undefined). */
  lang: string | undefined
}

/**
 * Renders a fenced code block. Asks the lazy-loaded shiki singleton
 * for highlighted HTML once it resolves; until then (and for fences
 * whose language isn't in our shiki bundle list) renders a plain
 * `<pre><code>` so the reader still sees the content while highlighter
 * grammars load. Theme follows `useTheme().effective` so the palette
 * stays in lock-step with the rest of the app.
 */
export function CodeBlock({ code, lang }: Props): JSX.Element {
  const { effective } = useTheme()
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupportedLang(lang)) {
      setHtml(null)
      return
    }
    let cancelled = false
    void getHighlighter().then((hl) => {
      if (cancelled) return
      try {
        const out = hl.codeToHtml(code, {
          lang,
          theme: themeFor(effective)
        })
        setHtml(out)
      } catch {
        // Unknown language at runtime → fall back to plain rendering.
        setHtml(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [code, lang, effective])

  if (html) {
    return (
      <div
        className="code-block code-block-shiki"
        // eslint-disable-next-line react/no-danger -- HTML comes from shiki, no user input
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className="code-block code-block-plain">
      <code>{code}</code>
    </pre>
  )
}
