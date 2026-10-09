import { useEffect, useState } from 'react'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import { EMPTY_CLOZE_MARKS, vocabKey, type ClozeMarks } from './clozeReading'

export const CLOZE_MARKS_STORAGE_KEY = 'memory-anki.english-cloze-marks.v1'
export const CLOZE_MARKS_UPDATED_EVENT = 'memory-anki-english-cloze-marks-change'

function uniqueKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(vocabKey).filter(Boolean))].sort()
}

export function sanitizeClozeMarks(value: unknown): ClozeMarks {
  if (!value || typeof value !== 'object') return EMPTY_CLOZE_MARKS
  const record = value as Record<string, unknown>
  return { marked: uniqueKeys(record.marked), dismissed: uniqueKeys(record.dismissed) }
}

export function isClozeMarks(value: unknown): value is ClozeMarks {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as ClozeMarks).marked))
}

const store = createPersistentPreferenceStore<ClozeMarks>({
  cacheKey: 'english_cloze_marks',
  defaultValue: EMPTY_CLOZE_MARKS,
  localStorageKey: CLOZE_MARKS_STORAGE_KEY,
  sanitize: sanitizeClozeMarks,
  updatedEvent: CLOZE_MARKS_UPDATED_EVENT,
  isValidCache: isClozeMarks,
})

export function readClozeMarks() {
  return store.read()
}

export function writeClozeMarks(next: ClozeMarks) {
  return store.write(sanitizeClozeMarks(next))
}

export function useClozeMarks() {
  const [marks, setMarks] = useState<ClozeMarks>(() => store.read())
  useEffect(() => {
    const sync = () => setMarks(store.read())
    window.addEventListener(CLOZE_MARKS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(CLOZE_MARKS_UPDATED_EVENT, sync)
  }, [])
  return { marks, writeMarks: writeClozeMarks }
}
