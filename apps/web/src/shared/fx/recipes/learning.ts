import { playWebAudioFireworkAccent, playWebAudioLandingChime } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import { triggerHaptic } from '@/shared/feedback/haptics'
import {
  emitAmbientMote,
  emitBadgeBurst,
  emitCollectors,
  emitComboMilestone,
  emitCorrectBurst,
  emitFlight,
  emitInkDrop,
  emitInkSink,
  emitKeycapShockwave,
  emitLeafSpray,
  emitMeteorShower,
  emitPageDust,
  emitPaperPeel,
  emitRailSparks,
  emitRatingBurst,
  type ParticleRating,
} from '../particles'
import type { Point } from '../particles/particleModel'
import { FX_ANCHORS, PROGRESS_TARGET, anchorTarget, elementCenter, findAnchor } from '../core/anchors'
import { cue, defineCue, type FxStage } from '../core/director'
import { bumpElement, chargeElement, flashElement, flashVignette, peelGhost, stampOn } from '../core/domFlourish'
import { readRarityState, rollRare, writeRarityState } from '../rarity'

export interface GradeCommitCue {
  /** Top-center of the pressed keycap. */
  origin: Point
  /** The card surface the stamp lands on. */
  scope: HTMLElement
  grade: ParticleRating
  combo: number
  /** Combo just crossed a milestone step. */
  milestone: boolean
  /** Real study ratings roll for a rare show; previews and replays do not. */
  allowRare?: boolean
}

export interface FlipLandCue {
  origin: Point
  /** Container that holds this card's flip badge. */
  scope: ParentNode
}

export interface UnitCompleteCue {
  scope: ParentNode
  combo: number
}

export interface GradeUndoCue {
  button: Element
}

export interface CardRemoveCue {
  rect: DOMRect
}

export interface RetryDropCue {
  target: () => Point | null
}

export interface ProgressQuarterCue {
  rail: Element
  sparks: Point[]
}

export interface AnswerCue {
  paper: HTMLElement
}

export interface AreaClearCue {
  rect: DOMRect
}

export interface MotesCue {
  card: HTMLElement
}

export interface RoundCompleteCue {
  /** Caller-level reduced motion (e.g. freestyle display preference). */
  quiet?: boolean
}

declare module '../core/director' {
  interface FxCueMap {
    'grade.commit': GradeCommitCue
    'flip.land': FlipLandCue
    'unit.complete': UnitCompleteCue
    'grade.undo': GradeUndoCue
    'card.remove': CardRemoveCue
    'retry.drop': RetryDropCue
    'progress.quarter': ProgressQuarterCue
    'answer.correct': AnswerCue
    'answer.wrong': AnswerCue
    'area.clear': AreaClearCue
    'page.turn': Record<string, never>
    'card.motes': MotesCue
    'round.complete': RoundCompleteCue
  }
}

function chime(stage: FxStage, combo: number) {
  if (stage.gate.sound) playWebAudioLandingChime({ combo, volume: stage.gate.volume })
}

const progressSegment = () => findAnchor(PROGRESS_TARGET)
const progressTarget = anchorTarget(PROGRESS_TARGET)

function sampleSurface() {
  const w = window.innerWidth
  const h = window.innerHeight
  return { center: { x: w / 2, y: h * 0.62 }, rect: new DOMRect(w / 2 - 180, h * 0.3, 360, 240) }
}

