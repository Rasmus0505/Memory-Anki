import { useCallback, useEffect, useRef, useState } from 'react'
import type { FreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { FX_ANCHORS, cue, findAnchor } from '@/shared/fx'
import { PROGRESS_QUARTERS, crossedQuarter, freestyleMotionOn } from './freestyleFeedbackScenes'

const QUARTER_MIN_SEGMENTS = 8
const QUARTER_TAG_MS = 1600
const RETRY_DROP_DELAY_MS = 160
const RETRY_BATCH_LIMIT = 3

function railElement() {
  return findAnchor(FX_ANCHORS.progressRail)
}

/** Progress feedback on the round rail: a pop into each freshly inserted retry slot, and at 25/50/75% a rail pulse and a quarter tag. */
export function useProgressRailFeedback(segments: FreestyleProgressSummary['segments']) {
  const [quarterTag, setQuarterTag] = useState<{ label: string; nonce: number } | null>(null)
  const timers = useRef(new Set<number>())

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((id) => window.clearTimeout(id))
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }, [])

  const idsKey = segments.map((segment) => segment.cardId).join('\u0000')
  const seenIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = idsKey ? idsKey.split('\u0000') : []
    const seen = seenIdsRef.current
    seenIdsRef.current = new Set(ids)
    if (!seen || seen.size === 0) return
    const fresh = ids.filter((id) => !seen.has(id))
    if (!fresh.length || fresh.length > RETRY_BATCH_LIMIT) return
    later(() => fresh.forEach((id) => {
      const slot = railElement()?.querySelector(`[data-rail-slot="${CSS.escape(id)}"]`)
      if (slot) cue('retry.drop', { element: slot })
    }), RETRY_DROP_DELAY_MS)
  }, [idsKey, later])

  const doneCount = segments.filter((segment) => segment.tone === 'done').length
  const total = segments.length
  const ratioRef = useRef<number | null>(null)
  useEffect(() => {
    const ratio = total >= QUARTER_MIN_SEGMENTS ? doneCount / total : 0
    const previous = ratioRef.current
    ratioRef.current = ratio
    if (previous == null) return
    const crossed = crossedQuarter(previous, ratio)
    if (!crossed) return
    const step = PROGRESS_QUARTERS.indexOf(crossed.mark) + 1
    cue('progress.quarter', { rail: railElement(), step })
    if (!freestyleMotionOn()) return
    setQuarterTag((current) => ({ label: crossed.label, nonce: (current?.nonce ?? 0) + 1 }))
    later(() => setQuarterTag(null), QUARTER_TAG_MS)
  }, [doneCount, later, total])

  return quarterTag
}
