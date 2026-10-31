// Side-effect imports register every recipe before the first cue fires.
import './recipes/learning'
import './recipes/map'

export { cue, type FxCueMap, type FxCueName, type FxCueOptions } from './core/director'
export { openPlayback, retireOwner, skipOwner, resumeOwner, roundFxOwner, pendingPlaybackCount, type FxPlayback } from './core/owner'
export { resolveFxGate, type FxGate, type FxScene } from './core/policy'
export { FX_ANCHORS, PROGRESS_TARGET, findAnchor, fxAnchor, type FxAnchorName } from './core/anchors'
export { bumpElement, chargeElement, flashElement } from './core/domFlourish'
export { jellyOn, type JellyKind } from './core/jelly'
export {
  clearMicroBubbles,
  showMicroBubble,
  type MicroBubbleOptions,
  type MicroBubblePart,
  type MicroBubblePlacement,
  type MicroBubbleTone,
} from './core/microBubble'
export { useFxOwner } from './useFxOwner'
