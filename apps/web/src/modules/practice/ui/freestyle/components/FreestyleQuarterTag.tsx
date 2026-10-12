import type { FreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { useProgressRailFeedback } from './useProgressRailFeedback'

/** Sits beside the progress rail and shows the quarter-mark tag when a 25/50/75% mark is crossed. */
export function FreestyleQuarterTag({ segments }: { segments: FreestyleProgressSummary['segments'] }) {
  const quarterTag = useProgressRailFeedback(segments)
  if (!quarterTag) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+2rem)] z-30" aria-hidden>
      <span key={quarterTag.nonce} className="freestyle-quarter-tag">
        {quarterTag.label}
      </span>
    </div>
  )
}
