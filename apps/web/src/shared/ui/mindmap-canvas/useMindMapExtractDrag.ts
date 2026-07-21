import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { plainOffsetsFromContentEditable, stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import {
  EXTRACT_DRAG_THRESHOLD_PX,
  resolveExtractDropTarget,
  type ExtractDropTarget,
} from './mindMapExtractDrag'

export type MindMapExtractSelectionPayload = {
  sourceId: string
  liveText: string
  start: number
  end: number
  placement: { mode: 'inside' | 'before' | 'after'; targetUid: string }
}

type EditorElement = HTMLTextAreaElement | HTMLElement

interface UseMindMapExtractDragInput {
  nodeId: string
  editValue: string
  inputRef: RefObject<EditorElement | null>
  onExtractSelection?: (payload: MindMapExtractSelectionPayload) => void
  onExtractDropPreview?: (next: ExtractDropTarget | null) => void
}

function readEditorPlainText(input: EditorElement | null, fallback: string) {
  if (!input) return stripMindMapHtml(fallback) || fallback
  if (input instanceof HTMLTextAreaElement) return input.value
  return (input.innerText || input.textContent || '').replace(/\u00a0/g, ' ')
}

function readEditorSelectionRange(input: EditorElement | null) {
  if (!input) return null
  if (input instanceof HTMLTextAreaElement) {
    if (input.selectionStart === input.selectionEnd) return null
    return {
      start: Math.min(input.selectionStart, input.selectionEnd),
      end: Math.max(input.selectionStart, input.selectionEnd),
    }
  }
  const offsets = plainOffsetsFromContentEditable(input)
  if (!offsets) return null
  return { start: offsets.start, end: offsets.end }
}

function restoreEditorSelection(input: EditorElement | null, range: { start: number; end: number }) {
  if (!input) return
  input.focus({ preventScroll: true })
  if (input instanceof HTMLTextAreaElement) {
    try {
      input.setSelectionRange(range.start, range.end)
    } catch {
      // ignore
    }
  }
}

export function useMindMapExtractDrag({
  nodeId,
  editValue,
  inputRef,
  onExtractSelection,
  onExtractDropPreview,
}: UseMindMapExtractDragInput) {
  const extractDraggingRef = useRef(false)
  const extractRangeRef = useRef<{ start: number; end: number } | null>(null)
  const extractLiveTextRef = useRef('')
  const extractSessionRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    active: boolean
    lastHoverKey: string
    selectedText: string
    range: { start: number; end: number }
    liveText: string
    previousUserSelect: string
  } | null>(null)
  const extractCallbacksRef = useRef({
    onExtractSelection,
    onExtractDropPreview,
  })
  extractCallbacksRef.current = {
    onExtractSelection,
    onExtractDropPreview,
  }

  const [textSelection, setTextSelection] = useState<{ start: number; end: number } | null>(null)
  const [isExtractDragging, setIsExtractDragging] = useState(false)
  const [extractGhost, setExtractGhost] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [extractHover, setExtractHover] = useState<ExtractDropTarget | null>(null)

  const isExtractDraggingNow = () => extractDraggingRef.current

  const syncTextSelection = useCallback((input: EditorElement) => {
    // While extracting, ignore selection collapses caused by temporary focus shifts.
    if (extractDraggingRef.current) return
    const next = readEditorSelectionRange(input)
    if (!next) {
      setTextSelection(null)
      extractRangeRef.current = null
      return
    }
    setTextSelection(next)
    extractRangeRef.current = next
  }, [])

  const readActiveSelectionRange = useCallback(() => {
    return readEditorSelectionRange(inputRef.current) ?? extractRangeRef.current ?? textSelection
  }, [inputRef, textSelection])

  const snapshotExtractSelection = useCallback(() => {
    const range = readActiveSelectionRange()
    if (range) extractRangeRef.current = range
    extractLiveTextRef.current = readEditorPlainText(inputRef.current, editValue)
    return range
  }, [editValue, inputRef, readActiveSelectionRange])

  // Document-level listeners outlive React re-renders of the scissors button
  // (setState on pointerdown would otherwise detach element-bound handlers).
  useEffect(() => {
    if (!isExtractDragging) return undefined

    const samePointer = (event: globalThis.PointerEvent, pointerId: number) => {
      const eventId = event.pointerId
      if (eventId == null || eventId === 0 || pointerId == null || pointerId === 0) return true
      return eventId === pointerId
    }

    const publishHover = (target: ExtractDropTarget | null) => {
      const session = extractSessionRef.current
      if (!session) return
      const key = target ? `${target.targetId}:${target.mode}` : ''
      if (key === session.lastHoverKey) return
      session.lastHoverKey = key
      setExtractHover(target)
      extractCallbacksRef.current.onExtractDropPreview?.(target)
    }

    const endSessionUi = () => {
      const session = extractSessionRef.current
      document.body.style.userSelect = session?.previousUserSelect ?? ''
      extractSessionRef.current = null
      extractDraggingRef.current = false
      setIsExtractDragging(false)
      setExtractGhost(null)
      setExtractHover(null)
      extractCallbacksRef.current.onExtractDropPreview?.(null)
    }

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const session = extractSessionRef.current
      if (!session || !samePointer(moveEvent, session.pointerId)) return
      moveEvent.preventDefault()
      const clientX = Number.isFinite(moveEvent.clientX) ? moveEvent.clientX : session.startX
      const clientY = Number.isFinite(moveEvent.clientY) ? moveEvent.clientY : session.startY
      setExtractGhost({
        x: clientX,
        y: clientY,
        text: session.selectedText,
      })
      const dx = clientX - session.startX
      const dy = clientY - session.startY
      if (!session.active && Math.hypot(dx, dy) < EXTRACT_DRAG_THRESHOLD_PX) {
        return
      }
      session.active = true
      publishHover(resolveExtractDropTarget(clientX, clientY))
    }

    const onUp = (upEvent: globalThis.PointerEvent) => {
      const session = extractSessionRef.current
      if (!session || !samePointer(upEvent, session.pointerId)) return
      upEvent.preventDefault()
      const clientX = Number.isFinite(upEvent.clientX) ? upEvent.clientX : session.startX
      const clientY = Number.isFinite(upEvent.clientY) ? upEvent.clientY : session.startY
      const wasActive = session.active
      const range = session.range
      const liveText = session.liveText
      endSessionUi()

      if (!wasActive) {
        restoreEditorSelection(inputRef.current, range)
        setTextSelection(range)
        return
      }

      const target = resolveExtractDropTarget(clientX, clientY)
      if (!target) {
        restoreEditorSelection(inputRef.current, range)
        setTextSelection(range)
        return
      }

      const liveRange = extractRangeRef.current ?? range
      extractCallbacksRef.current.onExtractSelection?.({
        sourceId: nodeId,
        liveText: extractLiveTextRef.current || liveText,
        start: liveRange.start,
        end: liveRange.end,
        placement: { mode: target.mode, targetUid: target.targetId },
      })
    }

    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)

    return () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [inputRef, isExtractDragging, nodeId])

  const handleExtractPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!extractCallbacksRef.current.onExtractSelection) return
      // Critical: preventDefault on pointerdown keeps the textarea focused so the
      // edit session is not committed via blur before the drag starts.
      event.preventDefault()
      event.stopPropagation()

      const range = snapshotExtractSelection()
      if (!range) return
      const liveText =
        extractLiveTextRef.current || readEditorPlainText(inputRef.current, editValue)
      const selectedText = liveText.slice(range.start, range.end).replace(/\s+/g, ' ').trim()
      if (!selectedText) return

      const startX = Number.isFinite(event.clientX) ? event.clientX : 0
      const startY = Number.isFinite(event.clientY) ? event.clientY : 0
      const pointerId = event.pointerId ?? 1

      extractDraggingRef.current = true
      extractRangeRef.current = range
      extractLiveTextRef.current = liveText
      extractSessionRef.current = {
        pointerId,
        startX,
        startY,
        active: false,
        lastHoverKey: '',
        selectedText,
        range,
        liveText,
        previousUserSelect: document.body.style.userSelect,
      }
      document.body.style.userSelect = 'none'
      setTextSelection(range)
      setExtractHover(null)
      setExtractGhost({ x: startX, y: startY, text: selectedText })
      setIsExtractDragging(true)

      try {
        event.currentTarget.setPointerCapture?.(pointerId)
      } catch {
        // Capture can fail if the element is detached; document listeners still work.
      }
    },
    [editValue, inputRef, snapshotExtractSelection],
  )

  const handleExtractMouseDown = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      // Prevent the textarea from blurring (which commits edit and kills the drag).
      event.preventDefault()
      event.stopPropagation()
      snapshotExtractSelection()
    },
    [snapshotExtractSelection],
  )

  const localHoverMode = extractHover?.targetId === nodeId ? extractHover.mode : null
  const showExtractHandle = Boolean(onExtractSelection && (textSelection || isExtractDragging))

  return {
    isExtractDraggingNow,
    isExtractDragging,
    extractGhost,
    localHoverMode,
    showExtractHandle,
    textSelection,
    syncTextSelection,
    handleExtractPointerDown,
    handleExtractMouseDown,
  }
}
