// Side-effect imports register every recipe before the first cue fires.
import './recipes/learning'
import './recipes/map'
import './recipes/xp'

export { cue, type FxCueMap, type FxCueName, type FxCueOptions } from './core/director'
export { openPlayback, retireOwner, skipOwner, resumeOwner, roundFxOwner, pendingPlaybackCount, type FxPlayback } from './core/owner'
export { resolveFxGate, type FxGate, type FxScene } from './core/policy'
export { FX_ANCHORS, PROGRESS_TARGET, findAnchor, fxAnchor, type FxAnchorName } from './core/anchors'
export { bumpElement, chargeElement, flashElement } from './core/domFlourish'
export { jellyOn, type JellyKind } from './core/jelly'
export { useFxOwner } from './useFxOwner'
