import { playWebAudioLayeredPops } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import type { PopRole } from '@/shared/feedback/mindmap-audio/layeredPops'
import { defineCue } from '../core/director'
import { jellyOn } from '../core/jelly'

// Recall cues reuse the existing audio voices. Each newly revealed character gets one
// randomly chosen voice, so a ladder step sounds like a short run of random pops.

/** Gap between the pops of one step, so a multi-character step reads as separate reveals. */
const CHAR_POP_GAP_MS = 90
/** The existing voices a character reveal may pick from. */
const CHAR_POP_ROLES: readonly PopRole[] = ['reveal', 'select', 'land', 'deal']

export interface RecallReadyCue {
  /** The cue bubble that just appeared beside the focused card. */
  chip: Element
}

export interface RecallStepCue {
  /** The cue button the learner pressed. */
  chip: Element
  /** 1-based level just shown. */
  level: number
  /** How many characters this step newly revealed. */
  newChars: number
}

declare module '../core/director' {
  interface FxCueMap {
    'recall.ready': RecallReadyCue
    'recall.step': RecallStepCue
  }
}

// The learner has been stuck on one card for a while: the bubble springs up beside it.
defineCue('recall.ready', {
  scene: 'review',
  play({ chip }, stage) {
    if (stage.gate.sound) playWebAudioLayeredPops({ role: 'select', volume: stage.gate.volume })
    if (!stage.gate.motion) return
    jellyOn(chip, 'pop')
  },
})

// Each newly revealed character plays one random existing voice, spaced by CHAR_POP_GAP_MS.
defineCue('recall.step', {
  scene: 'review',
  play({ chip, newChars }, stage) {
    if (stage.gate.sound) {
      for (let index = 0; index < newChars; index += 1) {
        const role = CHAR_POP_ROLES[Math.floor(Math.random() * CHAR_POP_ROLES.length)]
        const step = 1 + Math.floor(Math.random() * 3)
        stage.playback.at(index * CHAR_POP_GAP_MS, () => {
          playWebAudioLayeredPops({ role, step, volume: stage.gate.volume })
        })
      }
    }
    if (stage.gate.motion) jellyOn(chip, 'press')
  },
})
