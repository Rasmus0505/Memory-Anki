import { playWebAudioLayeredPops } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import type { LayeredPopOptions } from '@/shared/feedback/mindmap-audio/layeredPops'
import { emitFoldTrail, emitGoldDustSettle, emitGoldRain } from '../particles'
import type { Point } from '../particles/particleModel'
import { defineCue } from '../core/director'

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

declare module '../core/director' {
  interface FxCueMap {
    'map.land': MapLandCue
    'map.fold': MapFoldCue
    'map.branch': MapBranchCue
    'audio.pops': LayeredPopOptions
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

defineCue('map.branch', {
  scene: 'review',
  label: '整枝揭示（金雨）',
  group: '导图',
  sample: () => ({ rect: new DOMRect(0, 0, window.innerWidth, window.innerHeight * 0.7) }),
  play({ rect }, stage) {
    if (stage.gate.motion) emitGoldRain(rect)
  },
})

/**
 * 分层短铃：一次动作一声，被带动的每个对象一记可数的弹跳。
 *
 * 调用方永远只发**一次** cue（N 张卡只发一次），交错由 offsetMs 在
 * playToneSequence 内部完成——N 次独立 cue 会被只保留最近一次的挂起音吞掉。
 */
defineCue('audio.pops', {
  scene: 'review',
  label: '分层短铃（按张数连弹）',
  group: '导图',
  sample: () => ({ role: 'reveal', count: 4 }),
  play({ role, count, grade, step }, stage) {
    if (!stage.gate.sound) return
    playWebAudioLayeredPops({ role, count, grade, step, volume: stage.gate.volume })
  },
})
