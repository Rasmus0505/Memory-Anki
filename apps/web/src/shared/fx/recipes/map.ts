import { playWebAudioLayeredPops } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import type { LayeredPopOptions } from '@/shared/feedback/mindmap-audio/layeredPops'
import { defineCue } from '../core/director'

declare module '../core/director' {
  interface FxCueMap {
    'audio.pops': LayeredPopOptions
  }
}

/**
 * 分层短铃：一次动作一声，被带动的每个对象一记可数的弹跳。
 *
 * 调用方永远只发**一次** cue（N 张卡只发一次），交错由 offsetMs 在
 * playToneSequence 内部完成——N 次独立 cue 会被只保留最近一次的挂起音吞掉。
 */
defineCue('audio.pops', {
  scene: 'review',
  play({ role, count, grade, step }, stage) {
    if (!stage.gate.sound) return
    playWebAudioLayeredPops({ role, count, grade, step, volume: stage.gate.volume })
  },
})
