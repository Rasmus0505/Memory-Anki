import { playWebAudioComboMilestone, playWebAudioFireworkAccent } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import { triggerHaptic } from '@/shared/feedback/haptics'
import { emitComboMilestone, emitFlight } from '../particles'
import { spawnParticle } from '../particles/particleEngine'
import type { Point } from '../particles/particleModel'
import { FX_ANCHORS, anchorTarget, elementCenter, findAnchor } from '../core/anchors'
import { cue, defineCue } from '../core/director'
import { bumpElement, chargeElement, stampOn } from '../core/domFlourish'
import { FX_SKINS, pal, type FxSkinId } from '../skins'
import { pickRareShow } from '../rarity'

export interface XpGainCue {
  amount: number
  /** Where the gold lifts off from; defaults to screen center. */
  origin?: Point
}

export interface LevelUpCue {
  level: number
}

export interface StampUnlockCue {
  title: string
  /** Round-end ceremony (big) vs a quiet corner stamp mid-round. */
  ceremony: boolean
}

export interface QuestDoneCue {
  title: string
}

export interface PackUnboxCue {
  label: string
  /** Particle palette of the new world, so the reveal already speaks its colors. */
  skin: FxSkinId
}

declare module '../core/director' {
  interface FxCueMap {
    'xp.gain': XpGainCue
    'level.up': LevelUpCue
    'stamp.unlock': StampUnlockCue
    'quest.done': QuestDoneCue
    'level.tick': { element: Element }
    'pack.unbox': PackUnboxCue
  }
}

function floatText(at: Point, text: string, lifeMs = 1400) {
  const node = document.createElement('div')
  node.className = 'fx-float-text'
  node.setAttribute('aria-hidden', 'true')
  node.textContent = text
  node.style.left = `${at.x}px`
  node.style.top = `${at.y}px`
  document.body.appendChild(node)
  window.setTimeout(() => node.remove(), lifeMs)
}

const center = () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.45 })

defineCue('xp.gain', {
  scene: 'completion',
  label: '经验入账',
  group: '成长',
  sample: () => ({ amount: 128 }),
  play({ amount, origin }, stage) {
    if (!stage.gate.motion || amount <= 0) return
    const from = origin ?? center()
    const bar = findAnchor([FX_ANCHORS.xpBar, FX_ANCHORS.levelRing])
    floatText(from, `+${amount} 经验`)
    emitFlight({
      origin: from,
      target: () => elementCenter(bar),
      count: Math.min(18, 6 + Math.round(amount / 40)),
      glow: true,
      comet: true,
      fountain: 8,
      onFirstArrive: () => chargeElement(bar, 1),
    })
  },
})

defineCue('level.tick', {
  scene: 'review',
  label: '等级环跳动',
  group: '成长',
  play({ element }, stage) {
    if (!stage.gate.motion) return
    bumpElement(element, 1.12)
    chargeElement(element, 0.6)
  },
})

defineCue('level.up', {
  scene: 'completion',
  label: '升级典礼',
  group: '成长',
  sample: () => ({ level: 7 }),
  play({ level }, stage) {
    const at = elementCenter(findAnchor([FX_ANCHORS.xpBar, FX_ANCHORS.levelRing])) ?? center()
    if (stage.gate.haptic) triggerHaptic('celebrate')
    if (stage.gate.sound) playWebAudioComboMilestone({ milestoneStep: 3, volume: stage.gate.volume })
    if (!stage.gate.motion) return
    // A pillar of light rises from the bar, then the ring and star burst.
    for (let i = 0; i < 28; i += 1) {
      spawnParticle({ x: at.x + (Math.random() - 0.5) * 30, y: at.y, vy: -4 - Math.random() * 6, drag: 0.95, shape: 'glow', additive: true, size: 1.2 + Math.random() * 1.6, color: pal.gold, trail: 8, life: 1, delay: i * 0.02 })
    }
    stage.playback.at(380, () => emitComboMilestone(at, 20))
    stage.playback.at(520, () => stampOn(document.body, `升到 Lv.${level}`, 'screen', stage.playback))
    // Every level-up brings a rare show along: the promised "有盼头".
    stage.playback.at(1500, () => cue('rare.show', { show: pickRareShow(null) }, { owner: stage.playback.owner }))
  },
})

defineCue('stamp.unlock', {
  scene: 'milestone',
  label: '成就印章',
  group: '成长',
  sample: () => ({ title: '夜读人', ceremony: true }),
  play({ title, ceremony }, stage) {
    if (stage.gate.sound) playWebAudioFireworkAccent({ kind: ceremony ? 'all_clear_ready' : 'branch_clear', volume: stage.gate.volume * (ceremony ? 1 : 0.6) })
    if (!stage.gate.motion) return
    const node = stampOn(document.body, `印 · ${title}`, ceremony ? 'screen' : 'corner', stage.playback)
    if (!ceremony) return
    const rect = node.getBoundingClientRect()
    const at = rect.width ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : center()
    stage.playback.at(260, () => emitComboMilestone(at, 10))
  },
})

defineCue('pack.unbox', {
  scene: 'completion',
  label: '新主题开箱',
  group: '成长',
  sample: () => ({ label: '星河夜航', skin: 'galaxy' }),
  play({ label, skin }, stage) {
    const colors = FX_SKINS[skin]?.palette ?? pal
    const hues = [colors.gold, colors.amber, colors.leaf, colors.cream]
    if (stage.gate.haptic) triggerHaptic('celebrate')
    if (stage.gate.sound) playWebAudioComboMilestone({ milestoneStep: 2, volume: stage.gate.volume })
    if (!stage.gate.motion) return
    const w = window.innerWidth
    const h = window.innerHeight
    // A curtain of the new world's light rises from the floor, twisting into a spiral.
    for (let i = 0; i < 64; i += 1) {
      const lane = (i / 64) * w
      const twist = Math.sin(i * 0.9) * 2.2
      spawnParticle({
        x: lane,
        y: h + 12,
        vx: twist,
        vy: -6 - Math.random() * 7,
        drag: 0.965,
        gravity: -0.02,
        shape: colors.sparkShape === 'star' && i % 3 === 0 ? 'star' : 'glow',
        additive: true,
        size: 1 + Math.random() * 1.8,
        color: hues[i % hues.length],
        trail: 6,
        life: 1.3,
        delay: (i % 16) * 0.035,
      })
    }
    stage.playback.at(620, () => stampOn(document.body, `新世界 · ${label}`, 'screen', stage.playback))
  },
})

defineCue('quest.done', {
  scene: 'milestone',
  label: '委托完成',
  group: '成长',
  sample: () => ({ title: '攻克 3 个薄弱点' }),
  play({ title }, stage) {
    if (stage.gate.sound) playWebAudioFireworkAccent({ kind: 'branch_clear', volume: stage.gate.volume * 0.7 })
    if (!stage.gate.motion) return
    stampOn(document.body, `✓ ${title}`, 'corner', stage.playback)
    const ring = findAnchor(FX_ANCHORS.levelRing)
    const at = elementCenter(ring)
    if (at) emitFlight({ origin: { x: window.innerWidth - 80, y: 90 }, target: anchorTarget(FX_ANCHORS.levelRing), count: 6, glow: true, onFirstArrive: () => bumpElement(ring) })
  },
})
