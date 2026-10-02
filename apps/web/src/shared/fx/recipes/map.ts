import { emitEnergyOrb, emitFoldTrail, emitGoldDustSettle, emitGoldRain } from '../particles'
import type { Point } from '../particles/particleModel'
import { defineCue } from '../core/director'

import { triggerHaptic } from '@/shared/feedback/haptics'
import { playFlipCrack, playFlipFold, playFlipImpact, playFlipShoot } from '@/shared/feedback/mindmap-audio/webAudioFeedback'

export interface MapLandCue {
  rect: DOMRect
  delayMs?: number
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
  /** Batch launch delay, preserving the jelly lab's 45 ms cadence. */
  delayMs?: number
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

function jellySceneActive() {
  if (typeof document === 'undefined') return false
  // The independent stage owns the exact lab voices. The legacy flip skin keeps
  // its old React Flow fallback so the two paths can never sound at once.
  return Boolean(document.querySelector('[data-jelly-flip="true"]'))
}

defineCue('map.land', {
  scene: 'review',
  label: '节点落定（金粉）',
  group: '导图',
  sample: () => ({ rect: sampleRect() }),
  play({ rect, delayMs = 0 }, stage) {
    stage.playback.at(delayMs, () => {
      // Generic scenes keep their own card_reveal voice; only the jelly stage
      // swaps it for the lab's exact crack envelope.
      if (stage.gate.sound && jellySceneActive()) playFlipCrack(stage.gate.volume)
      if (stage.gate.motion) emitGoldDustSettle(rect)
    })
  },
})

defineCue('map.fold', {
  scene: 'review',
  label: '折回父节点（墨迹回收）',
  group: '导图',
  play({ rect, target, onFirstArrive }, stage) {
    if (stage.gate.sound && jellySceneActive()) {
      playFlipFold(stage.gate.volume)
    }
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
    fontSize: '18px',
    fontWeight: '800',
    fontVariantNumeric: 'tabular-nums',
    color: '#ffa502',
    textShadow: '0 2px 10px rgba(0, 0, 0, 0.65)',
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

function floatReward(point: Point) {
  const node = document.createElement('div')
  node.className = 'mindmap-exp-float'
  node.textContent = '+100 EXP'
  node.setAttribute('aria-hidden', 'true')
  Object.assign(node.style, {
    position: 'fixed',
    left: `${point.x}px`,
    top: `${point.y + 24}px`,
    zIndex: '40',
    pointerEvents: 'none',
    transform: 'translate(-50%, -50%)',
    fontSize: '13px',
    fontWeight: '900',
    color: '#ffd700',
    textShadow: '0 2px 10px rgba(0,0,0,.8)',
  })
  document.body.appendChild(node)
  if (typeof node.animate !== 'function') {
    node.remove()
    return
  }
  node.animate(
    [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, -90%) scale(1.05)', offset: .28 }, { opacity: 0, transform: 'translate(-50%, -160%) scale(1)' }],
    { duration: 850, easing: 'cubic-bezier(.2,1,.3,1)', fill: 'forwards' },
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
    if (charges.length === 0) return
    if (stage.gate.haptic) triggerHaptic(weight === 'batch' || freeze ? 'select' : 'tap')
    const volume = stage.gate.sound ? stage.gate.volume : 0
    for (const charge of charges) {
      const launch = () => {
        // The lab fires one propulsion voice per orb, not one voice per batch.
        if (volume > 0 && jellySceneActive()) playFlipShoot(volume)
        const arrive = () => {
          if (stage.gate.motion) {
            charge.onArrive?.()
            const point = charge.target()
            if (point) {
              floatCount(charge.label, point)
              floatReward(point)
            }
          }
          if (volume > 0 && jellySceneActive()) playFlipImpact(volume)
        }
        if (!stage.gate.motion) {
          arrive()
          return
        }
        if (!emitEnergyOrb(charge.origin, charge.target, arrive)) arrive()
      }
      const delay = Math.max(0, charge.delayMs ?? 0)
      if (delay > 0) stage.playback.at(delay, launch)
      else launch()
    }
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
