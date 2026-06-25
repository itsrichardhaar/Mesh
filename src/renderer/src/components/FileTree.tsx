import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileNode, FilesTreeResponse } from '@shared/files'

interface Props {
  encodedPath: string
  showHidden: boolean
}

type Cache = Map<string, FileNode[]>

const ROOT_REL = ''

export function FileTree({ encodedPath, showHidden }: Props): JSX.Element {
  const [cache, setCache] = useState<Cache>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const inflight = useRef<Set<string>>(new Set())

  const fetchDir = useCallback(
    async (relPath: string): Promise<void> => {
      if (inflight.current.has(relPath)) return
      inflight.current.add(relPath)
      try {
        const res: FilesTreeResponse = await window.api.files.tree(encodedPath, {
          relPath,
          showHidden
        })
        setSourcePath(res.sourcePath)
        setCache((prev) => {
          const next = new Map(prev)
          next.set(relPath, res.entries)
          return next
        })
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        inflight.current.delete(relPath)
      }
    },
    [encodedPath, showHidden]
  )

  // Initial load: root only. Switching encodedPath / showHidden resets
  // the cache so we don't show stale entries from another mode.
  useEffect(() => {
    setCache(new Map())
    setExpanded(new Set())
    void fetchDir(ROOT_REL)
  }, [encodedPath, showHidden, fetchDir])

  // Live filesystem updates: chokidar fires for any change in the
  // watched root. Refetch the root + every directory we currently have
  // expanded; the inflight guard collapses duplicates.
  useEffect(() => {
    const off = window.api.files.onTreeChanged((changedEncodedPath) => {
      if (changedEncodedPath !== encodedPath) return
      void fetchDir(ROOT_REL)
      for (const relPath of expanded) void fetchDir(relPath)
    })
    return off
  }, [encodedPath, expanded, fetchDir])

  const toggle = (node: FileNode): void => {
    if (node.type !== 'dir') return
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.relPath)) {
        next.delete(node.relPath)
      } else {
        next.add(node.relPath)
        if (!cache.has(node.relPath)) void fetchDir(node.relPath)
      }
      return next
    })
  }

  const rootEntries = cache.get(ROOT_REL)

  return (
    <div className="file-tree" aria-label="File tree">
      {sourcePath && (
        <div className="file-tree-root-path" title={sourcePath}>
          {sourcePath}
        </div>
      )}
      {error && (
        <p className="file-tree-error" role="alert">
          {error}
        </p>
      )}
      {!rootEntries && !error && <p className="file-tree-loading">Loading…</p>}
      {rootEntries && rootEntries.length === 0 && !error && (
        <p className="file-tree-empty">Empty directory</p>
      )}
      {rootEntries && rootEntries.length > 0 && (
        <ul className="file-tree-list" role="tree">
          {rootEntries.map((node) => (
            <FileTreeNode
              key={node.relPath}
              node={node}
              depth={0}
              expanded={expanded}
              cache={cache}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FileTreeNode({
  node,
  depth,
  expanded,
  cache,
  onToggle
}: {
  node: FileNode
  depth: number
  expanded: Set<string>
  cache: Cache
  onToggle: (node: FileNode) => void
}): JSX.Element {
  const isDir = node.type === 'dir'
  const isOpen = isDir && expanded.has(node.relPath)
  const children = isOpen ? cache.get(node.relPath) : undefined

  return (
    <li role="treeitem" aria-expanded={isDir ? isOpen : undefined}>
      <button
        type="button"
        className={`file-tree-row file-tree-row-${node.type}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onToggle(node)}
      >
        {isDir ? (
          <span className={`file-tree-caret${isOpen ? ' file-tree-caret-open' : ''}`}>›</span>
        ) : (
          <span className="file-tree-caret-spacer" />
        )}
        <span className="file-tree-name">{node.name}</span>
      </button>
      {isOpen && children && children.length > 0 && (
        <ul className="file-tree-list" role="group">
          {children.map((child) => (
            <FileTreeNode
              key={child.relPath}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              cache={cache}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
      {isOpen && children && children.length === 0 && (
        <p className="file-tree-child-empty" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
          (empty)
        </p>
      )}
    </li>
  )
}
