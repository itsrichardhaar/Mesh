interface Props {
  /** Visual size; `small` is the historical Analyze-bar size. */
  size?: 'small' | 'medium'
  /** Accessible label for screen readers. Defaults to "Activity". */
  ariaLabel?: string
}

/**
 * Single shared spinner animation used wherever Mesh signals "work is
 * happening right now" — the Analyze bar's running indicator and the
 * Workspace Sessions list's active-PTY indicator both render this. One
 * animation, multiple sites: visual consistency for free, and the
 * timing/styling lives in `styles.css` under `.activity-spinner` + size
 * variants. Re-exported so consumers don't need to know the className.
 */
export function ActivitySpinner({ size = 'small', ariaLabel = 'Activity' }: Props): JSX.Element {
  return (
    <span
      className={`activity-spinner activity-spinner-${size}`}
      role="img"
      aria-label={ariaLabel}
    />
  )
}
