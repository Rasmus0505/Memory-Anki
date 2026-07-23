import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMindMapSessionEventsApi } from '@/modules/content/public'
import { ratePalaceNodesApi, undoPalaceRatingApi, type RatingConflictPolicy } from '@/modules/practice/ui/review/api'
import type { MindMapRecallEvent, MindMapRecallRating, MindMapRecallRatingSource, MindMapRecallRound } from '@/shared/api/contracts'

function effectiveEvents(events: MindMapRecallEvent[]) {
  const superseded = new Set(events.map((event) => event.supersedes_event_id).filter(Boolean))
  return events.filter((event) => !superseded.has(event.id))
}

/**
 * Latest non-superseded event per node_uid + recall_round.
 * Matches backend `_session_latest_events_by_node` (order by occurred_at desc).
 */
function latestEventsByNodeRound(events: MindMapRecallEvent[]) {
  const latest = new Map<string, MindMapRecallEvent>()
  for (const event of effectiveEvents(events)) {
    const key = `${event.node_uid}:${event.recall_round}`
    const previous = latest.get(key)
    if (!previous || eventTime(event) >= eventTime(previous)) {
      latest.set(key, event)
    }
  }
  return latest
}

function eventTime(event: MindMapRecallEvent) {
  const stamp = Date.parse(event.occurred_at)
  return Number.isFinite(stamp) ? stamp : 0
}

function normalizeRating(rating: MindMapRecallEvent['rating']): MindMapRecallRating {
  return rating === 5 ? 3 : rating
}

function isDirectEvidence(event: MindMapRecallEvent) {
  // Legacy rows / optimistic gaps default to direct (same as DB server_default).
  return (event.evidence_origin ?? 'direct') === 'direct'
}