defineCue('grade.commit', {
  scene: 'review',
  label: '评分落键',
  group: '学习 · 评分',
  sample: () => ({ origin: sampleSurface().center, scope: document.body, grade: 3, combo: 6, milestone: false }),
  play({ origin, scope, grade, combo, milestone, allowRare = false }, stage) {
    if (!stage.gate.motion) return
    if (allowRare) {
      const { show, next } = rollRare(readRarityState(), grade >= 2)
      writeRarityState(next)
      if (show) stage.playback.at(milestone ? 1200 : 650, () => cue('rare.show', { show, origin }, { owner: stage.playback.owner }))
    }
    emitRatingBurst(origin, grade, combo)
    emitKeycapShockwave(origin, grade)
    const segment = progressSegment()
    emitCollectors({
      origin,
      rating: grade,
      combo,
      target: progressTarget,
      onFirstArrive: () => {
        chargeElement(segment, grade >= 3 ? Math.min(1, combo / 8) : 0)
        chime(stage, combo)
      },
    })
    if (milestone && stage.gateOf('milestone').motion) {
      const rect = scope.getBoundingClientRect()
      emitComboMilestone({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, combo)
      stampOn(scope, `连击 ×${combo}`, 'stage', stage.playback)
      flashVignette(stage.playback)
    }
  },
})

defineCue('flip.land', {
  scene: 'review',
  label: '翻卡落定 → 翻卡计数',
  group: '学习 · 翻卡',
  play({ origin, scope }, stage) {
    if (!stage.gate.motion) return
    const badge = findAnchor(FX_ANCHORS.flipBadge, scope)
    if (!badge) return
    emitFlight({ origin, target: () => elementCenter(badge), count: 5, onFirstArrive: () => bumpElement(badge) })
  },
})

const UNIT_DONE_COMET_DELAY_MS = 520

defineCue('unit.complete', {
  scene: 'review',
  label: '单元翻完 → 彗星入轨',
  group: '学习 · 翻卡',
  play({ scope, combo }, stage) {
    if (!stage.gate.motion) return
    const badge = findAnchor(FX_ANCHORS.flipBadge, scope)
    const from = elementCenter(badge)
    if (!badge || !from) return
    bumpElement(badge, 1.35)
    emitBadgeBurst(from)
    const segment = progressSegment()
    stage.playback.at(UNIT_DONE_COMET_DELAY_MS, () => {
      const origin = elementCenter(badge)
      if (!origin) return
      emitFlight({
        origin,
        target: progressTarget,
        count: 12,
        glow: true,
        comet: true,
        fountain: 10,
        onFirstArrive: () => {
          chargeElement(segment, Math.min(1, Math.max(4, combo) / 8))
          chime(stage, combo + 2)
        },
      })
    })
  },
})

defineCue('grade.undo', {
  scene: 'review',
  label: '撤销评分（粒子倒飞）',
  group: '学习 · 评分',
  play({ button }, stage) {
    if (!stage.gate.motion) return
    const segment = progressSegment()
    const origin = elementCenter(segment)
    if (!origin) return
    flashElement(segment, 0.45)
    emitFlight({ origin, target: () => elementCenter(button), count: 6, onFirstArrive: () => bumpElement(button) })
  },
})

defineCue('card.remove', {
  scene: 'review',
  label: '移出队列（撕纸）',
  group: '学习 · 队列',
  sample: () => ({ rect: sampleSurface().rect }),
  play({ rect }, stage) {
    if (!stage.gate.motion || rect.width === 0) return
    peelGhost(rect)
    emitPaperPeel(rect)
  },
})

defineCue('retry.drop', {
  scene: 'review',
  label: '重试插队（墨滴）',
  group: '学习 · 队列',
  play({ target }, stage) {
    if (stage.gate.motion) emitInkDrop(target)
  },
})

defineCue('progress.quarter', {
  scene: 'review',
  label: '进度 25/50/75%',
  group: '学习 · 进度',
  play({ rail, sparks }, stage) {
    if (!stage.gate.motion) return
    flashElement(rail, 1.8)
    emitRailSparks(sparks)
  },
})

defineCue('answer.correct', {
  scene: 'review',
  label: '答对',
  group: '学习 · 做题',
  play({ paper }, stage) {
    if (!stage.gate.motion) return
    const center = elementCenter(paper)
    if (!center) return
    emitCorrectBurst(center)
    stampOn(paper, '✓ 答对', 'paper', stage.playback)
    const segment = progressSegment()
    emitFlight({ origin: center, target: progressTarget, count: 7, comet: true, fountain: 6, onFirstArrive: () => {
      chargeElement(segment, 3 / 8)
      chime(stage, 3)
    } })
  },
})

defineCue('answer.wrong', {
  scene: 'review',
  label: '答错（只沉一点墨）',
  group: '学习 · 做题',
  play({ paper }, stage) {
    const center = elementCenter(paper)
    if (stage.gate.motion && center) emitInkSink(center)
  },
})

defineCue('area.clear', {
  scene: 'review',
  label: '宫殿清空（叶与金）',
  group: '学习 · 进度',
  sample: () => ({ rect: new DOMRect(window.innerWidth / 2 - 200, 90, 400, 56) }),
  play({ rect }, stage) {
    if (stage.gate.motion) emitLeafSpray(rect)
  },
})

defineCue('page.turn', {
  scene: 'review',
  label: '翻页纸尘',
  group: '学习 · 翻页',
  sample: () => ({}),
  play(_payload, stage) {
    if (!stage.gate.motion) return
    const pager = findAnchor(FX_ANCHORS.feedPager)
    const rect = pager?.getBoundingClientRect() ?? sampleSurface().rect
    if (rect.width === 0) return
    const inset = rect.width * 0.12
    emitPageDust(rect.left + inset, rect.right - inset, rect.bottom - 18)
  },
})

const MOTE_INTERVAL_MS = 320

/** Long-running: slow motes drift off a key card until the playback is cancelled. */
defineCue('card.motes', {
  scene: 'ambient',
  label: '三星卡浮光',
  group: '学习 · 氛围',
  play({ card }, stage) {
    const timer = window.setInterval(() => {
      if (document.hidden || !card.isConnected || !stage.playback.alive()) return
      emitAmbientMote(card.getBoundingClientRect())
    }, MOTE_INTERVAL_MS)
    stage.playback.onCancel(() => window.clearInterval(timer))
  },
})

defineCue('round.complete', {
  scene: 'completion',
  label: '整轮完成（金色流星雨）',
  group: '学习 · 结算',
  sample: () => ({}),
  play({ quiet = false }, stage) {
    const motion = stage.gate.motion && !quiet
    stage.playback.at(motion ? 280 : 0, () => {
      if (stage.gate.haptic) triggerHaptic('celebrate')
      if (motion) {
        emitMeteorShower()
        stage.playback.at(1600, () => {
          const summary = findAnchor(FX_ANCHORS.roundSummary)
          if (!summary) return
          emitFlight({
            origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.4 },
            target: () => elementCenter(summary),
            count: 14,
            glow: true,
            comet: true,
            fountain: 12,
            onFirstArrive: () => flashElement(summary, 1.5),
          })
        })
        stage.playback.at(2300, () => stampOn(document.body, '本轮完成', 'screen', stage.playback))
      }
      if (stage.gate.sound) playWebAudioFireworkAccent({ kind: 'session_complete', volume: stage.gate.volume })
    })
  },
})
