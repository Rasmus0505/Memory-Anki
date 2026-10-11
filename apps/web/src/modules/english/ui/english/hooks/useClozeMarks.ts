import { useEffect, useState } from 'react'
import {
  CLOZE_MARKS_UPDATED_EVENT,
  readClozeMarks,
  writeClozeMarks,
} from '../../../domain/english-cloze/clozeMarks'
import type { ClozeMarks } from '../../../domain/english-cloze/clozeReading'

export function useClozeMarks() {
  const [marks, setMarks] = useState<ClozeMarks>(() => readClozeMarks())
  useEffect(() => {
    const sync = () => setMarks(readClozeMarks())
    window.addEventListener(CLOZE_MARKS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(CLOZE_MARKS_UPDATED_EVENT, sync)
  }, [])
  return { marks, writeMarks: writeClozeMarks }
}
