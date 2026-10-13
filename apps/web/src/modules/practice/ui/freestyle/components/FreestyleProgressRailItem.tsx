import { useEffect, useRef, useState } from 'react'
import {
  progressSegmentAccentClass,
  progressSegmentShapeClass,
  retryNodeToneClass,
  type FreestyleProgressSegment,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { cn } from '@/shared/lib/utils'
import { FX_ANCHORS } from '@/shared/fx'

/**
 * Radix's default 700ms open delay made each tick feel dead on hover.
 * Set on every rail tooltip root, not the page provider: the provider is shared.
 */
export const TOOLTIP_DELAY_MS = 120

/** Circle text is this card's retry attempt in the current round, not its place in the rail. */
function retryAttemptGlyph(segment: FreestyleProgressSegment): string {
  return String(Math.max(1, Math.round(segment.retryAttempt || 1)))
}

/** Gap between neighbouring ticks lighting up when a palace finishes clearing. */
const PALACE_STAGGER_MS = 40
/** Must stay in sync with the `progress-palace-done` animation duration in CSS. */
const PALACE_DONE_MS = 560
/** Palace wave waits for the last tick's fill sweep to land first. */
export const PALACE_LEAD_MS = 380
/** Must stay in sync with the `progress-rail-enter` animation duration in CSS. */
const RAIL_ENTER_MS = 420
/** Must stay in sync with the `progress-tick-done` / `progress-fill-sweep-edge` durations in CSS. */
const TICK_DONE_MS = 460
/** Must cover `progress-tick-enter` in CSS. */
const MOUNT_ENTER_MS = 300
/**
 * Ordinal of this index within its palace's contiguous run, so a palace-cleared
 * pulse sweeps left to right instead of every tick firing at once.
 */
export function palaceStaggerIndex(
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

export function ProgressRailItem({
  segment,
  palaceGap,
  palaceStaggerIndex,
  hoverLabel,
  showRetryCount,
  compact,
  inserted,
}: {
  segment: FreestyleProgressSegment
  palaceGap: boolean
  /** Ordinal within this palace's run of segments, used to stagger the clear pulse. */
  palaceStaggerIndex: number
  hoverLabel: string
  showRetryCount: boolean
  compact: boolean
  /** A retry occurrence that just squeezed into an already-drawn rail. */
  inserted: boolean
}) {
  const prevToneRef = useRef(segment.tone)
  const prevPalaceDoneRef = useRef(segment.palaceDone)
  const prevViewingRef = useRef(segment.viewing || segment.tone === 'current')
  const [tickBounce, setTickBounce] = useState(false)
  const [palaceFlash, setPalaceFlash] = useState(false)
  const [playheadEnter, setPlayheadEnter] = useState(false)
  const [mountEnter, setMountEnter] = useState(true)

  // Mount fade plays once; without this it replays every time a pulse class drops off.
  useEffect(() => {
    const id = setTimeout(() => setMountEnter(false), MOUNT_ENTER_MS)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (prevToneRef.current !== 'done' && segment.tone === 'done') {
      setTickBounce(true)
      const id = setTimeout(() => setTickBounce(false), TICK_DONE_MS)
      prevToneRef.current = segment.tone
      return () => {
        clearTimeout(id)
        setTickBounce(false)
      }
    }
    prevToneRef.current = segment.tone
  }, [segment.tone])

  // The palace wave starts only after the closing tick has finished filling.
  useEffect(() => {
    if (!prevPalaceDoneRef.current && segment.palaceDone) {
      prevPalaceDoneRef.current = segment.palaceDone
      const start = setTimeout(
        () => setPalaceFlash(true),
        PALACE_LEAD_MS + palaceStaggerIndex * PALACE_STAGGER_MS,
      )
      const end = setTimeout(
        () => setPalaceFlash(false),
        PALACE_LEAD_MS + palaceStaggerIndex * PALACE_STAGGER_MS + PALACE_DONE_MS,
      )
      return () => {
        clearTimeout(start)
        clearTimeout(end)
        setPalaceFlash(false)
      }
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
  const enterClass = inserted
    ? 'progress-retry-insert'
    : mountEnter
      ? 'progress-tick-enter'
      : null
  const nodeEnterClass = viewing ? playheadClass : oneShotClass ? null : enterClass
  /** Fill sweep lives on a child overlay, so it never fights the bar's transform pulses. */
  const fillSweep = tickBounce && segment.tone === 'done'
  const slotOpenClass = inserted
    ? segment.kind === 'retry' && showRetryCount
      ? 'progress-slot-open-fixed'
      : 'progress-slot-open-flex'
    : null

  const palaceId = segment.palaceId == null ? '' : String(segment.palaceId)
  const slotData = {
    'data-rail-slot': segment.cardId,
    'data-rail-palace': palaceId,
  }
  const gapClass = !compact && palaceGap ? 'ml-0.5' : null

  if (segment.kind === 'retry' && showRetryCount) {
    return (
      <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <span
            {...slotData}
            className={cn('flex h-full shrink-0 items-end justify-center', gapClass, slotOpenClass)}
          >
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
                'progress-bar inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums leading-none',
                nodeEnterClass,
                viewing ? 'size-5 text-[10px] ring-2 ring-stage-ink' : 'size-3.5 text-[9px]',
                oneShotClass,
                retryNodeToneClass(segment.tone, segment.isNew),
              )}
            >
              {retryAttemptGlyph(segment)}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{hoverLabel}</TooltipContent>
      </Tooltip>
    )
  }
  if (segment.kind === 'retry') {
    return (
      <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <span
            {...slotData}
            aria-label={hoverLabel}
            className={cn('flex h-full min-w-0 flex-1 items-end', gapClass, slotOpenClass)}
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
                'progress-bar w-full',
                nodeEnterClass,
                progressSegmentShapeClass(segment.tone, viewing),
                oneShotClass,
                retryNodeToneClass(segment.tone, segment.isNew),
              )}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{hoverLabel}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>
        <span
          {...slotData}
          aria-label={hoverLabel}
          className={cn(
            'progress-slot flex h-full items-end',
            compact ? 'min-w-0' : 'min-w-px',
            viewing ? 'flex-[1.8]' : 'flex-1',
            gapClass,
          )}
        >
          <span
            data-testid="freestyle-progress-segment" data-fx-anchor={viewing ? FX_ANCHORS.progressViewing : undefined}
            data-tone={segment.tone}
            data-viewing={viewing ? 'true' : 'false'}
            data-palace-id={palaceId}
            data-palace-done={segment.palaceDone ? 'true' : 'false'}
            data-cohort-boundary={segment.cohortBoundary ? 'true' : 'false'}
            className={cn(
              'progress-bar relative w-full overflow-hidden rounded-[1px]',
              progressSegmentShapeClass(segment.tone, viewing),
              // While the sweep runs the base stays faint; the overlay carries the solid fill.
              progressSegmentAccentClass(segment.isNew, fillSweep ? 'pending' : segment.tone),
              // Playhead 走「入场 -> 呼吸」两段，同时只挂一个。
              playheadClass,
              oneShotClass,
            )}
          >
            {fillSweep ? (
              <span
                aria-hidden
                className={cn(
                  'progress-fill-sweep absolute inset-0 rounded-[inherit]',
                  progressSegmentAccentClass(segment.isNew, 'done'),
                )}
              />
            ) : null}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hoverLabel}</TooltipContent>
    </Tooltip>
  )
}
