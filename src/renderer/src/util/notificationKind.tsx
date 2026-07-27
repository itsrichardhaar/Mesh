import { Hand, CircleCheck, Moon, type LucideIcon } from 'lucide-react'
import type { NotificationKind } from '@shared/types'

/**
 * Per-kind presentation for Notifications (v9). The icon is the PRIMARY
 * cue — each kind has a shape-distinct glyph so the kinds are
 * distinguishable with colour removed (reduced-color-vision constraint);
 * the `className` supplies a redundant `--notif-*` colour, never the sole
 * signal. `sticky` drives toast behaviour: an `approval` toast persists
 * until acted on (Claude is blocked on the user), while `complete`/`idle`
 * auto-dismiss.
 */
export interface KindPresentation {
  Icon: LucideIcon
  className: string
  /** Short human name for the kind, used in accessible labels. */
  name: string
  sticky: boolean
}

const BY_KIND: Record<'idle' | 'approval' | 'complete', KindPresentation> = {
  // Raised hand — "stop, waiting on you." Distinct silhouette from the
  // check and the crescent below, so shape alone separates the kinds.
  approval: { Icon: Hand, className: 'notif-kind-approval', name: 'Approval', sticky: true },
  complete: { Icon: CircleCheck, className: 'notif-kind-complete', name: 'Complete', sticky: false },
  idle: { Icon: Moon, className: 'notif-kind-idle', name: 'Idle', sticky: false }
}

/**
 * Presentation for a Notification Kind. Any unknown kind degrades to the
 * `idle` presentation, matching the renderer's documented graceful-
 * degradation contract for unrecognized kinds.
 */
export function kindPresentation(kind: NotificationKind): KindPresentation {
  return BY_KIND[kind as 'idle'] ?? BY_KIND.idle
}
