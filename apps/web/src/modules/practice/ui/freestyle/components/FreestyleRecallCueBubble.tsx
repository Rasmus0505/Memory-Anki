import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cue } from '@/shared/fx'
import { cn } from '@/shared/lib/utils'
import { buildRecallCueText, recallCuePrefixLengths } from '@/shared/ui/mindmap-canvas/recallCueLadder'
import { findMapNodeElement, type RecallCueView } from '../hooks/useRecallCueFocus'

/**
 * The cue bubble beside the card the learner is stuck on.
 *
 * Only the 线索 button takes presses. The ladder text is click-through, so pressing
 * the card itself still flips it: the learner never has to hit a character box.
 */
export function FreestyleRecallCueBubble({
  hostRef,
  view,
  onStep,
  ownerKey,
}: {
  hostRef: RefObject<HTMLElement | null>
  view: RecallCueView | null
  /** Advances the ladder one step; returns the new level, or 0 when nothing changed. */
  onStep: () => number
  ownerKey: string
}) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const uid = view?.uid ?? null

  // Follow the node every frame while visible, so panning or zooming the map keeps the bubble attached.
  useEffect(() => {
    if (!uid) return
    let frame = 0
    const place = () => {
      const bubble = bubbleRef.current
      const node = findMapNodeElement(hostRef.current, uid)
      if (bubble && node) {
        const rect = node.getBoundingClientRect()
        const width = bubble.offsetWidth || 160
        const height = bubble.offsetHeight || 36
        let left = rect.right + 10
        if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 10)
        const top = Math.min(window.innerHeight - height - 8, Math.max(8, rect.top + rect.height / 2 - height / 2))
        bubble.style.transform = `translate(${left}px, ${top}px)`
      }
      frame = requestAnimationFrame(place)
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [hostRef, uid])

  // The bubble springs up once per node it attaches to.
  useEffect(() => {
    if (uid && bubbleRef.current) cue('recall.ready', { chip: bubbleRef.current }, { owner: ownerKey })
  }, [uid, ownerKey])

  if (!view) return null

  const lengths = recallCuePrefixLengths(view.text)
  const press = () => {
    const level = onStep()
    if (!level) return
    const previous = level > 1 ? lengths[level - 2] : 0
    const newChars = lengths[level - 1] - previous
    cue('recall.step', { chip: bubbleRef.current ?? document.body, level, newChars }, { owner: ownerKey })
  }

  return createPortal(
    <div
      ref={bubbleRef}
      data-testid="freestyle-recall-cue"
      className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center gap-2 rounded-full border border-amber-500/40 bg-paper-card/95 px-3 py-1.5 shadow-soft"
    >
      {view.level > 0 ? (
        <span key={view.level} className="font-mono text-sm font-bold tabular-nums text-paper-ink">
          {buildRecallCueText(view.text, view.level)}
        </span>
      ) : null}
      <button
        type="button"
        data-recall-cue-chip
        disabled={view.level >= view.maxLevel}
        onClick={press}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-white disabled:bg-paper-line disabled:text-paper-ink-soft"
      >
        线索
        <span className="flex gap-0.5">
          {Array.from({ length: view.maxLevel }, (_, index) => (
            <span
              key={index}
              className={cn('size-1.5 rounded-full', index < view.level ? 'bg-white' : 'bg-white/40')}
            />
          ))}
        </span>
      </button>
    </div>,
    document.body,
  )
}
