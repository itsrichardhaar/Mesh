import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** Current width in px — the sidebar's current computed size. */
  width: number
  min: number
  max: number
  /** Called on every mousemove during a drag; caller updates the width. */
  onResize: (next: number) => void
  /** Accessible label for screen readers. */
  ariaLabel?: string
}

/**
 * v5.1: 6-px-wide invisible strip anchored to the right edge of a
 * sidebar. On hover it lights up (accent-colored line); on mousedown
 * it captures the document's mousemove + mouseup so the drag survives
 * even if the cursor leaves the strip. Emits width updates on every
 * mousemove; the parent decides how to persist (see `useSidebarWidth`
 * for the debounced persistence pattern).
 *
 * Positioning: the handle is `position: absolute` relative to its
 * sidebar parent — the parent must be `position: relative`. Width is
 * fixed (6px); vertical extent is 100% of the parent.
 */
export function SidebarResizeHandle({
  width,
  min,
  max,
  onResize,
  ariaLabel = 'Resize sidebar'
}: Props): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(true)
      startRef.current = { startX: e.clientX, startWidth: width }
    },
    [width]
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent): void => {
      const start = startRef.current
      if (!start) return
      const delta = e.clientX - start.startX
      const next = Math.min(Math.max(start.startWidth + delta, min), max)
      onResize(next)
    }
    const onUp = (): void => {
      setDragging(false)
      startRef.current = null
    }
    // While dragging: force the global cursor to `col-resize`, suppress
    // text selection, and tag <body> with `sidebar-resizing` so a CSS
    // rule disables pointer events everywhere except the handle itself.
    // Without the pointer-events lock, mousemove would trip :hover on
    // whatever the cursor happened to be over (project rows, file
    // tree items), showing incorrect hover state during a drag.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.classList.add('sidebar-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.classList.remove('sidebar-resizing')
    }
  }, [dragging, min, max, onResize])

  // Keyboard support: arrow left/right nudge by 16px, shift+arrow by 64px.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 64 : 16
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        onResize(Math.min(width + step, max))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onResize(Math.max(width - step, min))
      }
    },
    [width, min, max, onResize]
  )

  return (
    <div
      className={`sidebar-resize-handle${dragging ? ' sidebar-resize-handle-active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    />
  )
}
