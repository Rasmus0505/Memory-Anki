import { useEffect, useRef } from 'react'
import { palaceClearanceCopy, type PalaceClearance } from '@/modules/practice/ui/freestyle/model/freestylePalaceClearance'
import { cue } from '@/shared/fx'
import { freestyleMotionOn } from './freestyleParticleScenes'

export function FreestylePalaceClearedBanner({
  clearance,
  onDismiss,
}: {
  clearance: PalaceClearance
  onDismiss: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // Leaves and gold burst out of both ends as the banner pops in.
  useEffect(() => {
    const button = buttonRef.current
    if (!button || !freestyleMotionOn()) return
    if (typeof button.animate === 'function') {
      button.animate(
        [{ opacity: 0, scale: '0.8' }, { opacity: 1, scale: '1.04', offset: 0.6 }, { opacity: 1, scale: '1' }],
        { duration: 480, easing: 'cubic-bezier(0.2, 1.5, 0.4, 1)' },
      )
    }
    const timer = window.setTimeout(() => {
      if (button.isConnected) cue('area.clear', { rect: button.getBoundingClientRect() })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [clearance])

  return (
    <div
      data-testid="freestyle-palace-cleared"
      role="status"
      className="pointer-events-none absolute inset-x-3 top-[4.75rem] z-30 sm:inset-x-4 sm:top-20"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="关闭宫殿已清提示"
        className="pointer-events-auto mx-auto block w-full max-w-lg rounded-2xl border border-emerald-300/35 bg-emerald-950/92 px-4 py-3 text-center shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur-md"
        onClick={onDismiss}
      >
        <div className="text-[15px] font-semibold leading-snug text-emerald-50 sm:text-base">
          {palaceClearanceCopy(clearance)}
        </div>
        <div className="mt-1 text-[11px] text-emerald-100/75">点一下关闭</div>
      </button>
    </div>
  )
}
