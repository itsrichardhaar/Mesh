import { useEffect, useRef, useState } from 'react'
import type * as monaco from 'monaco-editor'
import type { FileReadResponse } from '@shared/files'
import { useTheme } from '../theme/ThemeProvider'
import { getMonaco, languageForFilename, meshThemeFor } from '../monaco/monaco'

interface Props {
  encodedPath: string
  /** POSIX-style relative path under the Project's Source Path. Null = nothing selected yet. */
  relPath: string | null
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; response: FileReadResponse & { ok: true } }
  | { kind: 'error'; response: FileReadResponse & { ok: false } }
  | { kind: 'unexpected'; message: string }

/**
 * Read-only Monaco viewer in the Workspace right pane (File Editor
 * mode). Monaco is lazy-loaded on first mount; subsequent file
 * switches reuse the same editor instance by swapping its model
 * rather than re-creating the DOM container. Theme follows the app's
 * effective palette via `monaco.editor.setTheme`. Files over 5 MB
 * render a "too large" banner instead of opening.
 */
export function FileViewer({ encodedPath, relPath }: Props): JSX.Element {
  const { effective } = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })

  // Create the editor once on mount; tear it down on unmount.
  useEffect(() => {
    let cancelled = false
    void getMonaco().then((m) => {
      if (cancelled || !containerRef.current) return
      monacoRef.current = m
      editorRef.current = m.editor.create(containerRef.current, {
        value: '',
        language: 'plaintext',
        readOnly: true,
        theme: meshThemeFor(effective),
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        fontSize: 13,
        fontFamily:
          "'JetBrains Mono Variable', 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace",
        wordWrap: 'off',
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          useShadows: false
        }
      })
    })
    return () => {
      cancelled = true
      editorRef.current?.dispose()
      editorRef.current = null
    }
    // Intentionally empty: we want exactly one editor lifecycle per
    // mount. Theme + content switching happens in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme follows the app's effective palette.
  useEffect(() => {
    const m = monacoRef.current
    if (!m) return
    m.editor.setTheme(meshThemeFor(effective))
  }, [effective])

  // File switch — load content via IPC, then push it into the editor
  // model with the right language detected from the filename.
  useEffect(() => {
    if (!relPath) {
      setState({ kind: 'idle' })
      const ed = editorRef.current
      if (ed) ed.setValue('')
      return
    }

    let cancelled = false
    setState({ kind: 'loading' })
    void window.api.files
      .read(encodedPath, relPath)
      .then((response) => {
        if (cancelled) return
        if (!response.ok) {
          setState({ kind: 'error', response })
          const ed = editorRef.current
          if (ed) ed.setValue('')
          return
        }
        setState({ kind: 'ok', response })
        // Editor may still be initializing on the very first open;
        // poll briefly until it's available.
        const apply = (): void => {
          const ed = editorRef.current
          const m = monacoRef.current
          if (!ed || !m) {
            // Try again on next tick.
            setTimeout(apply, 16)
            return
          }
          const model = m.editor.createModel(
            response.contents,
            languageForFilename(relPath)
          )
          const prior = ed.getModel()
          ed.setModel(model)
          prior?.dispose()
        }
        apply()
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          kind: 'unexpected',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      cancelled = true
    }
  }, [encodedPath, relPath])

  return (
    <div className="file-viewer">
      <div className="file-viewer-toolbar">
        <span className="file-viewer-path" title={relPath ?? undefined}>
          {relPath ?? 'Select a file in the tree.'}
        </span>
        {state.kind === 'ok' && (
          <span className="file-viewer-meta">
            {formatBytes(state.response.byteSize)} · read-only
          </span>
        )}
      </div>
      {state.kind === 'error' && (
        <FileViewerError relPath={state.response.relPath} code={state.response.code} />
      )}
      {state.kind === 'unexpected' && (
        <p className="file-viewer-error" role="alert">
          {state.message}
        </p>
      )}
      <div
        ref={containerRef}
        className="file-viewer-editor"
        // Monaco mounts here once getMonaco() resolves. Hidden when an
        // error banner takes its place.
        style={
          state.kind === 'error' || state.kind === 'unexpected'
            ? { display: 'none' }
            : undefined
        }
      />
    </div>
  )
}

function FileViewerError({
  relPath,
  code
}: {
  relPath: string
  code: 'too-large' | 'not-found' | 'not-a-file' | 'escapes-root'
}): JSX.Element {
  if (code === 'too-large') {
    return (
      <div className="file-viewer-banner" role="alert">
        <strong>{relPath}</strong>
        <p>Too large to preview — open externally.</p>
      </div>
    )
  }
  if (code === 'not-found') {
    return (
      <div className="file-viewer-banner" role="alert">
        <strong>{relPath}</strong>
        <p>File not found.</p>
      </div>
    )
  }
  if (code === 'not-a-file') {
    return (
      <div className="file-viewer-banner" role="alert">
        <strong>{relPath}</strong>
        <p>Select a regular file from the tree.</p>
      </div>
    )
  }
  return (
    <div className="file-viewer-banner" role="alert">
      <strong>{relPath}</strong>
      <p>That path escapes the Project root.</p>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
