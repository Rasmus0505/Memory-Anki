import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'

type EditorDoc = MindMapEditorState['editor_doc']

interface HistoryState {
  past: EditorDoc[]
  future: EditorDoc[]
}

const HISTORY_LIMIT = 100

function fingerprint(editorDoc: EditorDoc) {
  return JSON.stringify(editorDoc ?? null)
}

export function pushMindMapHistory(
  history: HistoryState,
  current: EditorDoc,
  limit = HISTORY_LIMIT,
): HistoryState {
  return {
    past: [...history.past, current].slice(-limit),
    future: [],
  }
}

export function undoMindMapHistory(history: HistoryState, current: EditorDoc) {
  const previous = history.past.at(-1)
  if (previous === undefined) return null
  return {
    editorDoc: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
    } satisfies HistoryState,
  }
}

export function redoMindMapHistory(history: HistoryState, current: EditorDoc) {
  const next = history.future[0]
  if (next === undefined) return null
  return {
    editorDoc: next,
    history: {
      past: [...history.past, current].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    } satisfies HistoryState,
  }
}

export function useMindMapEditHistory(
  incomingEditorDoc: EditorDoc,
  onApply: (editorDoc: EditorDoc) => void,
) {
  const historyRef = useRef<HistoryState>({ past: [], future: [] })
  const currentEditorDocRef = useRef<EditorDoc>(incomingEditorDoc)
  const pendingLocalFingerprintsRef = useRef<Set<string>>(new Set())
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const incomingFingerprint = fingerprint(incomingEditorDoc)
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false })

  const syncAvailability = useCallback((history: HistoryState) => {
    const nextCanUndo = history.past.length > 0
    const nextCanRedo = history.future.length > 0
    setAvailability((current) =>
      current.canUndo === nextCanUndo && current.canRedo === nextCanRedo
        ? current
        : { canUndo: nextCanUndo, canRedo: nextCanRedo },
    )
  }, [])

  const replaceHistory = useCallback(
    (history: HistoryState) => {
      historyRef.current = history
      syncAvailability(history)
    },
    [syncAvailability],
  )

  const publish = useCallback((editorDoc: EditorDoc) => {
    currentEditorDocRef.current = editorDoc
    pendingLocalFingerprintsRef.current.add(fingerprint(editorDoc))
    if (pendingLocalFingerprintsRef.current.size > HISTORY_LIMIT * 2) {
      const oldest = pendingLocalFingerprintsRef.current.values().next().value
      if (typeof oldest === 'string') pendingLocalFingerprintsRef.current.delete(oldest)
    }
    onApplyRef.current(editorDoc)
  }, [])

  const commit = useCallback(
    (editorDoc: EditorDoc) => {
      const current = currentEditorDocRef.current
      if (fingerprint(current) === fingerprint(editorDoc)) return false
      replaceHistory(pushMindMapHistory(historyRef.current, current))
      publish(editorDoc)
      return true
    },
    [publish, replaceHistory],
  )

  const undo = useCallback(() => {
    const result = undoMindMapHistory(historyRef.current, currentEditorDocRef.current)
    if (!result) return false
    replaceHistory(result.history)
    publish(result.editorDoc)
    return true
  }, [publish, replaceHistory])

  const redo = useCallback(() => {
    const result = redoMindMapHistory(historyRef.current, currentEditorDocRef.current)
    if (!result) return false
    replaceHistory(result.history)
    publish(result.editorDoc)
    return true
  }, [publish, replaceHistory])

  const getCurrentEditorDoc = useCallback(() => currentEditorDocRef.current, [])

  useEffect(() => {
    if (pendingLocalFingerprintsRef.current.has(incomingFingerprint)) {
      pendingLocalFingerprintsRef.current.delete(incomingFingerprint)
      if (fingerprint(currentEditorDocRef.current) === incomingFingerprint) {
        currentEditorDocRef.current = incomingEditorDoc
      }
      return
    }
    if (fingerprint(currentEditorDocRef.current) === incomingFingerprint) return

    currentEditorDocRef.current = incomingEditorDoc
    pendingLocalFingerprintsRef.current.clear()
    replaceHistory({ past: [], future: [] })
  }, [incomingEditorDoc, incomingFingerprint, replaceHistory])

  return {
    ...availability,
    commit,
    undo,
    redo,
    getCurrentEditorDoc,
  }
}

export type { HistoryState as MindMapEditHistoryState }
