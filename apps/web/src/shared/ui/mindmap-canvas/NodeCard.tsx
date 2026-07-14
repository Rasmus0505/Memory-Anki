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
  type ReactNode,
} from 'react'
import {
  Handle,
  NodeToolbar,
  Position,
  type NodeProps,
  useStore,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { CornerDownRight, GripVertical, Pencil, Plus } from 'lucide-react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNode, MindMapNodeVisual } from './adapter'
import { getNodeSize, type LayoutRole, type NodeSize } from './layout'

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
}

const MEASURE_DELTA_PX = 1
const LONG_PRESS_DELAY_MS = 550
const LONG_PRESS_MOVE_TOLERANCE_PX = 18
const SYNTHETIC_CONTEXT_MENU_WINDOW_MS = 1_000

interface EditSnapshot {
  value: string
  selectionStart: number
  selectionEnd: number
}

function AdaptiveNodeToolbar({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const placement = useStore(
    useCallback((state) => {
      const internalNode = state.nodeLookup.get(nodeId)
      if (!internalNode) return 'top:center'
      const [translateX, translateY, zoom] = state.transform
      const absolute = internalNode.internals.positionAbsolute
      const measuredWidth = internalNode.measured.width ?? 220
      const screenTop = absolute.y * zoom + translateY
      const screenCenterX = (absolute.x + measuredWidth / 2) * zoom + translateX
      const position = screenTop < 76 ? 'bottom' : 'top'
      const align =
        screenCenterX < 170
          ? 'start'
          : screenCenterX > state.width - 170
            ? 'end'
            : 'center'
      return `${position}:${align}`
    }, [nodeId]),
  )
  const [position, align] = placement.split(':') as [
    'top' | 'bottom',
    'start' | 'center' | 'end',
  ]

  return (
    <NodeToolbar
      isVisible
      position={position === 'bottom' ? Position.Bottom : Position.Top}
      align={align}
      offset={12}
      className="nodrag nopan flex items-center gap-1 rounded-xl border border-border bg-background p-1 shadow-xl"
      style={{ zIndex: 1000 }}
      aria-label="卡片快捷操作"
    >
      {children}
    </NodeToolbar>
  )
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
    const initialValue = typeof nodeData.editText === 'string' ? nodeData.editText : nodeData.label
    setEditText(initialValue)
    editHistoryRef.current = { past: [], future: [] }
    pendingInputSnapshotRef.current = null
    compositionStartSnapshotRef.current = null
    isComposingRef.current = false
    editSessionClosedRef.current = false
    const input = inputRef.current
    if (input) {
      input.focus()
      resizeEditor()
    }
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      const selectionStart = nodeData.selectEditText ? 0 : initialValue.length
      const selectionEnd = nodeData.selectEditText ? initialValue.length : initialValue.length
      input.setSelectionRange(selectionStart, selectionEnd)
    })
  }, [isEditing, nodeData.editText, nodeData.label, nodeData.selectEditText, resizeEditor])

  const startEdit = useCallback(
    (event?: MouseEvent) => {
      if (readonly) return
      event?.stopPropagation()
      dispatchGlobalFeedback('node_edit_start', {
        point: getMouseFeedbackPoint(event),
        origin: 'node',
      })
      if (!editingIsControlled) setLocalEdit(true)
      setEditText(nodeData.label)
      nodeData.onStartEdit?.(id)
    },
    [editingIsControlled, id, nodeData, readonly],
  )

  const handleDoubleClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('.mindmap-node-drag-handle')) return
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
  }, [editValue, id, nodeData])

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

  const dropHighlightCls = nodeData.dropHighlight
    ? dropMode === 'inside'
      ? 'ring-2 ring-emerald-400/70 bg-emerald-50/20'
      : 'ring-2 ring-blue-400/60'
    : ''

  const containerCls = [
    'flex items-center rounded-xl border bg-white',
    'transition-[box-shadow,opacity,transform] duration-100',
    isRoot ? 'border-zinc-300 shadow-sm justify-center' : 'border-zinc-200 shadow-sm',
    nodeData.selected ? 'ring-2 ring-blue-500/55 ring-offset-1 ring-offset-white' : '',
    dropHighlightCls,
    previewAdopt ? 'ring-1 ring-blue-400/40' : '',
    placeholder ? 'ring-2 ring-amber-400/35' : '',
    outlineTones.has('danger') ? 'outline outline-2 outline-rose-400/55' : '',
    outlineTones.has('info') ? 'outline outline-2 outline-sky-400/70' : '',
  ].filter(Boolean).join(' ')

  const textCls = [
    'w-full appearance-none border-0 bg-transparent p-0 break-all whitespace-pre-wrap',
    readonly ? 'cursor-default' : 'cursor-text',
    concealed ? 'blur-[3px] select-none' : '',
    isRoot
      ? 'text-[14px] font-semibold leading-5 text-zinc-900 text-center'
      : depth === 1
        ? 'text-left text-[13px] font-medium leading-[17px] text-zinc-800'
        : 'text-left text-[12.5px] font-normal leading-[17px] text-zinc-700',
  ].filter(Boolean).join(' ')

  const paddingCls = isRoot ? 'px-4 py-2.5' : depth === 1 ? 'px-3 py-2' : 'px-2.5 py-1.5'
  const editorTextCls = isRoot
    ? 'text-center text-[14px] font-semibold leading-5'
    : depth === 1
      ? 'text-left text-[13px] font-medium leading-[17px]'
      : 'text-left text-[12.5px] font-normal leading-[17px]'
  const borderStyle = visual.borderColor ? { borderColor: visual.borderColor } : undefined

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
      className={[
        'group relative transition-[opacity,transform] duration-100',
        previewShifted ? 'translate-y-2' : '',
        previewGhost ? 'opacity-35 scale-[0.97]' : '',
        visual.highlighted ? 'ring-4 ring-warning/45 rounded-2xl' : '',
        visual.muted && !previewGhost ? 'opacity-60' : '',
      ].filter(Boolean).join(' ')}
      style={{ width: nodeSize.width, WebkitTouchCallout: 'none' }}
    >
      {longPressPending ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-3px] z-20 rounded-[14px] border-2 border-amber-400/80 animate-pulse"
        />
      ) : null}
      {nodeData.selected && !readonly && !isEditing ? (
        <AdaptiveNodeToolbar nodeId={id}>
          <button
            type="button"
            aria-label="新增子节点"
            title="新增子级（Tab）"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              nodeData.onAddChild?.(id)
            }}
          >
            <Plus className="size-3.5" />
            子级
          </button>
          {!isRoot ? (
            <button
              type="button"
              aria-label="新增同级节点"
              title="新增同级（Shift+Enter）"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                nodeData.onAddSibling?.(id)
              }}
            >
              <CornerDownRight className="size-3.5" />
              同级
            </button>
          ) : null}
          <button
            type="button"
            aria-label="编辑节点"
            title="编辑（Enter / F2）"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => startEdit(event)}
          >
            <Pencil className="size-3.5" />
            编辑
          </button>
        </AdaptiveNodeToolbar>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />

      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={handleInput}
          onBeforeInput={handleBeforeInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          aria-label="编辑节点文本"
          className={[
            'nodrag nopan nowheel block w-full resize-none overflow-hidden rounded-xl border-2 border-blue-500 bg-blue-50/45 text-zinc-900 outline-none ring-4 ring-blue-400/20',
            paddingCls,
            editorTextCls,
          ].join(' ')}
          style={{ height: nodeSize.height, minHeight: nodeSize.height, scrollbarWidth: 'none' }}
          rows={1}
        />
      ) : (
        <div
          className={`${containerCls} ${paddingCls}`}
          style={{ minHeight: nodeSize.height, ...borderStyle }}
        >
          {!readonly ? (
            <button
              type="button"
              className="mindmap-node-drag-handle absolute -left-3 top-1/2 z-20 flex h-8 w-6 -translate-y-1/2 cursor-grab items-center justify-center rounded-lg border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100 data-[selected=true]:opacity-100 active:cursor-grabbing"
              data-selected={nodeData.selected ? 'true' : 'false'}
              aria-label="拖动节点"
              title="拖动卡片"
            >
              <GripVertical className="size-3.5" />
            </button>
          ) : null}
          {visual.badge && !isRoot ? (
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
            className={`mindmap-node-text nodrag nopan ${textCls}`}
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
