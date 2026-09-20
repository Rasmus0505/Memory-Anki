import { type ReactNode } from 'react'
import {
  palaceAccentToneClass,
  progressHudText,
  progressRailLabel,
  progressSegmentHoverLabel,
  progressSegmentShapeClass,
  retryNodeToneClass,
  type FreestyleProgressSegment,
  type FreestyleProgressSummary,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { cn } from '@/shared/lib/utils'

function ProgressRailItem({
  segment,
  palaceGap,
  hoverLabel,
}: {
  segment: FreestyleProgressSegment
  palaceGap: boolean
  hoverLabel: string
}) {
  const palaceId = segment.palaceId == null ? '' : String(segment.palaceId)
  const viewing = Boolean(segment.viewing || segment.tone === 'current')
  const gapClass = segment.cohortBoundary
    ? 'ml-1.5 border-l border-white/45 pl-1'
    : palaceGap
      ? 'ml-0.5'
      : null
  if (segment.kind === 'retry') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="freestyle-progress-retry-node"
            data-tone={segment.tone}
            data-viewing={viewing ? 'true' : 'false'}
            data-palace-id={palaceId}
            data-palace-done={segment.palaceDone ? 'true' : 'false'}
            data-cohort-boundary={segment.cohortBoundary ? 'true' : 'false'}
            aria-label={hoverLabel}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums leading-none',
              viewing ? 'size-5 text-[10px] ring-2 ring-white' : 'size-3.5 text-[9px]',
              gapClass,
              retryNodeToneClass(segment.tone),
            )}
          >
            {Math.max(1, Math.round(segment.retryAttempt || 1))}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{hoverLabel}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={hoverLabel}
          className={cn(
            'flex h-full min-w-px items-end',
            viewing ? 'flex-[1.8]' : 'flex-1',
            gapClass,
          )}
        >
          <span
            data-testid="freestyle-progress-segment"
            data-tone={segment.tone}
            data-viewing={viewing ? 'true' : 'false'}
            data-palace-id={palaceId}
            data-palace-done={segment.palaceDone ? 'true' : 'false'}
            data-cohort-boundary={segment.cohortBoundary ? 'true' : 'false'}
            className={cn(
              'w-full rounded-[1px] transition-[colors,height,box-shadow,min-width]',
              progressSegmentShapeClass(segment.tone, viewing),
              palaceAccentToneClass(segment.palaceId, segment.tone),
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hoverLabel}</TooltipContent>
    </Tooltip>
  )
}

export function FreestyleProgressRail({
  summary,
  onOpenPlan,
  overflow,
  workspaceSwitcher,
}: {
  summary: FreestyleProgressSummary
  onOpenPlan: () => void
  /** Overflow menu trigger + content, owned by the page. */
  overflow?: ReactNode
  workspaceSwitcher?: ReactNode
}) {
  const railLabel = progressRailLabel(summary)
  const hudText = progressHudText(summary)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {/* Round progress: one segment per card, so restudy re-insertion is visible.
          TooltipProvider lives on ImmersiveFreestylePage — nesting another here
          loops Radix DropdownMenuTrigger refs under Vite. */}
      <div
        data-testid="freestyle-progress-rail"
        role="img"
        aria-label={railLabel}
        className="pointer-events-auto flex h-7 w-full cursor-pointer items-end gap-px bg-zinc-950/55 px-0 pb-1 pt-[max(0px,env(safe-area-inset-top,0px))]"
        onClick={onOpenPlan}
      >
        {summary.segments.length === 0 ? (
          <span className="h-1.5 w-full rounded-[1px] bg-white/25" aria-hidden />
        ) : (
          summary.segments.map((segment, index) => (
            <ProgressRailItem
              key={segment.cardId}
              segment={segment}
              hoverLabel={progressSegmentHoverLabel(segment, index, summary.segments.length)}
              palaceGap={
                index > 0 && summary.segments[index - 1]?.palaceId !== segment.palaceId
              }
            />
          ))
        )}
      </div>

      <div className="flex items-start justify-between gap-1 px-2 pt-1 sm:px-3">
        <div className="mt-0.5 flex min-w-0 max-w-[72%] items-center gap-1">
          {workspaceSwitcher}
          {hudText ? (
            <button
              type="button"
              data-testid="freestyle-progress-hud"
              className="pointer-events-auto truncate rounded-full px-2 py-1 text-left text-[11px] font-medium tabular-nums text-zinc-200/88 hover:text-white"
              aria-hidden
              onClick={onOpenPlan}
            >
              {hudText}
            </button>
          ) : null}
        </div>
        {overflow ? (
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-zinc-950/82 px-1 py-0.5 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-md">
            {overflow}
          </div>
        ) : null}
      </div>
    </div>
  )
}
