import { useSyncExternalStore } from 'react'

export interface QuizComboSnapshot {
  /** The scope this streak belongs to (one palace bank, one round overlay). */
  key: string | null
  combo: number
  /** Bumps on every answer so the chip can replay its digit roll. */
  nonce: number
}

// One answering surface at a time owns the streak, so a module-level store is
// enough; keying it by scope means switching palaces never inherits a streak.
let snapshot: QuizComboSnapshot = { key: null, combo: 0, nonce: 0 }
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

/** A correct answer extends the streak; a wrong one ends it quietly. */
export function recordQuizAnswer(key: string | null, correct: boolean): QuizComboSnapshot {
  const base = snapshot.key === key ? snapshot.combo : 0
  snapshot = {
    key,
    combo: correct ? base + 1 : 0,
    nonce: snapshot.nonce + 1,
  }
  emit()
  return snapshot
}

export function resetQuizCombo() {
  snapshot = { key: null, combo: 0, nonce: snapshot.nonce + 1 }
  emit()
}

export function readQuizCombo(key: string | null): number {
  return snapshot.key === key ? snapshot.combo : 0
}

export function useQuizCombo(key: string | null): number {
  return useSyncExternalStore(
    subscribe,
    () => (snapshot.key === key ? snapshot.combo : 0),
    () => 0,
  )
}
