import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  addFreestyleLearningSeconds,
  classifyFreestyleLearningSurface,
  emptyFreestyleLearningTime,
  freestyleLearningAdds,
  mergeFreestyleLearningTime,
  parseFreestyleLearningTime,
  subtractFreestyleLearningTime,
  takeFreestyleLearningChunk,
  type FreestyleLearningBucket,
  type FreestyleRoundLearningTime,
} from '@/modules/practice/domain/freestyleLearningTime'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import {
  accumulateFreestyleLearningTimeApi,
  backfillFreestyleLearningTimeApi,
} from '@/modules/practice/ui/freestyle/api/freestyleApi'
import {
  peekDwellFragmentOverride,
  subscribeDwellFragmentOverrides,
} from '@/modules/session/public'
import type { FreestyleRoundStatePayload } from '@/shared/api/contracts'

const PENDING_PREFIX = 'memory-anki.freestyle.round-learning-pending.v1:'
const ACK_PREFIX = 'memory-anki.freestyle.round-learning-backfill-acked.v1:'
const PLACEHOLDER_ROUND_ID = 'freestyle-round-default'
const TICK_MS = 1000
const FLUSH_MS = 15_000
const RETRY_MS = 30_000
const FLUSH_CHUNK_SECONDS = 900

function isRealRound(roundId: string) {
  const id = String(roundId || '').trim()
  return id.length > 0 && id !== PLACEHOLDER_ROUND_ID
}

function pendingKey(roundId: string) {
  return `${PENDING_PREFIX}${roundId}`
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
    // The next backfill still discards overlapping pending when applied is true.
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
  const override = useSyncExternalStore(
    subscribeDwellFragmentOverrides,
    peekDwellFragmentOverride,
    () => null,
  )
  const pageVisible = useSyncExternalStore(subscribePageVisibility, readPageVisible, () => false)
  const surface = classifyFreestyleLearningSurface({
    visible: input.isActive && pageVisible,
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
    let attemptActive = false
    let attemptId = ''
    let attemptChunk = emptyFreestyleLearningTime()
    const pendingRef = { current: emptyFreestyleLearningTime() }
    const baselineRef = { current: emptyFreestyleLearningTime() }
    const canFlushRef = { current: false }
    const canTickRef = { current: false }

    const publish = () => {
      if (cancelled) return
      setLearningTime(mergeFreestyleLearningTime(baselineRef.current, pendingRef.current))
      setReady(true)
    }
    publishRef.current = publish

    const flush = async () => {
      if (!canFlushRef.current || flushing) return
      if (!attemptActive) {
        attemptChunk = takeFreestyleLearningChunk(pendingRef.current, FLUSH_CHUNK_SECONDS)
        if (freestyleLearningAdds(attemptChunk).length === 0) return
        attemptId = createOperationId()
        attemptActive = true
      }
      const adds = freestyleLearningAdds(attemptChunk)
      if (adds.length === 0) {
        attemptActive = false
        return
      }
      flushing = true
      try {
        const response = await accumulateFreestyleLearningTimeApi(roundId, {
          operation_id: attemptId,
          expected_version: planVersionRef.current,
          adds,
        })
        adoptRef.current(response)
        if (response.conflict) {
          attemptId = createOperationId()
          return
        }
        baselineRef.current = parseFreestyleLearningTime(response.plan?.learning_time)
        pendingRef.current = subtractFreestyleLearningTime(pendingRef.current, attemptChunk)
        attemptActive = false
        writePending(roundId, pendingRef.current)
        publish()
      } catch {
        // Same operation id retries, so a lost response cannot add the slice twice.
      } finally {
        flushing = false
      }
    }
    flushRef.current = flush

    const settleBackfill = (response: FreestyleRoundStatePayload) => {
      adoptRef.current(response)
      baselineRef.current = parseFreestyleLearningTime(response.plan?.learning_time)
      const applied = response.learning_backfill_applied === true
      if (applied || !readAck(roundId)) {
        pendingRef.current = emptyFreestyleLearningTime()
        writePending(roundId, pendingRef.current)
        writeAck(roundId)
      } else {
        pendingRef.current = readPending(roundId)
      }
      canFlushRef.current = baselineRef.current.backfilled
      canTickRef.current = true
      publish()
    }

    const runBackfill = async () => {
      try {
        let response = await backfillFreestyleLearningTimeApi(roundId, {
          operation_id: createOperationId(),
          expected_version: planVersionRef.current,
        })
        if (response.conflict) {
          adoptRef.current(response)
          response = await backfillFreestyleLearningTimeApi(roundId, {
            operation_id: createOperationId(),
            expected_version: response.plan_version || response.version || 0,
          })
        }
        if (cancelled) return
        if (response.conflict) throw new Error('freestyle learning backfill conflict')
        settleBackfill(response)
      } catch {
        if (cancelled) return
        pendingRef.current = mergeFreestyleLearningTime(pendingRef.current, readPending(roundId))
        canTickRef.current = true
        canFlushRef.current = false
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
      if (!bucket) return
      pendingRef.current = addFreestyleLearningSeconds(
        pendingRef.current,
        bucket,
        1,
        palaceRef.current,
      )
      writePending(roundId, pendingRef.current)
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
