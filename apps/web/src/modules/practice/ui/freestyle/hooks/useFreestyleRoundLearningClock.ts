import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  addFreestyleLearningSeconds,
  classifyFreestyleLearningSurface,
  emptyFreestyleLearningTime,
  parseFreestyleLearningTime,
  type FreestyleLearningBucket,
  type FreestyleRoundLearningTime,
} from '@/modules/practice/domain/freestyleLearningTime'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import {
  acknowledgeFreestyleLearningBatch,
  beginFreestyleLearningBatch,
  emptyFreestyleLearningOutbox,
  enqueueFreestyleLearningInterval,
  migrateLegacyFreestylePending,
  outboxLearningTime,
  parseFreestyleLearningOutbox,
  serializeFreestyleLearningOutbox,
  type FreestyleLearningOutboxState,
} from '@/modules/practice/application/freestyleLearningOutbox'
import {
  accumulateFreestyleLearningTimeApi,
  backfillFreestyleLearningTimeApi,
} from '@/modules/practice/ui/freestyle/api/freestyleApi'
import {
  isPassiveLiveStudyFollower,
  peekDwellFragmentOverride,
  subscribeDwellFragmentOverrides,
  useLiveStudyPresence,
} from '@/modules/session/public'
import { detectClientSource } from '@/shared/lib/clientSource'
import type { FreestyleLearningInterval, FreestyleRoundStatePayload } from '@/shared/api/contracts'

const PENDING_PREFIX = 'memory-anki.freestyle.round-learning-pending.v1:'
const OUTBOX_PREFIX = 'memory-anki.freestyle.round-learning-outbox.v2:'
const ACK_PREFIX = 'memory-anki.freestyle.round-learning-backfill-acked.v1:'
const PLACEHOLDER_ROUND_ID = 'freestyle-round-default'
const TICK_MS = 1000
const FLUSH_MS = 15_000
const RETRY_MS = 30_000
const MAX_TICK_GAP_MS = 2000
const MAX_INTERVAL_SECONDS = 12 * 60 * 60

interface OpenInterval {
  intervalId: string
  bucket: FreestyleLearningBucket
  palaceId: number | null
  startedAtMs: number
  seconds: number
  lastWallMs: number
}

function isRealRound(roundId: string) {
  const id = String(roundId || '').trim()
  return id.length > 0 && id !== PLACEHOLDER_ROUND_ID
}

function pendingKey(roundId: string) {
  return `${PENDING_PREFIX}${roundId}`
}

function outboxKey(roundId: string) {
  return `${OUTBOX_PREFIX}${roundId}`
}

function ackKey(roundId: string) {
  return `${ACK_PREFIX}${roundId}`
}

function readPending(roundId: string) {
  try {
    const raw = window.localStorage.getItem(pendingKey(roundId))
    return raw ? parseFreestyleLearningTime(JSON.parse(raw)) : emptyFreestyleLearningTime()
  } catch {
    return emptyFreestyleLearningTime()
  }
}

function writePending(roundId: string, time: FreestyleRoundLearningTime) {
  try {
    const empty = !time.unitSeconds && !time.quizSeconds && !time.lookupSeconds
    if (empty) window.localStorage.removeItem(pendingKey(roundId))
    else window.localStorage.setItem(pendingKey(roundId), JSON.stringify(time))
  } catch {
    // Quota or private mode: the in-memory buffer still covers this visit.
  }
}

function readOutbox(roundId: string) {
  const fallback = emptyFreestyleLearningOutbox(createOperationId())
  try {
    const raw = window.localStorage.getItem(outboxKey(roundId))
    return raw ? parseFreestyleLearningOutbox(JSON.parse(raw), fallback.backfillOperationId) : fallback
  } catch {
    return fallback
  }
}

function writeOutbox(roundId: string, state: FreestyleLearningOutboxState) {
  try {
    window.localStorage.setItem(outboxKey(roundId), serializeFreestyleLearningOutbox(state))
  } catch {
    // The in-memory outbox still retries during this visit.
  }
}

function readAck(roundId: string) {
  try {
    return window.localStorage.getItem(ackKey(roundId)) === '1'
  } catch {
    return false
  }
}

function writeAck(roundId: string) {
  try {
    window.localStorage.setItem(ackKey(roundId), '1')
  } catch {
    // A later visit retries the same backfill operation id.
  }
}

