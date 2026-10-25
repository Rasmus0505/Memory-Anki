import { useEffect, useRef } from 'react'
import { cue } from '@/shared/fx'
import { freestyleMotionOn } from './freestyleFeedbackScenes'

/** Inline notice once the round's last new (never-passed) unit gets its first pass. */
export function FreestyleNewUnitsBanner({ onDismiss }: { onDismiss: () => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const button = buttonRef.current
    if (!button || !freestyleMotionOn()) return
    if (typeof button.animate === 'function') {
      button.animate(
        [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)' },
      )
    }
    const timer = window.setTimeout(() => {
      if (button.isConnected) cue('area.clear', { element: button })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      data-testid="freestyle-new-units-finished"
      role="status"
      className="pointer-events-none absolute inset-x-3 top-[calc(var(--fs-hud-h,4.5rem)+0.5rem)] z-30 sm:inset-x-4"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="关闭今日新学完成提示"
        className="pointer-events-auto mx-auto block w-full max-w-lg rounded-2xl border border-sky-300/35 bg-sky-950/92 px-4 py-3 text-center shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur-md"
        onClick={onDismiss}
      >
        <div className="text-[15px] font-semibold leading-snug text-sky-50 sm:text-base">
          今日新学已完成，接下来只复习
        </div>
        <div className="mt-1 text-[11px] text-sky-100/75">点一下关闭</div>
      </button>
    </div>
  )
}
