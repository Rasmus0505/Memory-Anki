import { isOwnerSkipped, openPlayback, type FxPlayback } from './owner'
import { resolveFxGate, type FxGate, type FxScene } from './policy'

/**
 * Cue → recipe director. Business code states *what happened* (`cue('grade.commit', …)`);
 * a recipe decides how that feels through sound, haptics and CSS jelly.
 */

// Declaration-merged by recipe modules: `declare module '…/director' { interface FxCueMap { … } }`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FxCueMap {}

export type FxCueName = keyof FxCueMap & string

export interface FxStage {
  gate: FxGate
  playback: FxPlayback
  /** Gate of another scene, for recipes that escalate (e.g. a combo milestone). */
  gateOf: (scene: FxScene) => FxGate
}

export interface FxRecipe<P> {
  scene: FxScene
  play: (payload: P, stage: FxStage) => void
}

export interface FxCueOptions {
  /** Owner identity; retiring it cancels every pending step of this cue. */
  owner?: string
}

type AnyRecipe = FxRecipe<never>
const recipes = new Map<string, AnyRecipe>()

export function defineCue<N extends FxCueName>(name: N, recipe: FxRecipe<FxCueMap[N]>) {
  recipes.set(name, recipe as unknown as AnyRecipe)
}

export function cue<N extends FxCueName>(name: N, payload: FxCueMap[N], options: FxCueOptions = {}): FxPlayback | null {
  const recipe = recipes.get(name) as FxRecipe<FxCueMap[N]> | undefined
  if (!recipe || typeof window === 'undefined' || (options.owner && isOwnerSkipped(options.owner))) return null
  const gate = resolveFxGate(recipe.scene)
  if (!gate.motion && !gate.sound && !gate.haptic) return null
  const playback = openPlayback(options.owner)
  recipe.play(payload, { gate, playback, gateOf: resolveFxGate })
  // Recipes that only perform synchronous work should not leave an idle owner entry.
  playback.finish()
  return playback
}

export function __clearCuesForTests() {
  recipes.clear()
}
