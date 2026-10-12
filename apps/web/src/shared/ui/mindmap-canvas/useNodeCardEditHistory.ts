import { useCallback, useRef, type KeyboardEvent, type RefObject } from 'react'
import {
  hasHighlightMarkup,
  sanitizeMindMapRichHtml,
  serializeContentEditable,
} from '@/shared/lib/mindmapRichText'
import { placeContentEditableCaret, type EditSnapshot } from './nodeCardModel'

function snapshotOf(value: string): EditSnapshot {
  return { value, selectionStart: 0, selectionEnd: 0 }
}

export function useNodeCardEditHistory(options: {
  inputRef: RefObject<HTMLDivElement | null>
  editValue: string
  updateEditValue: (value: string) => void
  syncTextSelection: (element: HTMLDivElement) => void
  onCompositionChange: (composing: boolean) => void
}) {
  const { inputRef, editValue, updateEditValue, syncTextSelection, onCompositionChange } = options
  const historyRef = useRef<{ past: EditSnapshot[]; future: EditSnapshot[] }>({ past: [], future: [] })
  const pendingInputSnapshotRef = useRef<EditSnapshot | null>(null)
  const compositionStartSnapshotRef = useRef<EditSnapshot | null>(null)
  const isComposingRef = useRef(false)

  const readEditorSnapshot = useCallback((): EditSnapshot => {
    const input = inputRef.current
    return snapshotOf(input ? serializeContentEditable(input) : editValue)
  }, [editValue, inputRef])

  const restoreEditSnapshot = useCallback((snapshot: EditSnapshot) => {
    updateEditValue(snapshot.value)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      if (hasHighlightMarkup(snapshot.value)) {
        input.innerHTML = sanitizeMindMapRichHtml(snapshot.value)
      } else {
        input.textContent = snapshot.value
      }
      placeContentEditableCaret(input, { selectAll: false })
    })
  }, [inputRef, updateEditValue])

  const resetEditHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] }
    pendingInputSnapshotRef.current = null
    compositionStartSnapshotRef.current = null
    isComposingRef.current = false
  }, [])

  const recordChange = useCallback((value: string) => {
    historyRef.current.past.push(snapshotOf(value))
    historyRef.current.future = []
  }, [])

  const handleUndoRedoKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const lowerKey = event.key.toLowerCase()
      if (!(event.ctrlKey || event.metaKey) || (lowerKey !== 'z' && lowerKey !== 'y')) return false
      event.preventDefault()
      event.stopPropagation()
      const history = historyRef.current
      const currentSnapshot = readEditorSnapshot()
      const redoRequested = lowerKey === 'y' || event.shiftKey
      if (redoRequested) {
        const next = history.future.pop()
        if (!next) return true
        history.past.push(currentSnapshot)
        restoreEditSnapshot(next)
      } else {
        const previous = history.past.pop()
        if (!previous) return true
        history.future.push(currentSnapshot)
        restoreEditSnapshot(previous)
      }
      return true
    },
    [readEditorSnapshot, restoreEditSnapshot],
  )

  const handleBeforeInput = useCallback(() => {
    const input = inputRef.current
    if (!input || isComposingRef.current) return
    pendingInputSnapshotRef.current = readEditorSnapshot()
  }, [inputRef, readEditorSnapshot])

  const handleInput = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const nextValue = serializeContentEditable(input)
    if (!isComposingRef.current) {
      const snapshot = pendingInputSnapshotRef.current ?? snapshotOf(editValue)
      if (snapshot.value !== nextValue) {
        historyRef.current.past.push(snapshot)
        historyRef.current.future = []
      }
      pendingInputSnapshotRef.current = null
    }
    updateEditValue(nextValue)
    syncTextSelection(input)
  }, [editValue, inputRef, syncTextSelection, updateEditValue])

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
    onCompositionChange(true)
    compositionStartSnapshotRef.current = readEditorSnapshot()
  }, [onCompositionChange, readEditorSnapshot])

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false
    onCompositionChange(false)
    const input = inputRef.current
    if (!input) return
    const nextValue = serializeContentEditable(input)
    const snapshot = compositionStartSnapshotRef.current
    compositionStartSnapshotRef.current = null
    if (snapshot && snapshot.value !== nextValue) {
      historyRef.current.past.push(snapshot)
      historyRef.current.future = []
    }
    updateEditValue(nextValue)
  }, [inputRef, onCompositionChange, updateEditValue])

  return {
    isComposingRef,
    resetEditHistory,
    recordChange,
    handleUndoRedoKey,
    handleBeforeInput,
    handleInput,
    handleCompositionStart,
    handleCompositionEnd,
  }
}
