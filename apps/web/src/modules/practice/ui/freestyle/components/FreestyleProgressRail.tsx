import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  freestyleProgressRailFits,
  palaceAccentToneClass,
  progressHudText,
  progressRailLabel,
  progressRailRetryCountVisible,
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

/** Circle text is this card's retry attempt in the current round, not its place in the rail. */
function retryAttemptGlyph(segment: FreestyleProgressSegment): string {
  return String(Math.max(1, Math.round(segment.retryAttempt || 1)))
}

/** Gap between neighbouring ticks lighting up when a palace finishes clearing. */
const PALACE_STAGGER_MS = 40
/** Must stay in sync with the `progress-palace-done` animation duration in CSS. */
const PALACE_DONE_MS = 520
/** Must stay in sync with the `progress-rail-enter` animation duration in CSS. */
const RAIL_ENTER_MS = 320
/** Must stay in sync with the `progress-tick-done` animation duration in CSS. */
const TICK_DONE_MS = 420

/**
 * Ordinal of this index within its palace's contiguous run, so a palace-cleared
 * pulse sweeps left to right instead of every tick firing at once.
 */
function palaceStaggerIndex(
  segments: readonly FreestyleProgressSegment[],
  index: number,
): number {
  const palaceId = segments[index]?.palaceId
  let ordinal = 0
  for (let i = index - 1; i >= 0; i -= 1) {
    if (segments[i]?.palaceId !== palaceId) break
    ordinal += 1
  }
  return ordinal
}

