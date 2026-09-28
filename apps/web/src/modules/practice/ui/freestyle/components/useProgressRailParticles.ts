import { useCallback, useEffect, useRef, useState } from 'react'
import type { FreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { emitInkDrop, emitRailSparks, rectCenter } from '@/shared/feedback/particles'
import { crossedQuarter, elementPoint, flashElement, freestyleMotionOn } from './freestyleParticleScenes'

const QUARTER_MIN_SEGMENTS = 8
const QUARTER_TAG_MS = 1600
const RETRY_DROP_DELAY_MS = 160
const RETRY_BATCH_LIMIT = 3
const MAX_SPARK_SEGMENTS = 12

function railElement() {
  return document.querySelector('[data-testid="freestyle-progress-rail"]')
}

/**
 * Rail particle scenes: a coral drop into each freshly inserted retry slot, and at
 * 25/50/75% of the round a flash along the rail, sparks off lit segments and a tag.
 */
export function useProgressRailParticles(segments: FreestyleProgressSummary['segments']) {
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
    if (!seen || seen.size === 0 || !freestyleMotionOn()) return
    const fresh = ids.filter((id) => !seen.has(id))
    if (!fresh.length || fresh.length > RETRY_BATCH_LIMIT) return
    later(() => fresh.forEach((id) => {
      const slot = railElement()?.querySelector(`[data-rail-slot="${CSS.escape(id)}"]`)
      if (slot) emitInkDrop(() => elementPoint(slot))
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
    const rail = railElement()
    if (!crossed || !rail || !freestyleMotionOn()) return
    flashElement(rail, 1.8)
    const lit = Array.from(rail.querySelectorAll('[data-testid="freestyle-progress-segment"][data-tone="done"]'))
    const stride = Math.max(1, Math.ceil(lit.length / MAX_SPARK_SEGMENTS))
    emitRailSparks(lit.filter((_, index) => index % stride === 0).map((segment) => rectCenter(segment.getBoundingClientRect())))
    setQuarterTag((current) => ({ label: crossed.label, nonce: (current?.nonce ?? 0) + 1 }))
    later(() => setQuarterTag(null), QUARTER_TAG_MS)
  }, [doneCount, later, total])

  return quarterTag
}
