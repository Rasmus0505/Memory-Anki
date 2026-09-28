import type { FreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { useProgressRailParticles } from './useProgressRailParticles'

/** Sits beside the progress rail; draws the quarter-mark tag and drives the rail's particle scenes. */
export function FreestyleRailParticles({ segments }: { segments: FreestyleProgressSummary['segments'] }) {
  const quarterTag = useProgressRailParticles(segments)
  if (!quarterTag) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+2rem)] z-30" aria-hidden>
      <span key={quarterTag.nonce} className="freestyle-quarter-tag">
        {quarterTag.label}
      </span>
    </div>
  )
}
