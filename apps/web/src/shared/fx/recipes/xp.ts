import { playWebAudioLandingChime, playWebAudioLayeredPops } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import { FX_ANCHORS, findAnchor } from '../core/anchors'
import { defineCue, type FxStage } from '../core/director'
import { jellyOn } from '../core/jelly'

// New feedback reuses the existing audio voices (landing chime, layered pops); no new tones are synthesized.

export interface XpGainCue {
  /** Where the flip happened; the meter is found inside it. */
  scope: ParentNode
  /** XP just earned by this flip. */
  amount: number
  /** Position in the current flip chain; the landing chime climbs with it. */
  chain: number
  /** The card that turned over; the orbs leave from its centre. */
  card?: Element | null
  /** How many orbs this flip throws, from the card's label length. Look only; the XP is `amount`. */
  orbs: number
}

export interface XpLevelUpCue {
  scope: ParentNode
  /** The level just reached. Each level plays a stronger burst than the last. */
  level: number
}

export interface RatingOrbsCue {
  scope: ParentNode
  /** The rating button that was pressed; the orbs leave from it. */
  button: Element
  /** 1 忘记 · 2 困难 · 3 记得 · 4 轻松. Also selects the matching pop voice. */
  grade: 1 | 2 | 3 | 4
  /** How many orbs this rating throws. Look only: a rating never earns XP. */
  count: number
}

declare module '../core/director' {
  interface FxCueMap {
    'xp.gain': XpGainCue
    'xp.levelup': XpLevelUpCue
    'rating.orbs': RatingOrbsCue
  }
}

/** Levels above this stop growing the burst, so very long sessions stay readable. */
const LEVEL_INTENSITY_CAP = 8
/** Gap between the orbs of one throw, so a many-orb throw reads as a stream, not one blob. */
const ORB_STAGGER_MS = 70

