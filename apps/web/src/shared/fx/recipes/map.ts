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
  root?: Point
}

declare module '../core/director' {
  interface FxCueMap {
    'map.land': MapLandCue
    'map.fold': MapFoldCue
    'map.branch': MapBranchCue
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
  play({ rect, root }, stage) {
    if (stage.gate.motion) emitGoldRain(rect, 0, root)
  },
})
