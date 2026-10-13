const STORAGE_KEY = 'memory-anki.freestyle.recall-cue-log.v1'
const MAX_ENTRIES = 500

/**
 * Local-only record of every cue step the learner asked for. It never reaches
 * scheduling: the rating stays what the learner chose. Kept on this device so
 * the habit can be reviewed later without a backend schema change.
 */
export interface RecallCueLogEntry {
  at: number
  cardId: string
  nodeUid: string
  level: number
}

export function readRecallCueLog(): RecallCueLogEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as RecallCueLogEntry[]) : []
  } catch {
    return []
  }
}

export function appendRecallCueLog(entry: RecallCueLogEntry) {
  if (typeof window === 'undefined') return
  const next = [...readRecallCueLog(), entry].slice(-MAX_ENTRIES)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota or private-mode failure: losing a log line must never block recall.
  }
}
