import { useEffect, useMemo, useRef, useState } from 'react'
import { PartyPopper } from 'lucide-react'
import { emitReviewCelebration } from '@/shared/components/celebration/reviewCelebration'

export interface CompletionCelebrationProps {
  maxCombo: number
  completedNodes: number
  totalNodes: number
  reducedMotion?: boolean
  soundEnabled?: boolean
  volume?: number
  onComplete?: () => void
  durationMs?: number
}

export function CompletionCelebration({
  maxCombo,
  completedNodes,
  totalNodes,
  reducedMotion = false,
  soundEnabled = false,
  volume = 1,
  onComplete,
  durationMs = 2000,
}: CompletionCelebrationProps) {
  const [visible, setVisible] = useState(true)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    emitReviewCelebration({
      kind: 'session_complete',
      reducedMotion,
      soundEnabled,
      volume,
    })
    const timer = window.setTimeout(() => {
      setVisible(false)
      onCompleteRef.current?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, reducedMotion, soundEnabled, volume])

  const statCards = useMemo(
    () => [
      { label: '最高推进链', value: `×${maxCombo}`, accent: 'text-amber-500' },
      { label: '攻克节点', value: `${completedNodes}/${totalNodes}`, accent: 'text-emerald-500' },
    ],
    [completedNodes, maxCombo, totalNodes],
  )

  if (!visible) return null

  const jelly = (className: string) => (reducedMotion ? '' : className)

  return (
    <div className="memory-anki-completion-overlay">
      <div className="memory-anki-completion-backdrop" />
      <div className={`memory-anki-completion-card ${jelly('fx-jelly-pop')}`}>
        <div className={`memory-anki-completion-icon ${jelly('fx-jelly-wobble')}`}>
          <PartyPopper className="h-8 w-8 text-white" strokeWidth={2.5} />
        </div>
        <div className="memory-anki-completion-title">全域攻克完成</div>
        <div className="memory-anki-completion-copy">整张地图已经点亮，学习势能结算完毕。</div>
        <div className="memory-anki-completion-stats">
          {statCards.map((card, index) => (
            <div
              key={card.label}
              className="memory-anki-completion-stat"
              style={reducedMotion ? undefined : { animationDelay: `${80 + index * 80}ms` }}
            >
              <span className={`memory-anki-completion-stat-value ${card.accent}`}>{card.value}</span>
              <span className="memory-anki-completion-stat-label">{card.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