function subscribePageVisibility(listener: () => void) {
  const onChange = () => listener()
  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
  }
}

function readPageVisible() {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function planVersionOf(round: { plan_version?: number, version?: number } | null | undefined) {
  return Math.max(0, Math.round(Number(round?.plan_version ?? round?.version) || 0))
}

function closeInterval(open: OpenInterval | null, roundId: string): FreestyleLearningInterval | null {
  if (!open || open.seconds < 1) return null
  const started = new Date(open.startedAtMs)
  const ended = new Date(open.startedAtMs + Math.min(open.seconds, MAX_INTERVAL_SECONDS) * 1000)
  return {
    interval_id: open.intervalId,
    session_id: roundId,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    bucket: open.bucket,
    palace_id: open.palaceId,
    client_source: detectClientSource(),
  }
}

export function useFreestyleRoundLearningClock(input: {
  roundId: string
  planVersion: number
  adoptRoundVersion: (round: {
    plan_version?: number
    version?: number
    conflict?: boolean
  } | null | undefined) => void
  isActive: boolean
  viewingCard: boolean
  cardPalaceId: number | null
  /** Settlement is on screen: publish the live total and flush. */
  publishLive: boolean
}) {
  const presence = useLiveStudyPresence()
  const follower = presence
    ? isPassiveLiveStudyFollower({
      isController: presence.isController,
      controllerClientId: presence.projection.controllerClientId,
      remoteSurface: presence.projection.surface,
      localSurface: 'freestyle',
    })
    : false
  const override = useSyncExternalStore(
    subscribeDwellFragmentOverrides,
    peekDwellFragmentOverride,
    () => null,
  )
  const pageVisible = useSyncExternalStore(subscribePageVisibility, readPageVisible, () => false)
  const surface = classifyFreestyleLearningSurface({
    visible: input.isActive && pageVisible && !follower,
    viewingCard: input.viewingCard,
    scene: override?.scene ?? 'freestyle',
    title: override?.title ?? null,
  })
  const palaceId = surface === 'unit' ? input.cardPalaceId : (override?.palaceId ?? null)
  const [learningTime, setLearningTime] = useState<FreestyleRoundLearningTime>(emptyFreestyleLearningTime)
  const [ready, setReady] = useState(false)
  const surfaceRef = useRef<FreestyleLearningBucket | null>(surface)
  const palaceRef = useRef<number | null>(palaceId)
  const planVersionRef = useRef(input.planVersion)
  const adoptRef = useRef(input.adoptRoundVersion)
  const publishLiveRef = useRef(input.publishLive)
  const flushRef = useRef<() => Promise<void>>(async () => undefined)
  const publishRef = useRef<() => void>(() => undefined)
  surfaceRef.current = surface
  palaceRef.current = palaceId
  planVersionRef.current = input.planVersion
  adoptRef.current = input.adoptRoundVersion
  publishLiveRef.current = input.publishLive

  useEffect(() => {
    if (!isRealRound(input.roundId)) {
      setReady(false)
      setLearningTime(emptyFreestyleLearningTime())
      flushRef.current = async () => undefined
      publishRef.current = () => undefined
      return
    }
    const roundId = input.roundId
    let cancelled = false
    let retryTimer = 0
    let flushing = false
    let outbox = readOutbox(roundId)
    let open: OpenInterval | null = null
    const canFlushRef = { current: readAck(roundId) }
    const canTickRef = { current: false }

    if (!outbox.migratedV1) {
      const legacy = migrateLegacyFreestylePending(readPending(roundId))
      outbox = {
        ...outbox,
        legacyAdds: legacy.length ? [...outbox.legacyAdds, ...legacy] : outbox.legacyAdds,
        migratedV1: true,
      }
      writeOutbox(roundId, outbox)
      writePending(roundId, emptyFreestyleLearningTime())
    }
    if (planVersionRef.current > outbox.expectedVersion) {
      outbox.expectedVersion = planVersionRef.current
      writeOutbox(roundId, outbox)
    }

    const project = () => {
      let time = outboxLearningTime(outbox)
      if (open && open.seconds > 0) {
        time = addFreestyleLearningSeconds(time, open.bucket, open.seconds, open.palaceId)
      }
      return time
    }
    const publish = () => {
      if (cancelled) return
      setLearningTime(project())
      setReady(true)
    }
    publishRef.current = publish

    const sealOpen = () => {
      const interval = closeInterval(open, roundId)
      open = null
      if (!interval) return
      outbox = enqueueFreestyleLearningInterval(outbox, interval)
      writeOutbox(roundId, outbox)
    }

    const flush = async () => {
      sealOpen()
      if (!canFlushRef.current || flushing) return
      if (!outbox.inflight) {
        outbox = beginFreestyleLearningBatch(outbox, createOperationId())
        if (!outbox.inflight) return
        writeOutbox(roundId, outbox)
      }
      const batch = outbox.inflight
      flushing = true
      try {
        const response = await accumulateFreestyleLearningTimeApi(roundId, {
          operation_id: batch.operationId,
          expected_version: outbox.expectedVersion || planVersionRef.current,
          intervals: batch.intervals,
          adds: batch.adds,
        })
        adoptRef.current(response)
        const version = planVersionOf(response)
        if (version > outbox.expectedVersion) outbox.expectedVersion = version
        if (response.conflict) {
          writeOutbox(roundId, outbox)
          return
        }
        outbox = acknowledgeFreestyleLearningBatch(outbox, batch.operationId)
        outbox.baseline = parseFreestyleLearningTime(response.plan?.learning_time)
        writeOutbox(roundId, outbox)
        publish()
      } catch {
        // The same operation id retries, so a lost response cannot add the slice twice.
      } finally {
        flushing = false
      }
    }
    flushRef.current = flush

    const settleBackfill = (response: FreestyleRoundStatePayload) => {
      adoptRef.current(response)
      const version = planVersionOf(response)
      if (version > outbox.expectedVersion) outbox.expectedVersion = version
      outbox.baseline = parseFreestyleLearningTime(response.plan?.learning_time)
      if (response.learning_backfill_applied === true) {
        writeAck(roundId)
      }
      canFlushRef.current = outbox.baseline.backfilled || readAck(roundId)
      canTickRef.current = true
      writeOutbox(roundId, outbox)
      publish()
    }

    const runBackfill = async () => {
      try {
        let response = await backfillFreestyleLearningTimeApi(roundId, {
          operation_id: outbox.backfillOperationId,
          expected_version: outbox.expectedVersion || planVersionRef.current,
        })
        if (response.conflict) {
          adoptRef.current(response)
          const version = planVersionOf(response)
          if (version > outbox.expectedVersion) outbox.expectedVersion = version
          response = await backfillFreestyleLearningTimeApi(roundId, {
            operation_id: outbox.backfillOperationId,
            expected_version: version || planVersionRef.current,
          })
        }
        if (cancelled) return
        if (response.conflict) throw new Error('freestyle learning backfill conflict')
        settleBackfill(response)
      } catch {
        if (cancelled) return
        canTickRef.current = true
        canFlushRef.current = readAck(roundId)
        publish()
        retryTimer = window.setTimeout(() => {
          if (!cancelled) void runBackfill()
        }, RETRY_MS)
      }
    }

    void runBackfill()
    const tickTimer = window.setInterval(() => {
      if (!canTickRef.current) return
      const bucket = surfaceRef.current
      const now = Date.now()
      if (!bucket) {
        sealOpen()
        return
      }
      const palace = palaceRef.current
      const changed = !open || open.bucket !== bucket || open.palaceId !== palace
      const stalled = open != null && now - open.lastWallMs > MAX_TICK_GAP_MS
      if (changed || stalled || (open && open.seconds >= MAX_INTERVAL_SECONDS)) {
        sealOpen()
        open = {
          intervalId: createOperationId(),
          bucket,
          palaceId: palace,
          startedAtMs: now,
          seconds: 0,
          lastWallMs: now,
        }
      }
      if (!open) return
      open.seconds += 1
      open.lastWallMs = now
      if (publishLiveRef.current) publish()
    }, TICK_MS)
    const flushTimer = window.setInterval(() => {
      void flush()
    }, FLUSH_MS)
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => {
      void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      cancelled = true
      window.clearInterval(tickTimer)
      window.clearInterval(flushTimer)
      window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [input.roundId])

  useEffect(() => {
    if (!input.publishLive) return
    publishRef.current()
    void flushRef.current()
  }, [input.publishLive, input.roundId])

  return {
    learningTime,
    ready,
    flush: () => flushRef.current(),
  }
}