function makeOperationId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `rating_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

export interface RateNodeEvidence {
  source?: MindMapRecallRatingSource
  confidence?: number | null
  responseMs?: number | null
  hintCount?: number
  retryCount?: number
}

export interface RateNodeOptions {
  scope?: 'single' | 'subtree'
  conflictPolicy?: RatingConflictPolicy
  evidence?: RateNodeEvidence
}

export function useMindMapRecallRatings({
  palaceId,
  studySessionId,
  enabled,
  sourceScene = 'formal_review',
}: {
  palaceId: number | null
  studySessionId: string | null
  enabled: boolean
  sourceScene?: string
}) {
  const [events, setEvents] = useState<MindMapRecallEvent[]>([])
  const [round, setRound] = useState<MindMapRecallRound>('first')
  const [historyOpen, setHistoryOpen] = useState(false)

  // Session-scoped ratings must survive leaving/re-entering rating mode and
  // remounting the page. Only a new studySessionId (e.g. after 完成) starts empty.
  useEffect(() => {
    if (!enabled || !studySessionId) {
      setEvents([])
      return
    }
    let active = true
    void listMindMapSessionEventsApi(studySessionId)
      .then((response) => {
        if (active) setEvents(response.items)
      })
      .catch(() => {
        // Keep any in-memory events if reload fails so a flaky network does not
        // wipe ratings the user just recorded in this tab.
      })
    return () => {
      active = false
    }
  }, [enabled, studySessionId])

  const byKey = useMemo(() => latestEventsByNodeRound(events), [events])
  const currentEvents = useMemo(() => [...byKey.values()], [byKey])
  const firstRatings = useMemo(
    () =>
      new Map(
        currentEvents
          .filter((event) => event.recall_round === 'first')
          .map((event) => [event.node_uid, normalizeRating(event.rating)]),
      ),
    [currentEvents],
  )
  const retryRatings = useMemo(
    () =>
      new Map(
        currentEvents
          .filter((event) => event.recall_round === 'weak_retry')
          .map((event) => [event.node_uid, normalizeRating(event.rating)]),
      ),
    [currentEvents],
  )
  /** First-round 忘记 / 困难 nodes (scheduling / chips); does not drive flip state. */
  const weakNodeUids = useMemo(
    () =>
      [...firstRatings]
        .filter(([, rating]) => rating === 1 || rating === 2)
        .map(([uid]) => uid),
    [firstRatings],
  )
  /** Session chips: prefer weak_retry score when present, else first-round. */
  const displayRatings = useMemo(() => {
    const merged = new Map(firstRatings)
    retryRatings.forEach((rating, uid) => {
      merged.set(uid, rating)
    })
    return merged
  }, [firstRatings, retryRatings])

  /** Nodes with any latest effective event in the active round (direct or inherited). */
  const sessionRatedUids = useMemo(() => {
    const rated = new Set<string>()
    byKey.forEach((_event, key) => {
      const [uid, eventRound] = key.split(':')
      if (eventRound !== round || !uid) return
      rated.add(uid)
    })
    return rated
  }, [byKey, round])

  /** Nodes whose latest effective event in the active round is a direct rating. */
  const directRatedUids = useMemo(() => {
    const direct = new Set<string>()
    byKey.forEach((event, key) => {
      const [uid, eventRound] = key.split(':')
      if (eventRound !== round || !uid) return
      if (isDirectEvidence(event)) direct.add(uid)
    })
    return direct
  }, [byKey, round])

  const rateNode = useCallback(
    async (
      nodeUid: string,
      rating: MindMapRecallRating,
      targetRound: MindMapRecallRound = round,
      scope: 'single' | 'subtree' = 'subtree',
      evidence: RateNodeEvidence = {},
      conflictPolicy: RatingConflictPolicy = 'overwrite',
      /**
       * Full cascade targets from the rating tree (including deep grandchildren under
       * a single-child spine). Used for optimistic batch_inherited chips so UI does
       * not wait for the server list — and as a fallback if affected_node_uids is missing.
       */
      cascadeNodeUids?: string[],
    ) => {
      if (!enabled || !palaceId || !studySessionId) return
      const previous = byKey.get(`${nodeUid}:${targetRound}`) ?? null
      const operationId = makeOperationId()
      const optimisticBase = {
        study_session_id: studySessionId,
        palace_id: palaceId,
        source_scene: sourceScene,
        recall_round: targetRound,
        rating,
        rating_source: evidence.source ?? 'manual',
        rating_scope: scope,
        inference_confidence: evidence.source === 'inferred' ? evidence.confidence ?? 0.35 : null,
        response_ms: evidence.responseMs ?? null,
        hint_count: evidence.hintCount ?? 0,
        retry_count: evidence.retryCount ?? 0,
        operation_id: operationId,
        occurred_at: new Date().toISOString(),
      } as const
      const makeEvent = (
        uid: string,
        origin: 'direct' | 'batch_inherited',
        supersedes: string | null,
      ): MindMapRecallEvent => ({
        ...optimisticBase,
        id: `${operationId}:${uid}`.slice(0, 64),
        node_uid: uid,
        evidence_origin: origin,
        supersedes_event_id: supersedes,
      })
      const optimistic = makeEvent(nodeUid, 'direct', previous?.id ?? null)
      // Subtree: optimistically mark every known descendant (not only the parent).
      // Critical for P→single-child→multi-grandchildren: chips must follow all branches.
      const optimisticCascade =
        scope === 'subtree' && cascadeNodeUids && cascadeNodeUids.length > 0
          ? cascadeNodeUids
              .filter((uid) => uid !== nodeUid)
              .map((uid) => {
                const prior = byKey.get(`${uid}:${targetRound}`)
                return makeEvent(uid, 'batch_inherited', prior?.id ?? null)
              })
          : []
      setEvents((current) => [...current, optimistic, ...optimisticCascade])
      try {
        const response = await ratePalaceNodesApi(palaceId, {
          node_uid: nodeUid,
          rating,
          study_session_id: studySessionId,
          operation_id: operationId,
          rating_scope: scope,
          conflict_policy: conflictPolicy,
          source_scene: sourceScene,
          recall_round: targetRound,
          rating_source: evidence.source ?? 'manual',
          inference_confidence: evidence.confidence ?? null,
          response_ms: evidence.responseMs ?? null,
          hint_count: evidence.hintCount ?? 0,
          retry_count: evidence.retryCount ?? 0,
        })
        // Prefer server list; fall back to client cascade UIDs so deep spines still paint.
        const affected =
          response.item.affected_node_uids ??
          (scope === 'subtree' && cascadeNodeUids?.length
            ? cascadeNodeUids
            : [nodeUid])
        setEvents((current) => {
          const latest = latestEventsByNodeRound(current)
          // Drop this op's optimistic rows, then re-apply authoritative affected set.
          const withoutOp = current.filter((event) => event.operation_id !== operationId)
          const applied = affected.map((uid) => {
            const prior = latest.get(`${uid}:${targetRound}`)
            // Prefer prior outside this op (latest may still hold optimistic same-op rows).
            const supersedeId =
              prior && prior.operation_id !== operationId ? prior.id : prior?.supersedes_event_id ?? null
            return makeEvent(
              uid,
              uid === nodeUid ? 'direct' : 'batch_inherited',
              supersedeId,
            )
          })
          return [...withoutOp, ...applied]
        })
      } catch (error) {
        setEvents((current) => current.filter((event) => event.operation_id !== operationId))
        throw new Error(errorMessage(error, '节点评分保存失败'), { cause: error })
      }
      return operationId
    },
    [byKey, enabled, palaceId, round, sourceScene, studySessionId],
  )

  const undoLastRating = useCallback(() => {
    const latest =
      [...currentEvents]
        .sort((a, b) => eventTime(b) - eventTime(a))
        .find((event) => (event.evidence_origin ?? 'direct') !== 'batch_inherited') ??
      null
    if (latest && palaceId && studySessionId && latest.operation_id) {
      void undoPalaceRatingApi(palaceId, latest.operation_id, studySessionId).catch(() => {})
      setEvents((current) => current.filter((event) => event.operation_id !== latest.operation_id))
    }
    return latest
  }, [currentEvents, palaceId, studySessionId])

  return {
    events,
    currentEvents,
    firstRatings,
    retryRatings,
    displayRatings,
    weakNodeUids,
    sessionRatedUids,
    directRatedUids,
    round,
    setRound,
    rateNode,
    undoLastRating,
    historyOpen,
    setHistoryOpen,
  }
}
