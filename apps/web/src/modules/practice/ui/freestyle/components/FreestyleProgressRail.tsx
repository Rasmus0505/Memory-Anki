import { Fragment, type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  dayCutHoverLabel,
  dayRemainingCount,
  freestyleProgressRailFits,
  palaceAccentToneClass,
  progressHudText,
  progressRailLabel,
  progressRailRetryCountVisible,
  progressSegmentHoverLabel,
  progressSegmentShapeClass,
  retryNodeToneClass,
  roundDaySpan,
  type FreestyleProgressSegment,
  type FreestyleProgressSummary,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { formatLocalDateKey } from '@/shared/lib/dateTime'
import { cn } from '@/shared/lib/utils'
import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'
import type {
  FreestyleScrollChannel,
  FreestyleScrollFrame,
} from '@/modules/practice/ui/freestyle/model/freestyleScrollChannel'
import { FX_ANCHORS } from '@/shared/fx'
import {
  cardIdAtRailPointer,
  clearedPalaceRanges,
  measureRailSlots,
  railSlot,
  type SlotRect,
} from '@/modules/practice/ui/freestyle/components/freestyleProgressRailGeometry'

/** Circle text is this card's retry attempt in the current round, not its place in the rail. */
function retryAttemptGlyph(segment: FreestyleProgressSegment): string {
  return String(Math.max(1, Math.round(segment.retryAttempt || 1)))
}

/** Gap between neighbouring ticks lighting up when a palace finishes clearing. */
const PALACE_STAGGER_MS = 40
/** Must stay in sync with the `progress-palace-done` animation duration in CSS. */
const PALACE_DONE_MS = 560
/** Palace wave waits for the last tick's fill sweep to land first. */
const PALACE_LEAD_MS = 380
/** Must stay in sync with the `progress-rail-enter` animation duration in CSS. */
const RAIL_ENTER_MS = 420
/** Must stay in sync with the `progress-tick-done` / `progress-fill-sweep-edge` durations in CSS. */
const TICK_DONE_MS = 460
/** Must stay in sync with the `progress-glider` transition in CSS. */
const GLIDER_MS = 380
/** Must stay in sync with the `progress-sheen` (palace / round) durations in CSS. */
const PALACE_SHEEN_MS = 700
const ROUND_SHEEN_MS = 1050
const ROUND_GLOW_MS = 1200
/** Must cover `progress-slot-open-*` + delayed `progress-retry-insert` in CSS. */
const INSERT_MS = 640
/** Must cover `progress-tick-enter` in CSS. */
const MOUNT_ENTER_MS = 300
/** More new ids than this in one update is a reload, not a retry insertion. */
const INSERT_BATCH_LIMIT = 3
/** Follow mode sizes the glider with scaleX from this base width (transform-only per frame). */
const FOLLOW_BASE_WIDTH = 100
/** A follow-driven arrival suppresses the comet only if the playhead catches up this fast. */
const FOLLOW_ARRIVAL_WINDOW_MS = 700

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

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
      <Tooltip>
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
                retryNodeToneClass(segment.tone),
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
      <Tooltip>
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
                retryNodeToneClass(segment.tone),
              )}
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
              palaceAccentToneClass(segment.palaceId, fillSweep ? 'pending' : segment.tone),
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
                  palaceAccentToneClass(segment.palaceId, 'done'),
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

interface RailSheen {
  id: string
  kind: 'palace' | 'round'
  left: number
  width: number
}

function segmentHoverLabel(
  segment: FreestyleProgressSegment,
  index: number,
  segments: readonly FreestyleProgressSegment[],
  today: string,
): string {
  const base = progressSegmentHoverLabel(segment, index, segments.length, today)
  if (!segment.enteredOn) return base
  const left = dayRemainingCount(segments, segment.enteredOn)
  return `${base} · ${left > 0 ? `这天还剩 ${left} 张` : '这天都过了'}`
}

