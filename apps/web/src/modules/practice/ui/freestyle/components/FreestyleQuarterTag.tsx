import type { FreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { useProgressRailFeedback } from './useProgressRailFeedback'

/** Sits beside the progress rail and shows the quarter-mark tag when a 25/50/75% mark is crossed. */
export function FreestyleQuarterTag({ segments }: { segments: FreestyleProgressSummary['segments'] }) {
  const quarterTag = useProgressRailFeedback(segments)
  if (!quarterTag) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--fs-hud-h,4.5rem)+0.25rem)] z-30 flex justify-center" aria-hidden>
      <span
        key={quarterTag.nonce}
        className="freestyle-quarter-tag rounded-full border border-stage-line bg-stage-overlay px-2.5 py-1 text-[11px] font-semibold text-stage-glow shadow-sm"
      >
        {quarterTag.label}
      </span>
    </div>
  )
}
