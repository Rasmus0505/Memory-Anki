import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import {
  Handle,
  Position,
  type NodeProps,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { Scissors } from 'lucide-react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNode, MindMapNodeVisual } from './adapter'
import { getNodeSize, type LayoutRole, type NodeSize } from './layout'
import type {
  SelectionToolbarAction,
  SelectionToolbarPreferPosition,
} from './selectionToolbar'
import {
  AdaptiveNodeToolbar,
  selectionToolbarButtonClass,
  statusChipClassName,
} from './NodeCardToolbar'
import { ExtractDropPlaceholders, ExtractGhostPortal } from './MindMapExtractUi'
import { useMindMapExtractDrag } from './useMindMapExtractDrag'

type NodeCardData = MindMapNode & {
  depth?: number
  selected?: boolean
  dropHighlight?: boolean
  dropMode?: 'before' | 'inside' | 'after' | null
  previewShifted?: boolean
  previewAdopt?: boolean
  previewGhost?: boolean
  editing?: boolean
  editText?: string | null
  selectEditText?: boolean
  readonly?: boolean
  onStartEdit?: (nodeId: string) => void
  onCancelEdit?: (nodeId: string) => void
  onEditTextChange?: (nodeId: string, text: string) => void
  onFinishEdit?: (nodeId: string, text: string) => void
  onAddChild?: (nodeId: string) => void
  onAddSibling?: (nodeId: string) => void
  onDelete?: (nodeId: string) => void
  onMeasure?: (nodeId: string, size: NodeSize) => void
  onReadonlyDoubleClick?: (nodeId: string) => void
  onTouchLongPress?: (nodeId: string, point: { x: number; y: number }) => void
  onExtractSelection?: (payload: {
    sourceId: string
    liveText: string
    start: number
    end: number
    placement: { mode: 'inside' | 'before' | 'after'; targetUid: string }
  }) => void
  onExtractDropPreview?: (
    next: { targetId: string; mode: 'before' | 'inside' | 'after' } | null,
  ) => void
  selectionToolbarActions?: SelectionToolbarAction[]
  selectionToolbarPreferPosition?: SelectionToolbarPreferPosition
}

const MEASURE_DELTA_PX = 1
const LONG_PRESS_DELAY_MS = 550
const LONG_PRESS_MOVE_TOLERANCE_PX = 18
const SYNTHETIC_CONTEXT_MENU_WINDOW_MS = 1_000
/** Ignore blur right after entering edit (layout/toolbar teardown can steal focus). */
const EDIT_BLUR_GUARD_MS = 180

interface EditSnapshot {
  value: string
  selectionStart: number
  selectionEnd: number
}

function getMouseFeedbackPoint(event?: MouseEvent) {
  return event
    ? {
        x: event.clientX,
        y: event.clientY,
      }
    : undefined
}

function getElementFeedbackPoint(element: HTMLElement | null) {
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

function MindMapNodeCard({ data, id }: NodeProps) {
  const nodeData = data as unknown as NodeCardData
  const metadata = nodeData.metadata ?? {}
  const depth = Number(metadata.depth ?? 0)
  const layoutRole = String(
    metadata.layoutRole ?? (depth === 0 ? 'root' : 'branch'),
  ) as LayoutRole
  const isRoot = layoutRole === 'root'
  const [localEdit, setLocalEdit] = useState(false)
  const [editText, setEditText] = useState(nodeData.label)
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastMeasuredRef = useRef<NodeSize | null>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const longPressTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const longPressTriggeredRef = useRef(false)
  const suppressSyntheticContextMenuUntilRef = useRef(0)
  const [longPressPending, setLongPressPending] = useState(false)
  const editingIsControlled = typeof nodeData.editing === 'boolean'
  const isEditing = editingIsControlled ? Boolean(nodeData.editing) : localEdit
  const editValue = editText
  const nodeSize = getNodeSize(layoutRole, isEditing ? editValue : nodeData.label)
  const readonly = Boolean(nodeData.readonly)
  const onMeasure = nodeData.onMeasure
  const wasEditingRef = useRef(false)
  const editHistoryRef = useRef<{ past: EditSnapshot[]; future: EditSnapshot[] }>({ past: [], future: [] })
  const pendingInputSnapshotRef = useRef<EditSnapshot | null>(null)
  const compositionStartSnapshotRef = useRef<EditSnapshot | null>(null)
  const isComposingRef = useRef(false)
  const editSessionClosedRef = useRef(false)
  const editStartedAtRef = useRef(0)
  const extract = useMindMapExtractDrag({
    nodeId: id,
    editValue,
    inputRef,
    onExtractSelection: nodeData.onExtractSelection,
    onExtractDropPreview: nodeData.onExtractDropPreview,
  })

  const visual = (metadata.visual ?? {}) as MindMapNodeVisual
  const concealed = Boolean(visual.concealText)
  const placeholder = Boolean(visual.placeholder)
  const outlineTones = new Set(visual.outlineTones ?? [])
  const previewGhost = Boolean(nodeData.previewGhost)
  const previewAdopt = Boolean(nodeData.previewAdopt)
  const dropMode = nodeData.dropMode ?? null
  const previewShifted = Boolean(nodeData.previewShifted)

  const reportMeasuredSize = useCallback(
    (width: number, height: number) => {
      if (width <= 0 || height <= 0) return

      const nextSize = { width, height }
      const previousSize = lastMeasuredRef.current
      if (
        previousSize &&
        Math.abs(previousSize.width - nextSize.width) <= MEASURE_DELTA_PX &&
        Math.abs(previousSize.height - nextSize.height) <= MEASURE_DELTA_PX
      ) {
        return
      }

      lastMeasuredRef.current = nextSize
      onMeasure?.(id, nextSize)
      updateNodeInternals(id)
    },
    [id, onMeasure, updateNodeInternals],
  )

  useLayoutEffect(() => {
    const element = shellRef.current
    if (!element) return undefined

    const measure = () => {
      const rect = element.getBoundingClientRect()
      reportMeasuredSize(rect.width, rect.height)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [reportMeasuredSize])

  const resizeEditor = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [])

  const restoreEditSnapshot = useCallback((snapshot: EditSnapshot) => {
    setEditText(snapshot.value)
    nodeData.onEditTextChange?.(id, snapshot.value)
    requestAnimationFrame(() => {
      resizeEditor()
      inputRef.current?.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
    })
  }, [id, nodeData, resizeEditor])

  useEffect(() => {
    if (!isEditing) {
      wasEditingRef.current = false
      return
    }
    if (wasEditingRef.current) return
    wasEditingRef.current = true
    editStartedAtRef.current = Date.now()
    const initialValue = typeof nodeData.editText === 'string' ? nodeData.editText : nodeData.label
    setEditText(initialValue)
    editHistoryRef.current = { past: [], future: [] }
    pendingInputSnapshotRef.current = null
    compositionStartSnapshotRef.current = null
    isComposingRef.current = false
    editSessionClosedRef.current = false
    const input = inputRef.current
    if (input) {
      input.focus({ preventScroll: true })
      resizeEditor()
    }
    requestAnimationFrame(() => {
      const nextInput = inputRef.current
      if (!nextInput) return
      nextInput.focus({ preventScroll: true })
      const selectionStart = nodeData.selectEditText ? 0 : initialValue.length
      const selectionEnd = nodeData.selectEditText ? initialValue.length : initialValue.length
      nextInput.setSelectionRange(selectionStart, selectionEnd)
    })
  }, [isEditing, nodeData.editText, nodeData.label, nodeData.selectEditText, resizeEditor])

  const startEdit = useCallback(
    (event?: MouseEvent) => {
      if (readonly) return
      event?.preventDefault()
      event?.stopPropagation()
      dispatchGlobalFeedback('node_edit_start', {
        point: getMouseFeedbackPoint(event),
        origin: 'node',
      })
      editStartedAtRef.current = Date.now()
      if (!editingIsControlled) setLocalEdit(true)
      setEditText(nodeData.label)
      nodeData.onStartEdit?.(id)
    },
    [editingIsControlled, id, nodeData, readonly],
  )

  const handleDoubleClick = useCallback(
    (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (readonly) {
        nodeData.onReadonlyDoubleClick?.(id)
        return
      }
      startEdit(event)
    },
    [id, nodeData, readonly, startEdit],
  )

  const commitEdit = useCallback(() => {
    if (editSessionClosedRef.current) return
    if (extract.isExtractDraggingNow()) {
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true })
      })
      return
    }
    if (Date.now() - editStartedAtRef.current < EDIT_BLUR_GUARD_MS) {
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true })
      })
      return
    }
    editSessionClosedRef.current = true
    if (editValue.trim()) {
      dispatchGlobalFeedback('text_commit', {
        point: getElementFeedbackPoint(inputRef.current),
        origin: 'keyboard',
      })
      nodeData.onFinishEdit?.(id, editValue.trim())
    } else {
      nodeData.onCancelEdit?.(id)
    }
    setLocalEdit(false)
  }, [editValue, extract, id, nodeData])

  const updateEditValue = useCallback(
    (nextValue: string) => {
      setEditText(nextValue)
      nodeData.onEditTextChange?.(id, nextValue)
    },
    [id, nodeData],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const primaryModifier = event.ctrlKey || event.metaKey
      const lowerKey = event.key.toLowerCase()
      if (primaryModifier && (lowerKey === 'z' || lowerKey === 'y')) {
        event.preventDefault()
        event.stopPropagation()
        const history = editHistoryRef.current
        const currentSnapshot = {
          value: editValue,
          selectionStart: event.currentTarget.selectionStart,
          selectionEnd: event.currentTarget.selectionEnd,
        }
        const redoRequested = lowerKey === 'y' || event.shiftKey
        if (redoRequested) {
          const next = history.future.pop()
          if (!next) return
          history.past.push(currentSnapshot)
          restoreEditSnapshot(next)
        } else {
          const previous = history.past.pop()
          if (!previous) return
          history.future.push(currentSnapshot)
          restoreEditSnapshot(previous)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        editSessionClosedRef.current = true
        setLocalEdit(false)
        setEditText(nodeData.label)
        nodeData.onCancelEdit?.(id)
        return
      }
      if (
        event.key === 'Tab' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        const start = event.currentTarget.selectionStart
        const end = event.currentTarget.selectionEnd
        const nextValue = `${editValue.slice(0, start)}\t${editValue.slice(end)}`
        updateEditValue(nextValue)
        requestAnimationFrame(() => {
          inputRef.current?.setSelectionRange(start + 1, start + 1)
        })
        return
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault()
        // Intentional commit — do not apply the post-enter blur guard.
        editStartedAtRef.current = 0
        event.currentTarget.blur()
      }
    },
    [editValue, id, nodeData, restoreEditSnapshot, updateEditValue],
  )

  const handleBeforeInput = useCallback(() => {
    const input = inputRef.current
    if (!input || isComposingRef.current) return
    pendingInputSnapshotRef.current = {
      value: editValue,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    }
  }, [editValue])

  const handleInput = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    if (!isComposingRef.current) {
      const snapshot = pendingInputSnapshotRef.current ?? {
        value: editValue,
        selectionStart: Math.min(event.target.selectionStart, editValue.length),
        selectionEnd: Math.min(event.target.selectionEnd, editValue.length),
      }
      if (snapshot.value !== event.target.value) {
        editHistoryRef.current.past.push(snapshot)
        editHistoryRef.current.future = []
      }
      pendingInputSnapshotRef.current = null
    }
    updateEditValue(event.target.value)
    requestAnimationFrame(resizeEditor)
  }, [editValue, resizeEditor, updateEditValue])

  const handleCompositionStart = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    isComposingRef.current = true
    compositionStartSnapshotRef.current = {
      value: editValue,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    }
  }, [editValue])

  const handleCompositionEnd = useCallback((event: CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false
    const snapshot = compositionStartSnapshotRef.current
    compositionStartSnapshotRef.current = null
    if (snapshot && snapshot.value !== event.currentTarget.value) {
      editHistoryRef.current.past.push(snapshot)
      editHistoryRef.current.future = []
    }
    updateEditValue(event.currentTarget.value)
    requestAnimationFrame(resizeEditor)
  }, [resizeEditor, updateEditValue])

  const effectiveDropMode = extract.localHoverMode ?? dropMode
  const showDropChrome = Boolean(extract.localHoverMode || nodeData.dropHighlight)
  const dropHighlightCls = showDropChrome
    ? effectiveDropMode === 'inside'
      ? 'ring-2 ring-emerald-400/70 bg-emerald-50/20'
      : 'ring-2 ring-sky-400/70 bg-sky-50/25'
    : ''

  const selectedCls =
    nodeData.selected && !isEditing
      ? 'ring-2 ring-zinc-400/70 ring-offset-1 ring-offset-white border-zinc-300'
      : ''

  const containerCls = [
    'flex items-center rounded-xl border bg-white',
    'transition-[box-shadow,opacity,transform,background-color,border-color] duration-100',
    isRoot ? 'border-zinc-300 shadow-sm justify-center' : 'border-zinc-200 shadow-sm',
    selectedCls,
    dropHighlightCls,
    previewAdopt ? 'ring-1 ring-blue-400/40' : '',
    placeholder ? 'ring-2 ring-amber-400/35' : '',
    outlineTones.has('danger') ? 'outline outline-2 outline-rose-400/55' : '',
    outlineTones.has('info') ? 'outline outline-2 outline-sky-400/70' : '',
  ].filter(Boolean).join(' ')

  const nodeMode = isEditing ? 'editing' : nodeData.selected ? 'selected' : 'idle'

  // Idle cards are structure-draggable; only editing / readonly need a deliberate mode change.
  const canStructureDrag = Boolean(!isEditing && !readonly)
  const textCls = [
    'w-full appearance-none border-0 bg-transparent p-0 break-all whitespace-pre-wrap',
    readonly ? 'cursor-default' : canStructureDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-text',
    concealed ? 'blur-[3px] select-none' : '',
    isRoot
      ? 'text-[14px] font-semibold leading-5 text-zinc-900 text-center'
      : depth === 1
        ? 'text-left text-[13px] font-medium leading-[17px] text-zinc-800'
        : 'text-left text-[12.5px] font-normal leading-[17px] text-zinc-700',
  ].filter(Boolean).join(' ')

  const paddingCls = isRoot ? 'px-4 py-2.5' : depth === 1 ? 'px-3 py-2' : 'px-2.5 py-1.5'
  const editorTextCls = isRoot
    ? 'text-center text-[14px] font-semibold leading-5 break-all whitespace-pre-wrap'
    : depth === 1
      ? 'text-left text-[13px] font-medium leading-[17px] break-all whitespace-pre-wrap'
      : 'text-left text-[12.5px] font-normal leading-[17px] break-all whitespace-pre-wrap'
  const borderStyle = visual.borderColor ? { borderColor: visual.borderColor } : undefined
  // Edit uses a thicker border than display; keep content width equal to display getNodeSize.
  const EDIT_BORDER_EXTRA_PX = 3
  const shellWidth = isEditing ? nodeSize.width + EDIT_BORDER_EXTRA_PX : nodeSize.width

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressStartRef.current = null
    setLongPressPending(false)
  }, [])

  const abortLongPress = useCallback(() => {
    clearLongPress()
    longPressTriggeredRef.current = false
  }, [clearLongPress])

  useEffect(() => {
    return () => {
      abortLongPress()
    }
  }, [abortLongPress])

  const triggerLongPress = useCallback(
    (point: { x: number; y: number }) => {
      longPressTriggeredRef.current = true
      suppressSyntheticContextMenuUntilRef.current = Date.now() + SYNTHETIC_CONTEXT_MENU_WINDOW_MS
      setLongPressPending(false)
      navigator.vibrate?.(35)
      nodeData.onTouchLongPress?.(id, point)
    },
    [id, nodeData],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const pointerType = event.pointerType || 'touch'
      if (!nodeData.onTouchLongPress || !readonly || pointerType === 'mouse' || event.isPrimary === false) return
      clearLongPress()
      longPressTriggeredRef.current = false
      longPressStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setLongPressPending(true)
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        triggerLongPress({
          x: longPressStartRef.current?.x ?? event.clientX,
          y: longPressStartRef.current?.y ?? event.clientY,
        })
      }, LONG_PRESS_DELAY_MS)
    },
    [clearLongPress, nodeData, readonly, triggerLongPress],
  )

  const finishPointerInteraction = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    clearLongPress()
  }, [clearLongPress])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (longPressTriggeredRef.current) return
    const start = longPressStartRef.current
    if (!start || event.pointerId !== start.pointerId) return
    const movedTooFar = Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    if (movedTooFar) abortLongPress()
  }, [abortLongPress])

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!longPressTriggeredRef.current) return
    event.preventDefault()
    event.stopPropagation()
    longPressTriggeredRef.current = false
  }, [])

  const handleContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const nativeEvent = event.nativeEvent as globalThis.MouseEvent & {
      pointerType?: string
      sourceCapabilities?: { firesTouchEvents?: boolean } | null
    }
    const isSyntheticTouchContextMenu = nativeEvent.pointerType === 'touch'
      || nativeEvent.sourceCapabilities?.firesTouchEvents === true
    const shouldSuppressSyntheticContextMenu =
      isSyntheticTouchContextMenu
      && Date.now() <= suppressSyntheticContextMenuUntilRef.current

    if (!shouldSuppressSyntheticContextMenu) return
    event.preventDefault()
    event.stopPropagation()
    suppressSyntheticContextMenuUntilRef.current = 0
  }, [])

  return (
    <div
      ref={shellRef}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={finishPointerInteraction}
      data-mindmap-node-id={id}
      data-node-mode={nodeMode}
      className={[
        'group relative transition-[opacity,transform] duration-100',
        canStructureDrag ? 'mindmap-node-drag-surface cursor-grab active:cursor-grabbing' : '',
        previewShifted ? 'translate-y-2' : '',
        previewGhost ? 'opacity-35 scale-[0.97]' : '',
        visual.highlighted ? 'ring-4 ring-warning/45 rounded-2xl' : '',
        visual.muted && !previewGhost ? 'opacity-60' : '',
      ].filter(Boolean).join(' ')}
      style={{ width: shellWidth, WebkitTouchCallout: 'none' }}
    >
      {longPressPending ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-3px] z-20 rounded-[14px] border-2 border-amber-400/80 animate-pulse"
        />
      ) : null}
      {nodeData.selected && !isEditing && (nodeData.selectionToolbarActions?.length ?? 0) > 0 ? (
        <AdaptiveNodeToolbar
          nodeId={id}
          preferPosition={nodeData.selectionToolbarPreferPosition ?? 'auto'}
          ariaLabel="节点操作"
        >
          {nodeData.selectionToolbarActions!.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={action.disabled}
              className={selectionToolbarButtonClass(action.variant)}
              onClick={(event) => {
                event.stopPropagation()
                action.onClick()
              }}
            >
              {action.label}
            </button>
          ))}
        </AdaptiveNodeToolbar>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />

      {isEditing ? (
        <div className={`relative ${showDropChrome ? dropHighlightCls : ''}`}>
          <ExtractDropPlaceholders mode={effectiveDropMode} visible={showDropChrome} />
          <textarea
            ref={inputRef}
            value={editValue}
            onChange={handleInput}
            onBeforeInput={handleBeforeInput}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            onSelect={(event) => extract.syncTextSelection(event.currentTarget)}
            onKeyUp={(event) => extract.syncTextSelection(event.currentTarget)}
            onMouseUp={(event) => extract.syncTextSelection(event.currentTarget)}
            onBlur={commitEdit}
            aria-label="编辑节点文本"
            data-node-mode="editing"
            className={[
              'nodrag nopan nowheel box-border block w-full resize-none overflow-hidden rounded-xl border-[2.5px] border-sky-500 bg-sky-50/90 text-zinc-900 outline-none ring-4 ring-sky-400/30 shadow-[0_0_0_1px_rgba(14,165,233,0.25)]',
              paddingCls,
              editorTextCls,
            ].join(' ')}
            style={{
              height: nodeSize.height,
              minHeight: nodeSize.height,
              // Match display card content width (shell already compensates thicker edit border).
              width: '100%',
              maxWidth: '100%',
              scrollbarWidth: 'none',
            }}
            rows={1}
          />
          {extract.showExtractHandle ? (
            <button
              type="button"
              data-extract-handle="true"
              aria-label="拖出选中文字为新卡片"
              title="拖到目标卡片：成为其子节点或同级"
              className="nodrag nopan absolute -right-2 -top-2 z-40 flex h-7 w-7 cursor-grab items-center justify-center rounded-full border border-sky-400 bg-white text-sky-600 shadow-md active:cursor-grabbing"
              onMouseDown={extract.handleExtractMouseDown}
              onPointerDown={extract.handleExtractPointerDown}
            >
              <Scissors className="size-3.5" />
            </button>
          ) : null}
          <ExtractGhostPortal ghost={extract.extractGhost} />
        </div>
      ) : (
        <div
          className={`relative ${containerCls} ${paddingCls}`}
          style={{ minHeight: nodeSize.height, ...borderStyle }}
        >
          <ExtractDropPlaceholders mode={effectiveDropMode} visible={showDropChrome} />
          {visual.statusChips && visual.statusChips.length > 0 ? (
            <div
              className="pointer-events-none absolute left-1/2 z-30 flex max-w-full -translate-x-1/2 items-center justify-center gap-0.5"
              style={{ top: '-1.35rem' }}
              aria-hidden="true"
            >
              {visual.statusChips.map((chip, index) => (
                <span
                  key={`${chip.text}-${chip.style}-${index}`}
                  title={chip.text}
                  className={[
                    'max-w-[5.5rem] truncate rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4 shadow-sm',
                    statusChipClassName(chip.tone, chip.style),
                  ].join(' ')}
                >
                  {chip.text}
                </span>
              ))}
            </div>
          ) : visual.badge && !isRoot ? (
            <span
              className={`absolute -left-2 -top-2 z-20 size-3 rounded-full border-2 border-background ${
                visual.badge.tone === 'danger'
                  ? 'bg-destructive'
                  : visual.badge.tone === 'success'
                    ? 'bg-success'
                    : visual.badge.tone === 'warning'
                      ? 'bg-warning'
                      : 'bg-muted-foreground/40'
              }`}
              title={visual.badge.title}
            />
          ) : null}
          <button
            type="button"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className={[
              'mindmap-node-text nopan',
              // Editing/readonly: isolate from RF drag. Idle: whole card is the drag surface.
              canStructureDrag ? '' : 'nodrag',
              textCls,
            ].filter(Boolean).join(' ')}
          >
            {concealed
              ? '待回忆'
              : nodeData.label || (isRoot ? '未命名主题' : '未命名知识点')}
          </button>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
    </div>
  )
}

const nodeTypes = { mindmapNode: memo(MindMapNodeCard) }
export { nodeTypes }
export default MindMapNodeCard
