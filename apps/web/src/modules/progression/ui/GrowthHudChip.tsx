import { useEffect, useRef } from 'react'
import { FX_ANCHORS, cue, fxAnchor } from '@/shared/fx'
import { cn } from '@/shared/lib/utils'
import { useLiveGrowthToasts } from '../model/useGrowthCeremony'
import { useProgressionOverview } from '../model/useProgressionOverview'

const RING = 2 * Math.PI * 9

/** Freestyle top bar: level ring + today's quest count. Mid-round unlocks only stamp the corner. */
export function GrowthHudChip({ className }: { className?: string }) {
  const { data } = useProgressionOverview({ followReviews: true })
  useLiveGrowthToasts(data)
  const ringRef = useRef<HTMLSpanElement>(null)
  const lastXp = useRef<number | null>(null)

  useEffect(() => {
    const xp = data?.level.xp ?? null
    if (xp != null && lastXp.current != null && xp > lastXp.current && ringRef.current) {
      cue('level.tick', { element: ringRef.current })
    }
    lastXp.current = xp
  }, [data?.level.xp])

  if (!data) return null
  const daily = data.quests.filter((quest) => quest.scope === 'daily')
  const done = daily.filter((quest) => quest.done).length
  return (
    <span
      data-testid="growth-hud-chip"
      aria-label={`等级 ${data.level.level}，今日委托 ${done}/${daily.length}`}
      className={cn('freestyle-stage-glass inline-flex h-7 items-center gap-1.5 rounded-full border border-stage-line-strong pl-0.5 pr-2.5 text-[11px] font-semibold text-stage-ink', className)}
    >
      <span ref={ringRef} {...fxAnchor(FX_ANCHORS.levelRing)} className="relative grid size-6 place-items-center">
        <svg viewBox="0 0 22 22" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="11" cy="11" r="9" fill="none" strokeWidth="2.5" className="stroke-stage-line" />
          <circle
            cx="11"
            cy="11"
            r="9"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="stroke-stage-glow transition-[stroke-dashoffset] duration-700"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - data.level.progress)}
          />
        </svg>
        <span className="relative text-[10px] font-black tabular-nums">{data.level.level}</span>
      </span>
      <span className="tabular-nums">委托 {done}/{daily.length}</span>
    </span>
  )
}
