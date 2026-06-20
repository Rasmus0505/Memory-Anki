import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { emitReviewConfetti } from '@/shared/components/celebration/reviewConfetti'
import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'

export interface ComboMilestoneBurstProps {
  milestoneStep: number
  comboCount: number
  copy?: string
  label?: string | null
  durationMs?: number
  reducedMotion?: boolean
  soundEnabled?: boolean
  volume?: number
  /** 里程碑场景的烟花类型（缺省时由 reviewConfetti 按 kind 兜底）。 */
  confettiPreset?: CelebrationPreset
  onComplete?: () => void
}

const MILESTONE_PALETTES = [
  { primary: '#22c55e', secondary: '#86efac', accent: '#fde68a', glow: 'rgba(34, 197, 94, 0.45)' },
  { primary: '#f59e0b', secondary: '#fcd34d', accent: '#fb923c', glow: 'rgba(245, 158, 11, 0.45)' },
  { primary: '#ef4444', secondary: '#fb7185', accent: '#fdba74', glow: 'rgba(239, 68, 68, 0.42)' },
  { primary: '#0ea5e9', secondary: '#7dd3fc', accent: '#a78bfa', glow: 'rgba(14, 165, 233, 0.45)' },
  { primary: '#ec4899', secondary: '#f9a8d4', accent: '#c084fc', glow: 'rgba(236, 72, 153, 0.45)' },
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
  confettiPreset,
  onComplete,
}: ComboMilestoneBurstProps) {
  const [visible, setVisible] = useState(true)
  const onCompleteRef = useRef(onComplete)
  const palette = MILESTONE_PALETTES[Math.min(milestoneStep, MILESTONE_PALETTES.length - 1)]

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    emitReviewConfetti({
      kind: 'milestone',
      milestoneStep,
      reducedMotion,
      soundEnabled,
      volume,
      confettiPreset,
    })
    const timer = window.setTimeout(() => {
      setVisible(false)
      onCompleteRef.current?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [confettiPreset, durationMs, milestoneStep, reducedMotion, soundEnabled, volume])

  const shards = useMemo(
    () =>
      Array.from({ length: reducedMotion ? 4 : 14 }, (_, index) => ({
        id: index,
        angle: (index / 14) * 360,
        distance: 84 + (index % 4) * 24,
        color: [palette.primary, palette.secondary, palette.accent][index % 3],
      })),
    [palette.accent, palette.primary, palette.secondary, reducedMotion],
  )

  if (!visible) return null

  return (
    <motion.div
      className="memory-anki-combo-burst-overlay"
      role="status"
      aria-live="assertive"
      aria-label={`推进链 ${comboCount}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0.12 : 0.22 }}
    >
      <motion.div
        className="memory-anki-combo-burst-stage"
        style={{ '--combo-burst-glow': palette.glow } as React.CSSProperties}
        initial={{ scale: reducedMotion ? 1 : 0.88, y: reducedMotion ? 0 : 18, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
      >
        <div className="memory-anki-combo-burst-rings">
          <motion.span
            className="memory-anki-combo-burst-ring"
            style={{ borderColor: palette.primary }}
            animate={reducedMotion ? { opacity: 0.26 } : { scale: [0.4, 1.2], opacity: [0.8, 0] }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.span
            className="memory-anki-combo-burst-ring"
            style={{ borderColor: palette.secondary }}
            animate={reducedMotion ? { opacity: 0.18 } : { scale: [0.24, 1.55], opacity: [0.66, 0] }}
            transition={{ duration: 0.92, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
          />
        </div>

        <div className="memory-anki-combo-burst-shards">
          {shards.map((shard, index) => (
            <motion.span
              key={shard.id}
              className="memory-anki-combo-burst-shard"
              style={{ background: shard.color }}
              initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
              animate={
                reducedMotion
                  ? { opacity: 0.18 }
                  : {
                      x: Math.cos((shard.angle * Math.PI) / 180) * shard.distance,
                      y: Math.sin((shard.angle * Math.PI) / 180) * shard.distance,
                      rotate: index % 2 === 0 ? 120 : -140,
                      opacity: [0, 1, 0],
                    }
              }
              transition={{ duration: 0.66, ease: [0.16, 1, 0.3, 1], delay: index * 0.012 }}
            />
          ))}
        </div>

        <motion.div
          className="memory-anki-combo-burst-core"
          initial={{ scale: reducedMotion ? 1 : 0.7, rotate: reducedMotion ? 0 : -8, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        >
          <span className="memory-anki-combo-burst-kicker">{label ?? '推进链升级'}</span>
          <span className="memory-anki-combo-burst-value">×{comboCount}</span>
          {copy ? <span className="memory-anki-combo-burst-copy">{copy}</span> : null}
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
