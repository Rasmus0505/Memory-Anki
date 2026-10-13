import { playWebAudioLayeredPops } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import { defineCue } from '../core/director'
import { jellyOn } from '../core/jelly'

/** Gives the chip time to mount before the pop lands on it. */
const CHIP_MOUNT_MS = 60
const CHIP_SELECTOR = '[data-recall-cue-chip]'

export interface RecallReadyCue {
  /** The flip panel host that renders the cue chip. */
  scope: ParentNode
}

export interface RecallStepCue {
  /** The cue chip the learner pressed. */
  chip: Element
  /** 1-based level just shown. */
  level: number
}

declare module '../core/director' {
  interface FxCueMap {
    'recall.ready': RecallReadyCue
    'recall.step': RecallStepCue
  }
}

// The learner has been stuck on one hidden card for a while: a soft low tone and
// the chip springs up. Quiet on purpose — it is a nudge, not a verdict.
defineCue('recall.ready', {
  scene: 'review',
  play({ scope }, stage) {
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'select', volume: stage.gate.volume })
    if (!stage.gate.motion) return
    stage.playback.at(CHIP_MOUNT_MS, () => {
      jellyOn(scope.querySelector(CHIP_SELECTOR), 'pop')
    })
  },
})

// Each step climbs one tone so the ear can count the hints without looking.
defineCue('recall.step', {
  scene: 'review',
  play({ chip, level }, stage) {
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'reveal', step: level, volume: stage.gate.volume })
    if (stage.gate.motion) jellyOn(chip, 'press')
  },
})
