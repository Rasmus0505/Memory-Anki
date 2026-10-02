import { emitFlight, emitFoldTrail, emitGoldDustSettle, emitGoldRain } from '../particles'
import type { Point } from '../particles/particleModel'
import { defineCue } from '../core/director'
import { hitStop } from '../core/domFlourish'
import { triggerHaptic } from '@/shared/feedback/haptics'

export interface MapLandCue {
  rect: DOMRect
}

export interface MapFoldCue {
  rect: DOMRect
  target: () => Point | null
  onFirstArrive?: () => void
}

export interface MapBranchCue {
  rect: DOMRect
}

export interface MapCharge {
  origin: Point
  target: () => Point | null
  /** Local count such as 2/5. Never a fake experience total. */
  label: string
  mastered: boolean
  onArrive?: () => void
}

export interface MapSettleCue {
  /** single = one crack; batch = one merged burst per parent. */
  weight: 'single' | 'batch'
  charges: MapCharge[]
  /** True when any parent in this batch just filled. */
  freeze: boolean
}

declare module '../core/director' {
  interface FxCueMap {
    'map.land': MapLandCue
    'map.fold': MapFoldCue
    'map.branch': MapBranchCue
    'map.settle': MapSettleCue
  }
}

const sampleRect = () => new DOMRect(window.innerWidth / 2 - 90, window.innerHeight / 2 - 24, 180, 48)

defineCue('map.land', {
  scene: 'review',
  label: '节点落定（金粉）',
  group: '导图',
  sample: () => ({ rect: sampleRect() }),
  play({ rect }, stage) {
    if (stage.gate.motion) emitGoldDustSettle(rect)
  },
})

defineCue('map.fold', {
  scene: 'review',
  label: '折回父节点（墨迹回收）',
  group: '导图',
  play({ rect, target, onFirstArrive }, stage) {
    if (stage.gate.motion) emitFoldTrail(rect, target, onFirstArrive)
    else onFirstArrive?.()
  },
})

function floatCount(label: string, point: Point) {
  const node = document.createElement('div')
  node.className = 'mindmap-charge-float'
  node.textContent = label
  node.setAttribute('aria-hidden', 'true')
  Object.assign(node.style, {
    position: 'fixed',
    left: `${point.x}px`,
    top: `${point.y}px`,
    zIndex: '40',
    pointerEvents: 'none',
    transform: 'translate(-50%, -120%)',
    fontSize: '12px',
    fontWeight: '800',
    fontVariantNumeric: 'tabular-nums',
    color: 'hsl(24 48% 28%)',
  })
  document.body.appendChild(node)
  if (typeof node.animate !== 'function') {
    node.remove()
    return
  }
  node.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -80%)' },
      { opacity: 1, transform: 'translate(-50%, -140%)', offset: 0.3 },
      { opacity: 0, transform: 'translate(-50%, -180%)' },
    ],
    { duration: 640, easing: 'cubic-bezier(0.2, 1, 0.3, 1)', fill: 'forwards' },
  ).finished.catch(() => undefined).then(() => node.remove())
}

defineCue('map.settle', {
  scene: 'review',
  label: '破壳充能（父节点）',
  group: '导图',
  sample: () => ({
    weight: 'single' as const,
    freeze: false,
    charges: [{
      origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.62 },
      target: () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.28 }),
      label: '1/3',
      mastered: false,
    }],
  }),
  play({ weight, charges, freeze }, stage) {
    if (!stage.gate.motion || charges.length === 0) return
    if (stage.gate.haptic) triggerHaptic(weight === 'batch' || freeze ? 'select' : 'tap')
    let froze = false
    const freezeOnce = () => {
      if (froze || !freeze) return
      froze = true
      hitStop(60)
    }
    let flew = false
    for (const charge of charges) {
      const ok = emitFlight({
        origin: charge.origin,
        target: charge.target,
        count: weight === 'batch' ? 8 : 5,
        comet: true,
        fountain: charge.mastered ? 6 : 3,
        glow: charge.mastered,
        onFirstArrive: () => {
          charge.onArrive?.()
          const point = charge.target()
          if (point) floatCount(charge.label, point)
          if (charge.mastered) freezeOnce()
        },
      })
      if (ok) flew = true
    }
    if (freeze && !flew) freezeOnce()
  },
})

defineCue('map.branch', {
  scene: 'review',
  label: '整枝揭示（金雨）',
  group: '导图',
  sample: () => ({ rect: new DOMRect(0, 0, window.innerWidth, window.innerHeight * 0.7) }),
  play({ rect }, stage) {
    if (stage.gate.motion) emitGoldRain(rect)
  },
})
