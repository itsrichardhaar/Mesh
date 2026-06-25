import { useEffect, useState } from 'react'

interface Props {
  onOpenSettings: () => void
}

/**
 * Soft onboarding nudge above the Home Screen sidebar/detail layout.
 * Renders only when no Anthropic API key is saved — clicking it opens
 * Settings. Mesh deliberately stays usable without a key (sidebar,
 * file tree, Sessions, transcript all work); only the Analyze action
 * is gated, and that's where this banner points the user.
 */
export function OnboardingBanner({ onOpenSettings }: Props): JSX.Element | null {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    const probe = async (): Promise<void> => {
      try {
        const mask = await window.api.secrets.getMask('claude')
        if (cancelled) return
        setShow(mask === null)
      } catch {
        if (cancelled) return
        // If we can't probe, don't pester the user with a banner that
        // might be incorrect — quiet failure is the right move.
        setShow(false)
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [])

  if (!show) return null

  return (
    <button type="button" className="onboarding-banner" onClick={onOpenSettings}>
      Add your Anthropic API key in Settings to enable analyses →
    </button>
  )
}
