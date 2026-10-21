import { playWebAudioFireworkAccent, playWebAudioLandingChime, playWebAudioLayeredPops } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import { triggerHaptic } from '@/shared/feedback/haptics'
import { FX_ANCHORS, PROGRESS_TARGET, findAnchor } from '../core/anchors'
import { defineCue, type FxStage } from '../core/director'
import { chargeElement, flashElement, flashVignette, peelGhost, shakeScreen, stampOn } from '../core/domFlourish'
import { jellyOn } from '../core/jelly'

export interface GradeCommitCue {
  /** The card surface the feedback lands on. */
  scope: HTMLElement
  grade: number
  combo: number
  /** Combo just crossed a milestone step. */
  milestone: boolean
}

export interface FlipLandCue {
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
  element: Element
}

export interface ProgressQuarterCue {
  rail: Element | null
  /** 1 for 25%, 2 for 50%, 3 for 75% — the sound climbs with it. */
  step?: number
}

export interface AnswerCue {
  paper: HTMLElement
}

export interface AreaClearCue {
  element: Element
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
    'round.complete': RoundCompleteCue
  }
}

function chime(stage: FxStage, combo: number) {
  if (stage.gate.sound) playWebAudioLandingChime({ combo, volume: stage.gate.volume })
}

const progressSegment = () => findAnchor(PROGRESS_TARGET)

const UNIT_DONE_DELAY_MS = 520

defineCue('grade.commit', {
  scene: 'review',
  play({ scope, grade, combo, milestone }, stage) {
    const screenShake = stage.gate.gameplayFx?.screenShakeIntensity ?? 100
    if (stage.gate.motion) {
      const shakeLevel = screenShake / 100
      if (shakeLevel > 0) {
        shakeScreen(grade === 4 ? shakeLevel * 1.4 : grade === 1 ? shakeLevel * 0.4 : shakeLevel * 0.9)
      }
      jellyOn(scope, grade >= 3 ? 'pop' : 'press')
      const segment = progressSegment()
      jellyOn(segment, 'pop')
      chargeElement(segment, grade >= 3 ? Math.min(1, combo / 8) : 0)
    }
    chime(stage, combo)
    if (milestone && stage.gateOf('milestone').motion) {
      jellyOn(scope, 'wobble')
      stampOn(scope, `连击 ×${combo}`, 'stage', stage.playback)
      flashVignette(stage.playback)
    }
  },
})

defineCue('flip.land', {
  scene: 'review',
  play({ scope }, stage) {
    if (!stage.gate.motion) return
    jellyOn(findAnchor(FX_ANCHORS.flipBadge, scope), 'pop')
  },
})

defineCue('unit.complete', {
  scene: 'review',
  play({ scope, combo }, stage) {
    // Closing bell for the unit: the high ring is what tells the ear "that was the last one".
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'close', volume: stage.gate.volume })
    const badge = findAnchor(FX_ANCHORS.flipBadge, scope)
    if (stage.gate.motion) jellyOn(badge, 'wobble')
    const segment = progressSegment()
    stage.playback.at(UNIT_DONE_DELAY_MS, () => {
      if (stage.gate.motion) {
        jellyOn(segment, 'pop')
        chargeElement(segment, Math.min(1, Math.max(4, combo) / 8))
      }
      chime(stage, combo + 2)
    })
  },
})

defineCue('grade.undo', {
  scene: 'review',
  play({ button }, stage) {
    // Undo is the rating's inverse: one soft downward pop, heard even when the
    // card's motion is off, so the user knows the grade was taken back.
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'deny', volume: stage.gate.volume * 0.7 })
    if (!stage.gate.motion) return
    flashElement(progressSegment(), 0.45)
    jellyOn(button, 'press')
  },
})

defineCue('card.remove', {
  scene: 'review',
  play({ rect }, stage) {
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'remove', volume: stage.gate.volume })
    if (!stage.gate.motion || rect.width === 0) return
    peelGhost(rect)
  },
})

defineCue('retry.drop', {
  scene: 'review',
  play({ element }, stage) {
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'land', volume: stage.gate.volume })
    if (stage.gate.motion) jellyOn(element, 'pop')
  },
})

defineCue('progress.quarter', {
  scene: 'review',
  play({ rail, step }, stage) {
    // The step (1/2/3 for 25/50/75%) rides the payload so the three marks sound
    // like a rising ladder instead of three identical dings.
    if (stage.gate.sound) {
      playWebAudioLayeredPops({
        role: 'land',
        count: Math.max(1, Math.min(3, step ?? 1)),
        volume: stage.gate.volume,
      })
    }
    if (stage.gate.motion) jellyOn(rail, 'pop')
  },
})

defineCue('answer.correct', {
  scene: 'review',
  play({ paper }, stage) {
    if (stage.gate.motion) {
      jellyOn(paper, 'pop')
      stampOn(paper, '✓ 答对', 'paper', stage.playback)
      chargeElement(progressSegment(), 3 / 8)
    }
    chime(stage, 3)
  },
})

defineCue('answer.wrong', {
  scene: 'review',
  play({ paper }, stage) {
    // Soft low pop, not a buzzer: the quiz already shows 回答错误 in red, and the
    // tone is for the ear to notice the result, not to be punished by it.
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'deny', volume: stage.gate.volume })
    if (stage.gate.motion) jellyOn(paper, 'press')
  },
})

defineCue('area.clear', {
  scene: 'review',
  play({ element }, stage) {
    if (stage.gate.motion) jellyOn(element, 'wobble')
  },
})

defineCue('page.turn', {
  scene: 'review',
  play(_payload, stage) {
    if (stage.gate.motion) jellyOn(findAnchor(FX_ANCHORS.feedPager), 'press')
  },
})

defineCue('round.complete', {
  scene: 'completion',
  play({ quiet = false }, stage) {
    const motion = stage.gate.motion && !quiet
    stage.playback.at(motion ? 280 : 0, () => {
      if (stage.gate.haptic) triggerHaptic('celebrate')
      if (motion) {
        jellyOn(findAnchor(FX_ANCHORS.roundSummary), 'pop')
        stage.playback.at(2300, () => stampOn(document.body, '本轮完成', 'screen', stage.playback))
      }
      if (stage.gate.sound) playWebAudioFireworkAccent({ kind: 'session_complete', volume: stage.gate.volume })
    })
  },
})
