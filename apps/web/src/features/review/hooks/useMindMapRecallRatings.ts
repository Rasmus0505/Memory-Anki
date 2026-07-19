import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMindMapSessionEventsApi } from '@/entities/mindmap-learning'
import { ratePalaceNodesApi, undoPalaceRatingApi, type RatingConflictPolicy } from '@/features/review/api'
import type { MindMapRecallEvent, MindMapRecallRating, MindMapRecallRatingSource, MindMapRecallRound } from '@/shared/api/contracts'

function effectiveEvents(events: MindMapRecallEvent[]) {
  const superseded = new Set(events.map((event) => event.supersedes_event_id).filter(Boolean))
  return events.filter((event) => !superseded.has(event.id))
}

/**
 * Latest non-superseded event per node_uid + recall_round.
 * Matches backend `_session_direct_rated_uids` (order by occurred_at desc).
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
  const weakNodeUids = useMemo(
    () => [...firstRatings].filter(([, rating]) => rating === 1 || rating === 2).map(([uid]) => uid),
    [firstRatings],
  )

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
    ) => {
      if (!enabled || !palaceId || !studySessionId) return
      const previous = byKey.get(`${nodeUid}:${targetRound}`) ?? null
      const operationId = makeOperationId()
      const optimistic: MindMapRecallEvent = {
        id: `${operationId}:${nodeUid}`.slice(0, 64),
        study_session_id: studySessionId,
        palace_id: palaceId,
        node_uid: nodeUid,
        source_scene: sourceScene,
        recall_round: targetRound,
        rating,
        rating_source: evidence.source ?? 'manual',
        rating_scope: scope,
        evidence_origin: 'direct',
        inference_confidence: evidence.source === 'inferred' ? evidence.confidence ?? 0.35 : null,
        response_ms: evidence.responseMs ?? null,
        hint_count: evidence.hintCount ?? 0,
        retry_count: evidence.retryCount ?? 0,
        operation_id: operationId,
        occurred_at: new Date().toISOString(),
        supersedes_event_id: previous?.id ?? null,
      }
      setEvents((current) => [...current, optimistic])
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
        const affected = response.item.affected_node_uids ?? [nodeUid]
        setEvents((current) => {
          const latest = latestEventsByNodeRound(current)
          const existingForOp = new Set(
            current.filter((event) => event.operation_id === operationId).map((event) => event.node_uid),
          )
          const inherited = affected
            .filter((uid) => !existingForOp.has(uid))
            .map((uid) => {
              const prior = latest.get(`${uid}:${targetRound}`)
              return {
                ...optimistic,
                id: `${operationId}:${uid}`.slice(0, 64),
                node_uid: uid,
                rating_scope: scope,
                evidence_origin: (uid === nodeUid ? 'direct' : 'batch_inherited') as
                  | 'direct'
                  | 'batch_inherited',
                // Supersede prior event so latest-by-node stays consistent offline.
                supersedes_event_id: prior?.id ?? null,
              }
            })
          // When skip_direct, parent may be the only optimistic row; drop optimistic if not in affected.
          if (!affected.includes(nodeUid)) {
            return [
              ...current.filter((event) => event.id !== optimistic.id),
              ...inherited,
            ]
          }
          return [...current, ...inherited]
        })
      } catch (error) {
        setEvents((current) => current.filter((event) => event.id !== optimistic.id))
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
    weakNodeUids,
    directRatedUids,
    round,
    setRound,
    rateNode,
    undoLastRating,
    historyOpen,
    setHistoryOpen,
  }
}