function DayCut({
  label,
  onJump,
}: {
  label: string
  onJump: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="freestyle-progress-day-line"
          aria-label={label}
          className="relative z-10 flex h-full w-3 shrink-0 items-stretch justify-center"
          onClick={(event) => {
            event.stopPropagation()
            onJump()
          }}
        >
          <span
            aria-hidden
            className="progress-boundary-enter h-full w-[3px] rounded-full bg-stage-ink shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function FreestyleProgressRail({
  summary,
  onOpenPlan,
  onJump,
  overflow,
  workspaceSwitcher,
  scrollChannel,
  today,
}: {
  summary: FreestyleProgressSummary
  onOpenPlan: () => void
  /** Jump the feed to this tick. Absent callers keep the whole-rail plan opener. */
  onJump?: (cardId: string) => void
  /** Overflow menu trigger + content, owned by the page. */
  overflow?: ReactNode
  workspaceSwitcher?: ReactNode
  /** Continuous feed position; the glider tracks the finger while it moves. */
  scrollChannel?: FreestyleScrollChannel
  /** Wall-clock day the labels speak from. Tests pass a fixed day. */
  today?: string
}) {
  const labelToday = today || formatLocalDateKey(new Date())
  const canJump = Boolean(onJump) && summary.total > 0 && summary.segments.length > 0
  const daySpan = roundDaySpan(summary.segments.map((segment) => segment.enteredOn), labelToday)
  const railLabel = daySpan > 1
    ? `${progressRailLabel(summary, canJump)}这一轮跨了 ${daySpan} 天。`
    : progressRailLabel(summary, canJump)
  const hudText = progressHudText(summary)
  const railRef = useRef<HTMLDivElement>(null)
  const gliderRef = useRef<HTMLSpanElement>(null)
  const [railWidth, setRailWidth] = useState(0)
  const [sheens, setSheens] = useState<RailSheen[]>([])
  const [roundGlow, setRoundGlow] = useState(false)
  const [insertedIds, setInsertedIds] = useState<ReadonlySet<string>>(() => new Set())
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const segments = summary.segments
  const viewingId = segments.find((segment) => segment.viewing || segment.tone === 'current')?.cardId ?? null
  const idsKey = segments.map((segment) => segment.cardId).join('\u0000')
  const donePalaceKey = [...new Set(
    segments.filter((segment) => segment.palaceDone).map((segment) => String(segment.palaceId)),
  )].sort().join(',')
  const roundDone = segments.length > 0 && segments.every((segment) => segment.tone === 'done')

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      fn()
    }, ms)
    timersRef.current.add(id)
  }

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  /** Finger-follow state: while active the glider is driven by scroll frames, not the comet. */
  const followActiveRef = useRef(false)
  const followArrivalRef = useRef<{ cardId: string; at: number } | null>(null)
  const slotRectsRef = useRef<Map<string, SlotRect> | null>(null)

  // Comet: slides from the previous playhead to the new one while the widths trade places.
  const prevViewingIdRef = useRef(viewingId)
  useLayoutEffect(() => {
    const prevId = prevViewingIdRef.current
    prevViewingIdRef.current = viewingId
    // Slot widths trade places on a playhead change; the follow cache must re-measure.
    slotRectsRef.current = null
    const rail = railRef.current
    const glider = gliderRef.current
    if (!rail || !glider || !prevId || !viewingId || prevId === viewingId) return
    if (prefersReducedMotion()) return
    // The finger already carried the glider here: replaying the comet would jump back.
    if (followActiveRef.current) return
    const arrival = followArrivalRef.current
    if (arrival && arrival.cardId === viewingId && performance.now() - arrival.at < FOLLOW_ARRIVAL_WINDOW_MS) {
      followArrivalRef.current = null
      return
    }
    const from = railSlot(rail, prevId)
    const to = railSlot(rail, viewingId)
    if (!from || !to) return
    const railLeft = rail.getBoundingClientRect().left
    const fromRect = from.getBoundingClientRect()
    const fromLeft = fromRect.left - railLeft
    const fromRight = fromRect.right - railLeft
    const forward = Boolean(from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING)
    glider.dataset.direction = forward ? 'forward' : 'backward'
    glider.classList.remove('progress-glider-run', 'progress-glider-follow', 'progress-glider-release')
    void glider.offsetWidth
    glider.classList.add('progress-glider-run')

    const start = performance.now()
    let frame = 0
    // Same clock as `start`: the rAF timestamp can predate it or use another origin.
    const step = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / GLIDER_MS))
      // Re-measure every frame: the target is still growing via the flex-grow transition.
      const toRect = to.getBoundingClientRect()
      const toLeft = toRect.left - railLeft
      const toRight = toRect.right - railLeft
      // Leading edge races ahead, trailing edge catches up: reads as a comet, not a block.
      const head = easeOutCubic(t)
      const tail = easeInOutCubic(t)
      const left = forward
        ? fromLeft + (toLeft - fromLeft) * tail
        : fromLeft + (toLeft - fromLeft) * head
      const right = forward
        ? fromRight + (toRight - fromRight) * head
        : fromRight + (toRight - fromRight) * tail
      glider.style.transform = `translateX(${left}px)`
      glider.style.width = `${Math.max(2, right - left)}px`
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [viewingId])

  // Palace clear / round clear: one light band sweeps over the range that just finished.
  const prevDonePalaceKeyRef = useRef<string | null>(null)
  const prevRoundDoneRef = useRef(roundDone)
  useLayoutEffect(() => {
    const prevKey = prevDonePalaceKeyRef.current
    const prevRoundDone = prevRoundDoneRef.current
    prevDonePalaceKeyRef.current = donePalaceKey
    prevRoundDoneRef.current = roundDone
    const rail = railRef.current
    if (prevKey == null || !rail || prefersReducedMotion()) return
    if (roundDone && !prevRoundDone) {
      const railRect = rail.getBoundingClientRect()
      const id = `round-${performance.now()}`
      setSheens((list) => [...list, { id, kind: 'round', left: 0, width: railRect.width }])
      setRoundGlow(true)
      later(() => setSheens((list) => list.filter((sheen) => sheen.id !== id)), PALACE_LEAD_MS + ROUND_SHEEN_MS + 50)
      later(() => setRoundGlow(false), PALACE_LEAD_MS + ROUND_GLOW_MS + 50)
      return
    }
    const before = new Set(prevKey ? prevKey.split(',') : [])
    const cleared = donePalaceKey
      ? donePalaceKey.split(',').filter((palace) => palace && !before.has(palace))
      : []
    if (!cleared.length) return
    const ranges = clearedPalaceRanges(rail, new Set(cleared))
    if (!ranges.length) return
    const stamp = performance.now()
    const added = ranges.map((range, index) => ({ id: `palace-${stamp}-${index}`, kind: 'palace' as const, ...range }))
    const addedIds = new Set(added.map((sheen) => sheen.id))
    setSheens((list) => [...list, ...added])
    later(() => setSheens((list) => list.filter((sheen) => !addedIds.has(sheen.id))), PALACE_LEAD_MS + PALACE_SHEEN_MS + 50)
  }, [donePalaceKey, roundDone])

  // Retry insertion: ids that appear in an already-drawn rail squeeze in instead of fading in.
  const seenIdsRef = useRef<Set<string> | null>(null)
  useLayoutEffect(() => {
    const ids = idsKey ? idsKey.split('\u0000') : []
    const seen = seenIdsRef.current
    seenIdsRef.current = new Set(ids)
    if (!seen || seen.size === 0 || prefersReducedMotion()) return
    const fresh = ids.filter((id) => !seen.has(id))
    if (!fresh.length || fresh.length > INSERT_BATCH_LIMIT) return
    setInsertedIds((current) => new Set([...current, ...fresh]))
    later(() => setInsertedIds((current) => {
      const next = new Set(current)
      fresh.forEach((id) => next.delete(id))
      return next
    }), INSERT_MS)
  }, [idsKey])
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

  // Rect cache: one layout read per invalidation, never per scroll frame.
  useLayoutEffect(() => {
    slotRectsRef.current = null
  }, [idsKey, railWidth, compact])

  // Finger-follow: the glider interpolates between the leaving and entering tick.
  useEffect(() => {
    if (!scrollChannel) return
    let frame = 0
    let pending: FreestyleScrollFrame | null = null
    let lastLeft: number | null = null
    const styled = new Set<HTMLElement>()

    const clearHandOver = () => {
      styled.forEach((node) => {
        node.style.removeProperty('--fs-follow')
        delete node.dataset.follow
      })
      styled.clear()
    }

    const release = (arrivedCardId: string | null) => {
      if (!followActiveRef.current) return
      followActiveRef.current = false
      lastLeft = null
      clearHandOver()
      if (arrivedCardId) followArrivalRef.current = { cardId: arrivedCardId, at: performance.now() }
      const glider = gliderRef.current
      if (!glider) return
      glider.classList.remove('progress-glider-follow')
      glider.classList.add('progress-glider-release')
    }

    const rects = () => {
      const rail = railRef.current
      if (!rail) return null
      if (!slotRectsRef.current) slotRectsRef.current = measureRailSlots(rail)
      return slotRectsRef.current
    }

    const apply = (next: FreestyleScrollFrame) => {
      if (next.settled || next.t >= 1) {
        release(next.t >= 0.5 ? next.toCardId ?? next.fromCardId : next.fromCardId)
        return
      }
      const glider = gliderRef.current
      const map = rects()
      if (!glider || !map || !next.fromCardId) return
      const from = map.get(next.fromCardId)
      const to = next.toCardId ? map.get(next.toCardId) : undefined
      // t=0 mid-gesture (or an unresolvable neighbour) holds on the leaving tick.
      const t = to ? Math.min(1, Math.max(0, next.t)) : 0
      if (!from) return
      const target = to ?? from
      const left = from.left + (target.left - from.left) * t
      const right = from.right + (target.right - from.right) * t
      const width = Math.max(2, right - left)

      if (!followActiveRef.current) {
        followActiveRef.current = true
        followArrivalRef.current = null
        glider.classList.remove('progress-glider-run', 'progress-glider-release')
        glider.classList.add('progress-glider-follow')
        glider.style.width = `${FOLLOW_BASE_WIDTH}px`
      }
      if (lastLeft != null && Math.abs(left - lastLeft) > 0.5) {
        glider.dataset.direction = left > lastLeft ? 'forward' : 'backward'
      }
      lastLeft = left
      glider.style.transform = `translateX(${left}px) scaleX(${width / FOLLOW_BASE_WIDTH})`

      clearHandOver()
      from.node.dataset.follow = 'from'
      from.node.style.setProperty('--fs-follow', String(1 - t))
      styled.add(from.node)
      if (to && to.node !== from.node) {
        to.node.dataset.follow = 'to'
        to.node.style.setProperty('--fs-follow', String(t))
        styled.add(to.node)
      }
    }

    // Flag rather than the rAF id: a synchronous rAF would clear it before the id is assigned.
    let scheduled = false
    const unsubscribe = scrollChannel.subscribe((next) => {
      pending = next
      if (scheduled) return
      scheduled = true
      frame = requestAnimationFrame(() => {
        scheduled = false
        frame = 0
        const latest = pending
        pending = null
        if (latest) apply(latest)
      })
    })
    return () => {
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
      clearHandOver()
      followActiveRef.current = false
    }
  }, [scrollChannel])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {/* Round progress: one segment per card, so restudy re-insertion is visible.
          TooltipProvider lives on ImmersiveFreestylePage — nesting another here
          loops Radix DropdownMenuTrigger refs under Vite. */}
      <div
        ref={railRef}
        data-testid="freestyle-progress-rail" data-fx-anchor={FX_ANCHORS.progressRail}
        data-compact={compact ? 'true' : 'false'}
        role={canJump ? 'group' : 'img'}
        aria-label={railLabel}
        className={cn(
          'pointer-events-auto relative flex h-7 w-full min-w-0 cursor-pointer items-end overflow-hidden bg-stage/60 px-0 pb-1 pt-[max(0px,env(safe-area-inset-top,0px))]',
          compact ? 'gap-0' : 'gap-px',
          roundGlow && 'progress-round-glow',
        )}
        style={roundGlow ? { animationDelay: `${PALACE_LEAD_MS}ms` } : undefined}
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          if (!onJump || !railRef.current) {
            onOpenPlan()
            return
          }
          const cardId = cardIdAtRailPointer(railRef.current, event)
          if (!cardId) {
            onOpenPlan()
            return
          }
          onJump(cardId)
        }}
      >
        {segments.length === 0 ? (
          <span className="ma-skeleton h-1.5 w-full rounded-[1px] [--color-muted:hsl(34_30%_80%/0.18)]" aria-hidden />
        ) : (
          segments.map((segment, index) => (
            <Fragment key={segment.cardId}>
              {segment.cohortBoundary ? (
                <DayCut
                  label={dayCutHoverLabel(
                    segment.enteredOn,
                    labelToday,
                    dayRemainingCount(segments, segment.enteredOn || ''),
                  )}
                  onJump={() => onJump?.(segment.cardId)}
                />
              ) : null}
              <ProgressRailItem
                segment={segment}
                hoverLabel={segmentHoverLabel(segment, index, segments, labelToday)}
                palaceStaggerIndex={palaceStaggerIndex(segments, index)}
                palaceGap={
                  index > 0 && segments[index - 1]?.palaceId !== segment.palaceId
                }
                showRetryCount={progressRailRetryCountVisible(segments, index, railWidth)}
                compact={compact}
                inserted={segment.kind === 'retry' && insertedIds.has(segment.cardId)}
              />
            </Fragment>
          ))
        )}
        <span ref={gliderRef} aria-hidden data-testid="freestyle-progress-glider" className="progress-glider" />
        {sheens.map((sheen) => (
          <span
            key={sheen.id}
            aria-hidden
            data-testid="freestyle-progress-sheen"
            data-kind={sheen.kind}
            className="progress-sheen"
            style={{ left: sheen.left, width: sheen.width, animationDelay: `${PALACE_LEAD_MS}ms` }}
          />
        ))}
      </div>

      <div className="flex items-start justify-between gap-1 px-2 pt-1 sm:px-3">
        <div className="mt-0.5 flex min-w-0 max-w-[72%] items-center gap-1">
          {workspaceSwitcher}
          {hudText ? (
            <button
              type="button"
              data-testid="freestyle-progress-hud"
              className="pointer-events-auto truncate rounded-full px-2 py-1 text-left text-[11px] font-medium tabular-nums text-stage-ink/88 transition-colors hover:text-stage-glow"
              aria-label={daySpan > 1 ? `${hudText}，这一轮跨了 ${daySpan} 天，打开本轮安排` : `${hudText}，打开本轮安排`}
              onClick={onOpenPlan}
            >
              {hudText}
              {daySpan > 1 ? (
                <span className="ml-1 font-normal text-stage-muted">跨了 {daySpan} 天</span>
              ) : null}
            </button>
          ) : null}
        </div>
        {overflow ? (
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-stage-line bg-stage-overlay px-1 py-0.5 shadow-[0_10px_30px_-8px_rgb(0_0_0/0.55)]">
            {overflow}
          </div>
        ) : null}
      </div>
    </div>
  )
}