function ProgressRailItem({
  segment,
  palaceGap,
  palaceStaggerIndex,
  hoverLabel,
  showRetryCount,
  compact,
}: {
  segment: FreestyleProgressSegment
  palaceGap: boolean
  /** Ordinal within this palace's run of segments, used to stagger the clear pulse. */
  palaceStaggerIndex: number
  hoverLabel: string
  showRetryCount: boolean
  compact: boolean
}) {
  const prevToneRef = useRef(segment.tone)
  const prevPalaceDoneRef = useRef(segment.palaceDone)
  const prevViewingRef = useRef(segment.viewing || segment.tone === 'current')
  const [tickBounce, setTickBounce] = useState(false)
  const [palaceFlash, setPalaceFlash] = useState(false)
  const [playheadEnter, setPlayheadEnter] = useState(false)

  useEffect(() => {
    if (prevToneRef.current !== 'done' && segment.tone === 'done') {
      setTickBounce(true)
      const id = setTimeout(() => setTickBounce(false), TICK_DONE_MS)
      prevToneRef.current = segment.tone
      return () => clearTimeout(id)
    }
    prevToneRef.current = segment.tone
  }, [segment.tone])

  useEffect(() => {
    if (!prevPalaceDoneRef.current && segment.palaceDone) {
      setPalaceFlash(true)
      const id = setTimeout(
        () => setPalaceFlash(false),
        PALACE_DONE_MS + palaceStaggerIndex * PALACE_STAGGER_MS,
      )
      prevPalaceDoneRef.current = segment.palaceDone
      return () => clearTimeout(id)
    }
    prevPalaceDoneRef.current = segment.palaceDone
  }, [segment.palaceDone, palaceStaggerIndex])

  const viewing = Boolean(segment.viewing || segment.tone === 'current')

  // The playhead entry plays first, then the breath takes over. Both animate
  // `transform`+`filter`, so both must never be attached at the same time:
  // whichever class is declared later would otherwise win outright and leave
  // the other as a dead animation.
  useEffect(() => {
    if (prevViewingRef.current === viewing) return
    prevViewingRef.current = viewing
    if (!viewing) return
    setPlayheadEnter(true)
    const id = setTimeout(() => setPlayheadEnter(false), RAIL_ENTER_MS)
    return () => clearTimeout(id)
  }, [viewing])

  const playheadClass = playheadEnter
    ? 'progress-rail-enter'
    : viewing
      ? 'progress-rail-breath'
      : null

  /**
   * One-shot pulse for a tick that is not the playhead. Playhead, mount-enter and
   * the pulses all write `transform`+`filter`, so exactly one may own the element;
   * whichever class is declared later would otherwise win and kill the others.
   *
   * `palace-done` outranks `tick-done`: clearing the palace is the rarer, more
   * meaningful event, and a card that both completes and closes its palace fires
   * both effects in the same render.
   */
  const pulseClass = palaceFlash
    ? 'progress-palace-done'
    : tickBounce
      ? 'progress-tick-done'
      : null
  /** Pulse is suppressed while this node is the playhead (see above). */
  const oneShotClass = viewing ? null : pulseClass
  /**
   * A node that mounts as the playhead takes the playhead entry; otherwise the
   * mount fade. Never both, and never on top of a one-shot pulse.
   */
  const nodeEnterClass = viewing ? playheadClass : oneShotClass ? null : 'progress-tick-enter'

  const palaceId = segment.palaceId == null ? '' : String(segment.palaceId)
  const gapClass = compact
    ? null
    : segment.cohortBoundary
      ? 'ml-1.5 border-l border-white/45 pl-1 progress-boundary-enter'
      : palaceGap
        ? 'ml-0.5'
        : null

  if (segment.kind === 'retry' && showRetryCount) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="freestyle-progress-retry-node"
            data-count-visible="true"
            data-tone={segment.tone}
            data-viewing={viewing ? 'true' : 'false'}
            data-palace-id={palaceId}
            data-palace-done={segment.palaceDone ? 'true' : 'false'}
            data-cohort-boundary={segment.cohortBoundary ? 'true' : 'false'}
            aria-label={hoverLabel}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums leading-none',
              nodeEnterClass,
              viewing ? 'size-5 text-[10px] ring-2 ring-white' : 'size-3.5 text-[9px]',
              oneShotClass,
              gapClass,
              retryNodeToneClass(segment.tone),
            )}
            style={
              palaceFlash
                ? { animationDelay: `${palaceStaggerIndex * PALACE_STAGGER_MS}ms` }
                : undefined
            }
          >
            {retryAttemptGlyph(segment)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{hoverLabel}</TooltipContent>
      </Tooltip>
    )
  }
  if (segment.kind === 'retry') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={hoverLabel}
            className={cn('flex h-full min-w-0 flex-1 items-end', gapClass)}
          >
            <span
              data-testid="freestyle-progress-retry-node"
              data-count-visible="false"
              data-tone={segment.tone}
              data-viewing={viewing ? 'true' : 'false'}
              data-palace-id={palaceId}
              data-palace-done={segment.palaceDone ? 'true' : 'false'}
              data-cohort-boundary={segment.cohortBoundary ? 'true' : 'false'}
              className={cn(
                nodeEnterClass,
                progressSegmentShapeClass(segment.tone, viewing),
                oneShotClass,
                retryNodeToneClass(segment.tone),
              )}
              style={
                palaceFlash
                  ? { animationDelay: `${palaceStaggerIndex * PALACE_STAGGER_MS}ms` }
                  : undefined
              }
            />
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
            'flex h-full items-end',
            compact ? 'min-w-0' : 'min-w-px',
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
              'w-full rounded-[1px] transition-[colors,height,min-width] duration-200 ease-out',
              progressSegmentShapeClass(segment.tone, viewing),
              palaceAccentToneClass(segment.palaceId, segment.tone),
              // Playhead 走「入场 -> 呼吸」两段，同时只挂一个。
              playheadClass,
              oneShotClass,
            )}
            style={
              palaceFlash && !viewing
                ? { animationDelay: `${palaceStaggerIndex * PALACE_STAGGER_MS}ms` }
                : undefined
            }
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
  const railRef = useRef<HTMLDivElement>(null)
  const [railWidth, setRailWidth] = useState(0)
  useLayoutEffect(() => {
    const node = railRef.current
    if (!node) return
    const update = () => setRailWidth(node.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const compact = railWidth > 0 && !freestyleProgressRailFits(summary.segments, railWidth)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {/* Round progress: one segment per card, so restudy re-insertion is visible.
          TooltipProvider lives on ImmersiveFreestylePage — nesting another here
          loops Radix DropdownMenuTrigger refs under Vite. */}
      <div
        ref={railRef}
        data-testid="freestyle-progress-rail"
        data-compact={compact ? 'true' : 'false'}
        role="img"
        aria-label={railLabel}
        className={cn(
          'pointer-events-auto flex h-7 w-full min-w-0 cursor-pointer items-end overflow-hidden bg-zinc-950/55 px-0 pb-1 pt-[max(0px,env(safe-area-inset-top,0px))]',
          compact ? 'gap-0' : 'gap-px',
        )}
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
              palaceStaggerIndex={palaceStaggerIndex(summary.segments, index)}
              palaceGap={
                index > 0 && summary.segments[index - 1]?.palaceId !== segment.palaceId
              }
              showRetryCount={progressRailRetryCountVisible(summary.segments, index, railWidth)}
              compact={compact}
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
