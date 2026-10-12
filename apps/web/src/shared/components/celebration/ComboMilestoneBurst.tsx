import { useEffect, useRef, useState } from 'react'
import { emitReviewCelebration } from '@/shared/components/celebration/reviewCelebration'

export interface ComboMilestoneBurstProps {
  milestoneStep: number
  comboCount: number
  copy?: string
  label?: string | null
  durationMs?: number
  reducedMotion?: boolean
  soundEnabled?: boolean
  volume?: number
  onComplete?: () => void
}

const MILESTONE_GLOWS = [
  'rgba(34, 197, 94, 0.45)',
  'rgba(245, 158, 11, 0.45)',
  'rgba(239, 68, 68, 0.42)',
  'rgba(14, 165, 233, 0.45)',
  'rgba(236, 72, 153, 0.45)',
]

export function ComboMilestoneBurst({
  milestoneStep,
  comboCount,
  copy,
  label,
  durationMs = 1400,
  reducedMotion = false,
  soundEnabled = false,
  volume = 1,
  onComplete,
}: ComboMilestoneBurstProps) {
  const [visible, setVisible] = useState(true)
  const onCompleteRef = useRef(onComplete)
  const glow = MILESTONE_GLOWS[Math.min(milestoneStep, MILESTONE_GLOWS.length - 1)]

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    emitReviewCelebration({
      kind: 'milestone',
      milestoneStep,
      reducedMotion,
      soundEnabled,
      volume,
    })
    const timer = window.setTimeout(() => {
      setVisible(false)
      onCompleteRef.current?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, milestoneStep, reducedMotion, soundEnabled, volume])

  if (!visible) return null

  const jelly = (className: string) => (reducedMotion ? '' : className)

  return (
    <div
      className="memory-anki-combo-burst-overlay"
      role="status"
      aria-live="assertive"
      aria-label={`推进链 ${comboCount}`}
    >
      <div
        className={`memory-anki-combo-burst-stage ${jelly('fx-jelly-pop')}`}
        style={{ '--combo-burst-glow': glow } as React.CSSProperties}
      >
        <div className={`memory-anki-combo-burst-core ${jelly('fx-jelly-wobble')}`}>
          <span className="memory-anki-combo-burst-kicker">{label ?? '推进链升级'}</span>
          <span className="memory-anki-combo-burst-value">×{comboCount}</span>
          {copy ? <span className="memory-anki-combo-burst-copy">{copy}</span> : null}
        </div>
      </div>
    </div>
  )
}
