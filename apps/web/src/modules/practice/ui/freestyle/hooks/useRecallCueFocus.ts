import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { openPlayback } from '@/shared/fx'
import { recallCueMaxLevel } from '@/shared/ui/mindmap-canvas/recallCueLadder'
import { listRecallCueCandidates, type RecallCueNode } from '../model/recallCueTarget'
import { appendRecallCueLog } from '../model/recallCueLog'

/** Stuck for this long on the same card before a cue is offered. */
export const RECALL_IDLE_MS = 6000

export interface RecallCueView {
  /** The node the bubble is attached to. */
  uid: string
  text: string
  level: number
  maxLevel: number
}

/** Finds a rendered react-flow node by id inside the map host. */
export function findMapNodeElement(host: HTMLElement | null, uid: string): HTMLElement | null {
  if (!host) return null
  const nodes = host.querySelectorAll<HTMLElement>('.react-flow__node')
  for (const node of Array.from(nodes)) {
    if (node.dataset.id === uid) return node
  }
  return null
}

/**
 * The candidate closest to where the learner is looking; with no pointer yet,
 * the first visible candidate in level order.
 */
export function pickNearestCandidate(
  host: HTMLElement | null,
  candidates: readonly RecallCueNode[],
  focus: { x: number; y: number } | null,
): string | null {
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const el = findMapNodeElement(host, candidate.id)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    if (!focus) return candidate.id
    const distance = Math.hypot(rect.left + rect.width / 2 - focus.x, rect.top + rect.height / 2 - focus.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate.id
    }
  }
  return best
}

/**
 * Focus-anchored recall cue. Watches where the learner points inside the map; after
 * RECALL_IDLE_MS without any press, a cue bubble opens beside the nearest hidden card.
 * Each step is logged on this device only and never touches the rating.
 */
export function useRecallCueFocus(args: {
  hostRef: RefObject<HTMLElement | null>
  root: RecallCueNode | null
  revealMap: Record<string, string>
  allowedNodeIds: ReadonlySet<string> | null
  enabled: boolean
  cardKey: string
}) {
  const { hostRef, root, revealMap, allowedNodeIds, enabled, cardKey } = args
  const candidates = useMemo(
    () => listRecallCueCandidates(root, revealMap, allowedNodeIds),
    [root, revealMap, allowedNodeIds],
  )
  const focusRef = useRef<{ x: number; y: number } | null>(null)
  // Any press inside the map resets the wait: the learner is still moving.
  const [activity, setActivity] = useState(0)
  const [ready, setReady] = useState<{ uid: string } | null>(null)
  const [levels, setLevels] = useState<{ key: string; byUid: Record<string, number> }>({ key: cardKey, byUid: {} })

  useEffect(() => {
    const host = hostRef.current
    if (!host || !enabled) return
    const onMove = (event: PointerEvent) => {
      focusRef.current = { x: event.clientX, y: event.clientY }
    }
    const onPress = () => {
      setReady(null)
      setActivity((count) => count + 1)
    }
    host.addEventListener('pointermove', onMove, { passive: true })
    host.addEventListener('pointerdown', onPress, true)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onPress, true)
    }
  }, [hostRef, enabled])

  useEffect(() => {
    if (!enabled || candidates.length === 0) return
    const playback = openPlayback(`recall:${cardKey}`)
    playback.at(RECALL_IDLE_MS, () => {
      const uid = pickNearestCandidate(hostRef.current, candidates, focusRef.current)
      if (uid) setReady({ uid })
    })
    playback.finish()
    return () => playback.cancel()
  }, [cardKey, candidates, enabled, hostRef, activity])

  const view = useMemo<RecallCueView | null>(() => {
    if (!ready) return null
    const candidate = candidates.find((item) => item.id === ready.uid)
    if (!candidate) return null
    const level = levels.key === cardKey ? levels.byUid[candidate.id] ?? 0 : 0
    return { uid: candidate.id, text: candidate.text, level, maxLevel: recallCueMaxLevel(candidate.text) }
  }, [cardKey, candidates, levels, ready])

  /** Advances the ladder one step and returns the new level, or 0 when nothing changed. */
  const step = useCallback((): number => {
    if (!view || view.level >= view.maxLevel) return 0
    const level = view.level + 1
    setLevels((previous) => ({
      key: cardKey,
      byUid: { ...(previous.key === cardKey ? previous.byUid : {}), [view.uid]: level },
    }))
    appendRecallCueLog({ at: Date.now(), cardId: cardKey, nodeUid: view.uid, level })
    return level
  }, [cardKey, view])

  return { view, step }
}