function centre(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** Fixed-position float at the meter, so the bar's overflow clip never hides it. */
function floatAtMeter(meter: Element, text: string, stage: FxStage, className: string, fontSize?: number) {
  const { x, y } = centre(meter.getBoundingClientRect())
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  el.style.left = `${x}px`
  el.style.top = `${y - 8}px`
  if (fontSize) el.style.fontSize = `${fontSize}px`
  document.body.appendChild(el)
  const anim = el.animate(
    [
      { transform: 'translate(-50%, 6px) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -6px) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -26px) scale(1)', opacity: 0 },
    ],
    { duration: 900, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' },
  )
  anim.finished.catch(() => undefined).then(() => el.remove())
  stage.playback.onCancel(() => {
    anim.cancel()
    el.remove()
  })
}

/**
 * One orb from `from` to the meter: it arcs up and lands. The last orb of a throw
 * makes the meter react, so the bar moves on arrival, not when the number changes.
 */
function spawnOrb(from: Element | null | undefined, meter: Element, stage: FxStage, index: number, total: number, delay: number) {
  const to = centre(meter.getBoundingClientRect())
  const start = from ? centre(from.getBoundingClientRect()) : to
  const dx = to.x - start.x
  const dy = to.y - start.y
  const lift = -Math.min(140, Math.abs(dx) * 0.3 + 60)
  // Spread the starting points a little so a throw of many orbs does not stack on one pixel.
  const jitter = (index - (total - 1) / 2) * 6
  const orb = document.createElement('span')
  orb.className = 'fx-xp-orb'
  orb.style.left = `${start.x + jitter}px`
  orb.style.top = `${start.y}px`
  orb.style.visibility = 'hidden'
  document.body.appendChild(orb)
  const anim = orb.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.5 + jitter}px), calc(-50% + ${dy * 0.5 + lift}px)) scale(1.1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx + jitter * 0.2}px), calc(-50% + ${dy}px)) scale(0.5)`, opacity: 1 },
    ],
    { duration: 620, delay, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' },
  )
  orb.style.visibility = ''
  anim.finished.catch(() => undefined).then(() => {
    orb.remove()
    if (index === total - 1 && stage.playback.alive()) jellyOn(meter, 'pop')
  })
  stage.playback.onCancel(() => {
    anim.cancel()
    orb.remove()
  })
}

// Every flip throws one orb per label block into the meter, and the meter reacts on the last arrival.
defineCue('xp.gain', {
  scene: 'review',
  play({ scope, amount, card, chain, orbs }, stage) {
    if (stage.gate.sound) playWebAudioLandingChime({ combo: chain, volume: stage.gate.volume })
    const meter = findAnchor(FX_ANCHORS.xpBar, scope)
    if (!meter || !stage.gate.motion) return
    const total = Math.max(1, orbs)
    for (let index = 0; index < total; index += 1) {
      // Scheduled on the playback: retiring the owner cancels the not-yet-thrown orbs too.
      stage.playback.at(index * ORB_STAGGER_MS, () => spawnOrb(card, meter, stage, index, total, 0))
    }
    floatAtMeter(meter, `+${amount} XP`, stage, 'fx-xp-float')
  },
})

// A rating throws its own orbs from the pressed button into the meter. It is feedback only: no XP.
defineCue('rating.orbs', {
  scene: 'review',
  play({ scope, button, grade, count }, stage) {
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'grade', grade, count: Math.max(1, count), volume: stage.gate.volume })
    const meter = findAnchor(FX_ANCHORS.xpBar, scope)
    if (!meter || !stage.gate.motion) return
    const total = Math.max(1, count)
    for (let index = 0; index < total; index += 1) {
      stage.playback.at(index * ORB_STAGGER_MS, () => spawnOrb(button, meter, stage, index, total, 0))
    }
  },
})

// Each level is louder than the last: more coins, wider spread, a bigger label and a stronger flash.
defineCue('xp.levelup', {
  scene: 'review',
  play({ scope, level }, stage) {
    // More pops for higher levels: the same voice, more objects, so the ear hears the level grow.
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'close', count: Math.min(Math.max(level, 1), LEVEL_INTENSITY_CAP), volume: stage.gate.volume })
    const meter = findAnchor(FX_ANCHORS.xpBar, scope)
    if (!meter || !stage.gate.motion) return
    const k = Math.min(Math.max(level, 1), LEVEL_INTENSITY_CAP)
    jellyOn(meter, 'wobble')
    floatAtMeter(meter, `升级 Lv ${level}`, stage, 'fx-xp-float fx-xp-levelup', 14 + k * 2)
    spawnRings(meter, k, stage)
    spawnFlash(meter, k, stage)
    spawnCoins(meter, k, stage)
  },
})

function spawnRings(meter: Element, k: number, stage: FxStage) {
  const { x, y } = centre(meter.getBoundingClientRect())
  const rings = 1 + Math.floor(k / 3)
  for (let i = 0; i < rings; i += 1) {
    const ring = document.createElement('span')
    ring.className = 'fx-xp-ring'
    ring.style.left = `${x}px`
    ring.style.top = `${y}px`
    document.body.appendChild(ring)
    const anim = ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0.9 },
        { transform: `translate(-50%, -50%) scale(${2 + k * 0.35})`, opacity: 0 },
      ],
      { duration: 520 + k * 40, delay: i * 90, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' },
    )
    anim.finished.catch(() => undefined).then(() => ring.remove())
    stage.playback.onCancel(() => {
      anim.cancel()
      ring.remove()
    })
  }
}

function spawnFlash(meter: Element, k: number, stage: FxStage) {
  const { x, y } = centre(meter.getBoundingClientRect())
  const flash = document.createElement('span')
  flash.className = 'fx-xp-flash'
  flash.style.left = `${x}px`
  flash.style.top = `${y}px`
  document.body.appendChild(flash)
  const peak = Math.min(0.85, 0.25 + k * 0.07)
  const anim = flash.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: peak },
      { transform: 'translate(-50%, -50%) scale(1.4)', opacity: 0 },
    ],
    { duration: 420 + k * 30, easing: 'ease-out', fill: 'forwards' },
  )
  anim.finished.catch(() => undefined).then(() => flash.remove())
  stage.playback.onCancel(() => {
    anim.cancel()
    flash.remove()
  })
}

function spawnCoins(meter: Element, k: number, stage: FxStage) {
  const { x: cx, y: cy } = centre(meter.getBoundingClientRect())
  const count = Math.min(58, 10 + k * 6)
  const spread = 26 + k * 6
  for (let i = 0; i < count; i += 1) {
    const coin = document.createElement('span')
    coin.className = 'fx-xp-coin'
    coin.style.left = `${cx}px`
    coin.style.top = `${cy}px`
    document.body.appendChild(coin)
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4
    const dist = spread * (0.6 + Math.random() * 0.5)
    const ox = Math.cos(angle) * dist
    const oy = Math.sin(angle) * dist
    const anim = coin.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${ox}px), calc(-50% + ${oy - 14}px)) scale(1) rotate(200deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${ox}px), calc(-50% + ${oy + 18}px)) scale(0.6) rotate(360deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 200, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
    )
    anim.finished.catch(() => undefined).then(() => coin.remove())
    stage.playback.onCancel(() => {
      anim.cancel()
      coin.remove()
    })
  }
}
