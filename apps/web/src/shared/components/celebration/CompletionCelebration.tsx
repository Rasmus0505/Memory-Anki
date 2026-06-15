import { useEffect, useMemo, useState } from 'react'
import { PartyPopper } from 'lucide-react'

/**
 * 复习完成庆祝 overlay。
 *
 * 在通关结算（completionCeremonyActive）时触发：
 * - 全屏 confetti 落花（彩色矩形从顶部下落）
 * - 中央统计卡片（最高连击 / 完成节点数）
 * - 完成图标动画
 *
 * 风格：活泼热烈，高饱和度彩色 confetti。
 * 纯 CSS 动画，无外部依赖。
 *
 * z-index: 160 — 确保在全屏/半屏模式下也可见。
 */

export interface CompletionCelebrationProps {
  /** 最高连击数 */
  maxCombo: number
  /** 完成节点数 */
  completedNodes: number
  /** 总节点数 */
  totalNodes: number
  /** 动画结束后回调（用于卸载组件） */
  onComplete?: () => void
  /** 动画持续时间（ms），默认 2000 */
  durationMs?: number
}

const CONFETTI_COUNT = 40
const CONFETTI_COLORS = [
  '#f59e0b', // amber
  '#22c55e', // green
  '#0ea5e9', // sky
  '#ec4899', // pink
  '#a855f7', // purple
  '#fbbf24', // yellow
  '#fb923c', // orange
  '#14b8a6', // teal
]

function buildConfettiStyle(index: number) {
  const left = (index / CONFETTI_COUNT) * 100 + (Math.random() * 8 - 4)
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length]
  const delay = Math.random() * 400
  const duration = 1400 + Math.random() * 600
  const drift = (Math.random() * 120 - 60).toFixed(0)
  const rotate = (Math.random() * 1080 - 540).toFixed(0)
  const width = 8 + Math.random() * 6
  const height = 12 + Math.random() * 8
  return {
    left: `${left}%`,
    width: `${width}px`,
    height: `${height}px`,
    background: color,
    animationDelay: `${delay}ms`,
    animationDuration: `${duration}ms`,
    '--confetti-drift': `${drift}px`,
    '--confetti-rotate': `${rotate}deg`,
  } as React.CSSProperties
}

export function CompletionCelebration({
  maxCombo,
  completedNodes,
  totalNodes,
  onComplete,
  durationMs = 2000,
}: CompletionCelebrationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, onComplete])

  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, index) => ({
        id: index,
        style: buildConfettiStyle(index),
      })),
    [],
  )

  if (!visible) return null

  return (
    <div className="memory-anki-completion-overlay" aria-hidden="true">
      {/* Confetti 落花 */}
      <div className="memory-anki-completion-confetti-layer">
        {confetti.map((piece) => (
          <span
            key={piece.id}
            className="memory-anki-completion-confetti"
            style={piece.style}
          />
        ))}
      </div>

      {/* 中央统计卡片 */}
      <div className="memory-anki-completion-card">
        <div className="memory-anki-completion-icon">
          <PartyPopper className="h-8 w-8 text-white" strokeWidth={2.5} />
        </div>
        <div className="memory-anki-completion-title">通关完成</div>
        <div className="memory-anki-completion-stats">
          <div className="memory-anki-completion-stat">
            <span
              className="memory-anki-completion-stat-value"
              style={{ color: '#f59e0b' }}
            >
              ×{maxCombo}
            </span>
            <span className="memory-anki-completion-stat-label">最高连击</span>
          </div>
          <div className="memory-anki-completion-stat">
            <span
              className="memory-anki-completion-stat-value"
              style={{ color: '#22c55e' }}
            >
              {completedNodes}
              <span style={{ fontSize: 18, color: '#94a3b8' }}>/{totalNodes}</span>
            </span>
            <span className="memory-anki-completion-stat-label">完成节点</span>
          </div>
        </div>
      </div>
    </div>
  )
}
