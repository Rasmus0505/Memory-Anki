import { useSyncExternalStore } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import {
  comboMilestoneIndex,
  type FlowRatingReaction,
} from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'

export interface FreestyleComboSnapshot {
  combo: number
  best: number
  /** Index into the milestone steps when the latest rating landed exactly on one. */
  milestoneIndex: number | null
  /** Bumps on every rating so views can replay tick animations. */
  nonce: number
}

export interface FreestyleRatingPulse {
  rating: UnitRating
  reaction: FlowRatingReaction
  nonce: number
}

// Every card mounts its own feedback hook, so the streak must live above them.
let comboSnapshot: FreestyleComboSnapshot = { combo: 0, best: 0, milestoneIndex: null, nonce: 0 }
let ratingPulse: FreestyleRatingPulse | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function recordFreestyleComboRating(
  keepsCombo: boolean,
  milestoneSteps: readonly number[],
): FreestyleComboSnapshot {
  const combo = keepsCombo ? comboSnapshot.combo + 1 : 0
  comboSnapshot = {
    combo,
    best: Math.max(comboSnapshot.best, combo),
    milestoneIndex: keepsCombo ? comboMilestoneIndex(combo, milestoneSteps) : null,
    nonce: comboSnapshot.nonce + 1,
  }
  emit()
  return comboSnapshot
}

export function publishFreestyleRatingPulse(rating: UnitRating, reaction: FlowRatingReaction) {
  ratingPulse = { rating, reaction, nonce: (ratingPulse?.nonce ?? 0) + 1 }
  emit()
}

export function resetFreestyleCombo() {
  comboSnapshot = { combo: 0, best: 0, milestoneIndex: null, nonce: comboSnapshot.nonce + 1 }
  ratingPulse = null
  emit()
}

export function useFreestyleCombo() {
  return useSyncExternalStore(subscribe, () => comboSnapshot, () => comboSnapshot)
}

export function useFreestyleRatingPulse() {
  return useSyncExternalStore(subscribe, () => ratingPulse, () => ratingPulse)
}
