import { openPlayback, type FxPlayback } from './owner'
import { resolveFxGate, type FxGate, type FxScene } from './policy'

/**
 * Cue → recipe director. Business code states *what happened* (`cue('grade.commit', …)`);
 * a recipe decides how that feels across particles, sound, haptics and DOM flourishes.
 * Recipes register themselves, so skins, rare shows and the FX Lab can swap or
 * replay them without touching callers.
 */

// Declaration-merged by recipe modules: `declare module '…/director' { interface FxCueMap { … } }`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FxCueMap {}

export type FxCueName = keyof FxCueMap & string

export interface FxStage {
  gate: FxGate
  playback: FxPlayback
  /** Lab/preview playback: nested scene checks should pass too. */
  forced: boolean
  /** Gate of another scene, for recipes that escalate (e.g. a combo milestone). */
  gateOf: (scene: FxScene) => FxGate
}

export interface FxRecipe<P> {
  scene: FxScene
  /** Short Chinese label for the FX Lab. */
  label: string
  /** Lab group heading. */
  group: string
  /** Payload the FX Lab replays when no real one is at hand. */
  sample?: () => P
  play: (payload: P, stage: FxStage) => void
}

export interface FxCueOptions {
  /** Owner identity; retiring it cancels every pending step of this cue. */
  owner?: string
  /** Lab/preview: ignore settings and play every channel. */
  force?: boolean
}

type AnyRecipe = FxRecipe<never>
const recipes = new Map<string, AnyRecipe>()
type CueListener = (name: string, payload: unknown) => void
const listeners = new Set<CueListener>()

export function defineCue<N extends FxCueName>(name: N, recipe: FxRecipe<FxCueMap[N]>) {
  recipes.set(name, recipe as unknown as AnyRecipe)
}

const FORCED: FxGate = { motion: true, sound: true, haptic: true, volume: 1 }

export function cue<N extends FxCueName>(name: N, payload: FxCueMap[N], options: FxCueOptions = {}): FxPlayback | null {
  const recipe = recipes.get(name) as FxRecipe<FxCueMap[N]> | undefined
  if (!recipe || typeof window === 'undefined') return null
  const gate = options.force ? FORCED : resolveFxGate(recipe.scene)
  listeners.forEach((listener) => listener(name, payload))
  if (!gate.motion && !gate.sound && !gate.haptic) return null
  const playback = openPlayback(options.owner)
  const forced = options.force === true
  recipe.play(payload, { gate, playback, forced, gateOf: (scene) => (forced ? FORCED : resolveFxGate(scene)) })
  return playback
}

export function listCues() {
  return Array.from(recipes.entries()).map(([name, recipe]) => ({
    name: name as FxCueName,
    label: recipe.label,
    group: recipe.group,
    scene: recipe.scene,
    hasSample: typeof recipe.sample === 'function',
  }))
}

/** FX Lab: replay a cue with its sample payload on every channel. */
export function replayCue(name: FxCueName) {
  const recipe = recipes.get(name) as FxRecipe<unknown> | undefined
  if (!recipe?.sample) return null
  return cue(name, recipe.sample() as FxCueMap[typeof name], { force: true, owner: 'fx:lab' })
}

export function onCue(listener: CueListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function __clearCuesForTests() {
  recipes.clear()
  listeners.clear()
}
