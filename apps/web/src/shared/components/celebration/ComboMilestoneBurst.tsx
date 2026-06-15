import { useEffect, useMemo, useState } from 'react'

/**
 * 连击里程碑视觉庆祝 overlay。
 *
 * 在 combo 达到 [3, 5, 8, 13] 时触发：
 * - 全屏覆盖层（pointer-events-none，不阻挡交互）
 * - 中央大数字弹出动画
 * - 彩色粒子爆发（随机方向飞散）
 * - 扩散光环
 * - 鼓励文案
 *
 * 风格：活泼热烈，高饱和度配色，随里程碑等级递进。
 * 纯 CSS 动画，无外部依赖。
 *
 * z-index: 160 — 高于 Dialog(140/141) 和反馈层(150)，确保在最顶层可见，
 * 即使在半屏/全屏模式下也能看到。
 */

export interface ComboMilestoneBurstProps {
  /** 里程碑等级 0-3，对应 combo [3, 5, 8, 13] */
  milestoneStep: number
  /** 当前连击数 */
  comboCount: number
  /** 鼓励文案 */
  copy?: string
  /** 动画结束后回调（用于卸载组件） */
  onComplete?: () => void
  /** 动画持续时间（ms），默认 1300 */
  durationMs?: number
}

/** 各里程碑等级的配色方案（活泼热烈风格） */
const MILESTONE_PALETTES = [
  {
    // 等级 0 (combo 3): 翠绿 - 起步鼓励
    primary: '#22c55e',
    secondary: '#86efac',
    accent: '#fde68a',
    glow: 'rgba(34, 197, 94, 0.45)',
  },
  {
    // 等级 1 (combo 5): 琥珀金 - 节奏起来了
    primary: '#f59e0b',
    secondary: '#fcd34d',
    accent: '#fb923c',
    glow: 'rgba(245, 158, 11, 0.45)',
  },
  {
    // 等级 2 (combo 8): 天青蓝 - 记忆通路发亮
    primary: '#0ea5e9',
    secondary: '#7dd3fc',
    accent: '#a78bfa',
    glow: 'rgba(14, 165, 233, 0.45)',
  },
  {
    // 等级 3 (combo 13): 玫红紫 - 宫殿通感连线
    primary: '#ec4899',
    secondary: '#f9a8d4',
    accent: '#c084fc',
    glow: 'rgba(236, 72, 153, 0.45)',
  },
]

const PARTICLE_COUNT = 16
const RING_COUNT = 3

function buildParticleStyle(index: number, palette: (typeof MILESTONE_PALETTES)[number]) {
  const angle = (index / PARTICLE_COUNT) * Math.PI * 2 + (index % 2) * 0.3
  const distance = 120 + (index % 4) * 40
  const tx = Math.cos(angle) * distance
  const ty = Math.sin(angle) * distance
  const colors = [palette.primary, palette.secondary, palette.accent]
  const color = colors[index % colors.length]
  const size = 10 + (index % 3) * 6
  const delay = index * 18
  const rotate = (index % 2 === 0 ? 1 : -1) * (180 + index * 30)
  return {
    '--combo-particle-tx': `${tx}px`,
    '--combo-particle-ty': `${ty}px`,
    '--combo-particle-rotate': `${rotate}deg`,
    '--combo-particle-color': color,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}ms`,
  } as React.CSSProperties
}

export function ComboMilestoneBurst({
  milestoneStep,
  comboCount,
  copy,
  onComplete,
  durationMs = 1300,
}: ComboMilestoneBurstProps) {
  const palette = MILESTONE_PALETTES[Math.min(milestoneStep, MILESTONE_PALETTES.length - 1)]
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, onComplete])

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
        id: index,
        style: buildParticleStyle(index, palette),
      })),
    [palette],
  )

  const rings = useMemo(
    () =>
      Array.from({ length: RING_COUNT }, (_, index) => ({
        id: index,
        delay: index * 120,
        color: [palette.primary, palette.secondary, palette.accent][index],
      })),
    [palette],
  )

  if (!visible) return null

  return (
    <div
      className="memory-anki-combo-burst-overlay"
      role="status"
      aria-live="assertive"
      aria-label={`连击 ${comboCount}`}
      style={{ '--combo-burst-glow': palette.glow } as React.CSSProperties}
    >
      {/* 扩散光环 */}
      <div className="memory-anki-combo-burst-rings">
        {rings.map((ring) => (
          <span
            key={ring.id}
            className="memory-anki-combo-burst-ring"
            style={{
              borderColor: ring.color,
              animationDelay: `${ring.delay}ms`,
            }}
          />
        ))}
      </div>

      {/* 中心爆发区 */}
      <div className="memory-anki-combo-burst-center">
        {/* 彩色粒子 */}
        <div className="memory-anki-combo-burst-particles">
          {particles.map((particle) => (
            <span
              key={particle.id}
              className="memory-anki-combo-burst-particle"
              style={particle.style}
            />
          ))}
        </div>

        {/* 大数字 */}
        <div
          className="memory-anki-combo-burst-number"
          style={{ color: palette.primary }}
        >
          <span className="memory-anki-combo-burst-number-label">连击</span>
          <span className="memory-anki-combo-burst-number-value">×{comboCount}</span>
        </div>

        {/* 鼓励文案 */}
        {copy ? (
          <div
            className="memory-anki-combo-burst-copy"
            style={{ color: palette.accent }}
          >
            {copy}
          </div>
        ) : null}
      </div>
    </div>
  )
}
