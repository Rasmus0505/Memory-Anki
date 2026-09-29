import { spawnParticle } from '../particles/particleEngine'
import type { Hsl, Point } from '../particles/particleModel'
import { FX_ANCHORS, PROGRESS_TARGET, elementCenter, findAnchor } from '../core/anchors'
import { defineCue, type FxStage } from '../core/director'
import { chargeElement, stampOn } from '../core/domFlourish'
import { playWebAudioFireworkAccent } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import { pal } from '../skins'
import { RARE_LABEL, RARE_SHOWS, type RareShow } from '../rarity'

export interface RareShowCue {
  show: RareShow
  /** Where the show starts; defaults to the lower middle of the screen. */
  origin?: Point
}

declare module '../core/director' {
  interface FxCueMap {
    'rare.show': RareShowCue
  }
}

const range = (min: number, max: number) => min + Math.random() * (max - min)
const KOI_ORANGE: Hsl = [18, 92, 58]
const KOI_WHITE: Hsl = [36, 60, 94]
const FIREFLY: Hsl = [62, 90, 66]
const LOTUS: Hsl = [340, 70, 74]

function screenOrigin(origin?: Point): Point {
  return origin ?? { x: window.innerWidth * 0.5, y: window.innerHeight * 0.72 }
}

function ripple(at: Point, color: Hsl, delay = 0) {
  for (let i = 0; i < 3; i += 1) {
    spawnParticle({ ...at, shape: 'ring', additive: true, ring: { from: 4, to: 46 + i * 22 }, size: 2.5, color, life: 0.8, delay: delay + i * 0.12 })
  }
}

/** A koi arcs out of the card and dives back, scales glinting, splash at both ends. */
function koi(origin: Point) {
  const span = Math.min(window.innerWidth * 0.5, 420)
  const rise = Math.min(window.innerHeight * 0.36, 300)
  const frames = 70
  const vx = span / frames
  const gravity = (8 * rise) / (frames * frames)
  const vy = -gravity * frames * 0.5
  const start = { x: origin.x - span / 2, y: origin.y }
  ripple(start, pal.cream)
  spawnParticle({ ...start, vx, vy, gravity, drag: 1, shape: 'glow', additive: true, size: 7, color: KOI_ORANGE, trail: 22, shed: 0.7, life: frames / 60 + 0.1 })
  for (let i = 1; i <= 6; i += 1) {
    const lag = i * 0.035
    spawnParticle({ ...start, vx, vy, gravity, drag: 1, shape: 'glow', additive: true, size: 6 - i * 0.7, color: i % 2 ? KOI_WHITE : KOI_ORANGE, trail: 6, life: frames / 60 + 0.1, delay: lag })
  }
  ripple({ x: start.x + span, y: start.y }, pal.cream, frames / 60)
  for (let i = 0; i < 26; i += 1) {
    const angle = range(-Math.PI * 0.9, -Math.PI * 0.1)
    const speed = range(2, 6)
    spawnParticle({ x: start.x + span, y: start.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravity: 0.16, drag: 0.96, size: range(1, 2.2), color: KOI_WHITE, twinkle: true, life: range(0.6, 1), delay: frames / 60 })
  }
}

/** A phoenix sweeps along the progress rail, wings shedding embers, and charges it. */
function phoenix(stage: FxStage) {
  const rail = findAnchor(PROGRESS_TARGET)
  const railRect = findAnchor(FX_ANCHORS.progressRail)?.getBoundingClientRect()
  const y = railRect && railRect.width > 0 ? railRect.top + railRect.height / 2 : window.innerHeight * 0.12
  const startX = -60
  const speed = Math.max(12, window.innerWidth / 70)
  spawnParticle({ x: startX, y, vx: speed, vy: 0, drag: 1, shape: 'glow', additive: true, size: 8, color: pal.gold, trail: 34, shed: 0.9, life: 2 })
  for (const wing of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      spawnParticle({ x: startX - i * 10, y: y + wing * (6 + i * 5), vx: speed, vy: wing * -0.25, drag: 1, shape: 'glow', additive: true, size: 3.4 - i * 0.4, color: i % 2 ? pal.amber : pal.coral, trail: 14, shed: 0.25, life: 2, delay: i * 0.02 })
    }
  }
  stage.playback.at(900, () => chargeElement(rail, 1))
}

/** The whole screen fills with slow wandering fireflies for a few seconds. */
function fireflies() {
  const w = window.innerWidth
  const h = window.innerHeight
  const count = w < 640 ? 38 : 64
  for (let i = 0; i < count; i += 1) {
    spawnParticle({ x: range(0, w), y: range(h * 0.2, h), vx: range(-0.4, 0.4), vy: range(-0.6, -0.1), sway: range(1, 2.5), drag: 0.995, shape: 'glow', additive: true, size: range(1.4, 2.8), color: i % 4 ? FIREFLY : pal.gold, twinkle: true, life: range(3.2, 4.6), delay: range(0, 0.9) })
  }
}

/** An ink lotus blooms: petals unfold in rings, then pollen drifts up. */
function lotus(origin: Point) {
  for (let ring = 0; ring < 3; ring += 1) {
    const petals = 8 + ring * 4
    for (let i = 0; i < petals; i += 1) {
      const angle = (i / petals) * Math.PI * 2 + ring * 0.3
      const speed = 1.6 + ring * 1.1
      spawnParticle({ ...origin, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.6, drag: 0.93, shape: 'flake', additive: pal.luminous, size: 6 - ring, color: ring === 0 ? pal.cream : LOTUS, spin: 0.05, flipSpeed: 0.06, life: 1.6, delay: ring * 0.18 })
    }
  }
  spawnParticle({ ...origin, shape: 'bloom', ring: { from: 6, to: 90 }, size: 1, color: LOTUS, alpha: 0.6, life: 1.2 })
  for (let i = 0; i < 24; i += 1) {
    spawnParticle({ x: origin.x + range(-30, 30), y: origin.y, vx: range(-0.3, 0.3), vy: range(-1.6, -0.6), drag: 0.99, shape: 'glow', additive: true, size: range(1, 1.8), color: pal.gold, twinkle: true, life: range(1.6, 2.4), delay: 0.6 + range(0, 0.6) })
  }
}

defineCue('rare.show', {
  scene: 'milestone',
  label: '稀有演出',
  group: '惊喜',
  sample: () => ({ show: RARE_SHOWS[Math.floor(Math.random() * RARE_SHOWS.length)] }),
  play({ show, origin }, stage) {
    if (stage.gate.sound) playWebAudioFireworkAccent({ kind: 'branch_clear', volume: stage.gate.volume })
    if (!stage.gate.motion) return
    const at = screenOrigin(origin)
    if (show === 'koi') koi(at)
    else if (show === 'phoenix') phoenix(stage)
    else if (show === 'fireflies') fireflies()
    else lotus(at)
    stage.playback.at(260, () => stampOn(document.body, `✦ ${RARE_LABEL[show]}`, 'corner', stage.playback))
  },
})

/** Center of an element, for callers that want a show to start from a card. */
export function rareOriginFrom(element: Element | null | undefined) {
  return elementCenter(element) ?? undefined
}
