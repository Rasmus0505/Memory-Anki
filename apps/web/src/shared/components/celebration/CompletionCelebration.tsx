import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PartyPopper } from 'lucide-react'
import { emitReviewConfetti } from '@/shared/components/celebration/reviewConfetti'

export interface CompletionCelebrationProps {
  maxCombo: number
  completedNodes: number
  totalNodes: number
  reducedMotion?: boolean
  criticalFxIntensity?: 'full' | 'cinematic'
  soundEnabled?: boolean
  volume?: number
  confettiAmount?: number
  onComplete?: () => void
  durationMs?: number
}

export function CompletionCelebration({
  maxCombo,
  completedNodes,
  totalNodes,
  reducedMotion = false,
  criticalFxIntensity = 'cinematic',
  soundEnabled = false,
  volume = 1,
  confettiAmount = 1,
  onComplete,
  durationMs = 2000,
}: CompletionCelebrationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    emitReviewConfetti({
      kind: 'session_complete',
      reducedMotion,
      criticalFxIntensity,
      soundEnabled,
      volume,
      confettiAmount,
    })
    const timer = window.setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [confettiAmount, criticalFxIntensity, durationMs, onComplete, reducedMotion, soundEnabled, volume])

  const statCards = useMemo(
    () => [
      { label: '最高推进链', value: `×${maxCombo}`, accent: 'text-amber-500' },
      { label: '攻克节点', value: `${completedNodes}/${totalNodes}`, accent: 'text-emerald-500' },
    ],
    [completedNodes, maxCombo, totalNodes],
  )

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="memory-anki-completion-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.16 : 0.28 }}
        >
          <motion.div
            className="memory-anki-completion-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="memory-anki-completion-card"
            initial={{ scale: reducedMotion ? 1 : 0.84, y: reducedMotion ? 0 : 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 18 }}
          >
            <motion.div
              className="memory-anki-completion-icon"
              animate={reducedMotion ? undefined : { rotate: [0, -8, 6, 0], scale: [1, 1.12, 1] }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <PartyPopper className="h-8 w-8 text-white" strokeWidth={2.5} />
            </motion.div>
            <div className="memory-anki-completion-title">全域攻克完成</div>
            <div className="memory-anki-completion-copy">整张地图已经点亮，学习势能结算完毕。</div>
            <div className="memory-anki-completion-stats">
              {statCards.map((card, index) => (
                <motion.div
                  key={card.label}
                  className="memory-anki-completion-stat"
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 + index * 0.08 }}
                >
                  <span className={`memory-anki-completion-stat-value ${card.accent}`}>{card.value}</span>
                  <span className="memory-anki-completion-stat-label">{card.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
