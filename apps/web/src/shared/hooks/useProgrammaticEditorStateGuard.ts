import { useCallback, useEffect, useRef } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'

function fingerprintEditorState(state: MindMapEditorState) {
  try {
    return JSON.stringify(state.editor_doc ?? null) ?? 'null'
  } catch {
    return String(Date.now())
  }
}

interface GuardState {
  expectedFingerprint: string
  releaseAt: number
}

export function useProgrammaticEditorStateGuard() {
  const guardRef = useRef<GuardState | null>(null)
  const timerRef = useRef<number | null>(null)

  const releaseGuard = useCallback(() => {
    guardRef.current = null
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const beginGuard = useCallback(
    (nextState: MindMapEditorState, releaseAfterMs = 2500) => {
      releaseGuard()
      guardRef.current = {
        expectedFingerprint: fingerprintEditorState(nextState),
        releaseAt: Date.now() + releaseAfterMs,
      }
      timerRef.current = window.setTimeout(() => {
        releaseGuard()
      }, releaseAfterMs)
    },
    [releaseGuard],
  )

  const shouldBlockIncomingState = useCallback(
    (nextState: MindMapEditorState) => {
      const guard = guardRef.current
      if (!guard) return false
      if (Date.now() >= guard.releaseAt) {
        releaseGuard()
        return false
      }
      const nextFingerprint = fingerprintEditorState(nextState)
      if (nextFingerprint === guard.expectedFingerprint) {
        releaseGuard()
        return true
      }
      return true
    },
    [releaseGuard],
  )

  useEffect(() => releaseGuard, [releaseGuard])

  return {
    beginGuard,
    releaseGuard,
    shouldBlockIncomingState,
  }
}
