import { useCallback, useEffect, useMemo, useState } from 'react'
import { createMindMapRecallEventApi, listMindMapSessionEventsApi } from '@/entities/mindmap-learning'
import type { MindMapRecallEvent, MindMapRecallRating, MindMapRecallRound } from '@/shared/api/contracts'

function effectiveEvents(events: MindMapRecallEvent[]) {
  const superseded = new Set(events.map((event) => event.supersedes_event_id).filter(Boolean))
  return events.filter((event) => !superseded.has(event.id))
}

function makeEventId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `recall_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function useMindMapRecallRatings({ palaceId, studySessionId, enabled }: { palaceId: number | null; studySessionId: string | null; enabled: boolean }) {
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
  const firstRatings = useMemo(() => new Map(currentEvents.filter((event) => event.recall_round === 'first').map((event) => [event.node_uid, event.rating])), [currentEvents])
  const retryRatings = useMemo(() => new Map(currentEvents.filter((event) => event.recall_round === 'weak_retry').map((event) => [event.node_uid, event.rating])), [currentEvents])
  const weakNodeUids = useMemo(() => [...firstRatings].filter(([, rating]) => rating === 1 || rating === 3).map(([uid]) => uid), [firstRatings])

  const rateNode = useCallback(async (nodeUid: string, rating: MindMapRecallRating, targetRound: MindMapRecallRound = round) => {
    if (!enabled || !palaceId || !studySessionId) return
    const previous = byKey.get(`${nodeUid}:${targetRound}`) ?? null
    const optimistic: MindMapRecallEvent = {
      id: makeEventId(), study_session_id: studySessionId, palace_id: palaceId, node_uid: nodeUid,
      source_scene: 'formal_review', recall_round: targetRound, rating,
      occurred_at: new Date().toISOString(), supersedes_event_id: previous?.id ?? null,
    }
    setEvents((current) => [...current, optimistic])
    try {
      const response = await createMindMapRecallEventApi(optimistic)
      setEvents((current) => current.map((event) => event.id === optimistic.id ? response.item : event))
    } catch {
      setEvents((current) => current.filter((event) => event.id !== optimistic.id))
      throw new Error('节点评分保存失败')
    }
  }, [byKey, enabled, palaceId, round, studySessionId])

  return { events, currentEvents, firstRatings, retryRatings, weakNodeUids, round, setRound, rateNode, historyOpen, setHistoryOpen }
}
