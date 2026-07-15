import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMindMapSessionEventsApi } from '@/entities/mindmap-learning'
import { ratePalaceNodesApi, undoPalaceRatingApi } from '@/features/review/api'
import type { MindMapRecallEvent, MindMapRecallRating, MindMapRecallRatingSource, MindMapRecallRound } from '@/shared/api/contracts'

function effectiveEvents(events: MindMapRecallEvent[]) {
  const superseded = new Set(events.map((event) => event.supersedes_event_id).filter(Boolean))
  return events.filter((event) => !superseded.has(event.id))
}

function normalizeRating(rating: MindMapRecallEvent['rating']): MindMapRecallRating {
  return rating === 5 ? 3 : rating
}

function makeOperationId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `rating_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export interface RateNodeEvidence {
  source?: MindMapRecallRatingSource
  confidence?: number | null
  responseMs?: number | null
  hintCount?: number
  retryCount?: number
}

export function useMindMapRecallRatings({ palaceId, studySessionId, enabled, sourceScene = 'formal_review' }: { palaceId: number | null; studySessionId: string | null; enabled: boolean; sourceScene?: string }) {
  const [events, setEvents] = useState<MindMapRecallEvent[]>([])
  const [round, setRound] = useState<MindMapRecallRound>('first')
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (!enabled || !studySessionId) { setEvents([]); return }
    let active = true
    void listMindMapSessionEventsApi(studySessionId).then((response) => { if (active) setEvents(response.items) }).catch(() => {})
    return () => { active = false }
  }, [enabled, studySessionId])

  const currentEvents = useMemo(() => effectiveEvents(events), [events])
  const byKey = useMemo(() => new Map(currentEvents.map((event) => [`${event.node_uid}:${event.recall_round}`, event])), [currentEvents])
  const firstRatings = useMemo(() => new Map(currentEvents.filter((event) => event.recall_round === 'first').map((event) => [event.node_uid, normalizeRating(event.rating)])), [currentEvents])
  const retryRatings = useMemo(() => new Map(currentEvents.filter((event) => event.recall_round === 'weak_retry').map((event) => [event.node_uid, normalizeRating(event.rating)])), [currentEvents])
  const weakNodeUids = useMemo(() => [...firstRatings].filter(([, rating]) => rating === 1 || rating === 2).map(([uid]) => uid), [firstRatings])

  const rateNode = useCallback(async (nodeUid: string, rating: MindMapRecallRating, targetRound: MindMapRecallRound = round, scope: 'single' | 'subtree' = 'subtree', evidence: RateNodeEvidence = {}) => {
    if (!enabled || !palaceId || !studySessionId) return
    const previous = byKey.get(`${nodeUid}:${targetRound}`) ?? null
    const operationId = makeOperationId()
    const optimistic: MindMapRecallEvent = {
      id: `${operationId}:${nodeUid}`.slice(0, 64), study_session_id: studySessionId, palace_id: palaceId, node_uid: nodeUid,
      source_scene: sourceScene, recall_round: targetRound, rating, rating_source: evidence.source ?? 'manual',
      rating_scope: scope, evidence_origin: 'direct',
      inference_confidence: evidence.source === 'inferred' ? evidence.confidence ?? 0.35 : null,
      response_ms: evidence.responseMs ?? null, hint_count: evidence.hintCount ?? 0, retry_count: evidence.retryCount ?? 0,
      operation_id: operationId, occurred_at: new Date().toISOString(), supersedes_event_id: previous?.id ?? null,
    }
    setEvents((current) => [...current, optimistic])
    try {
      const response = await ratePalaceNodesApi(palaceId, { node_uid: nodeUid, rating, study_session_id: studySessionId, operation_id: operationId, rating_scope: scope, source_scene: sourceScene })
      const affected = response.item.affected_node_uids ?? [nodeUid]
      setEvents((current) => {
        const existingIds = new Set(current.filter((event) => event.operation_id === operationId).map((event) => event.node_uid))
        const inherited = affected.filter((uid) => !existingIds.has(uid)).map((uid) => ({
          ...optimistic,
          id: `${operationId}:${uid}`.slice(0, 64),
          node_uid: uid,
          rating_scope: scope,
          evidence_origin: (uid === nodeUid ? 'direct' : 'batch_inherited') as 'direct' | 'batch_inherited',
        }))
        return [...current, ...inherited]
      })
    } catch {
      setEvents((current) => current.filter((event) => event.id !== optimistic.id))
      throw new Error('节点评分保存失败')
    }
    return operationId
  }, [byKey, enabled, palaceId, round, sourceScene, studySessionId])

  const undoLastRating = useCallback(() => {
    const latest = [...currentEvents].reverse().find((event) => event.evidence_origin !== 'batch_inherited') ?? currentEvents.at(-1) ?? null
    if (latest && palaceId && studySessionId && latest.operation_id) {
      void undoPalaceRatingApi(palaceId, latest.operation_id, studySessionId).catch(() => {})
      setEvents((current) => current.filter((event) => event.operation_id !== latest.operation_id))
    }
    return latest
  }, [currentEvents, palaceId, studySessionId])

  return { events, currentEvents, firstRatings, retryRatings, weakNodeUids, round, setRound, rateNode, undoLastRating, historyOpen, setHistoryOpen }
}
