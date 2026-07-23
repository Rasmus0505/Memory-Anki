import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  Handle,
  Position,
  type NodeProps,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { Highlighter, Scissors } from 'lucide-react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  hasHighlightMarkup,
  sanitizeMindMapRichHtml,
  serializeContentEditable,
  stripMindMapHtml,
  toggleHighlightOnDomSelection,
} from '@/shared/lib/mindmapRichText'
import type { MindMapNodeVisual } from './adapter'
import { getNodeSize, type LayoutRole, type NodeSize } from './layout'
import {
  AdaptiveNodeToolbar,
  selectionToolbarButtonClass,
} from './NodeCardToolbar'
import { NodeCardStatusChrome, NodeCardTextFace } from './NodeCardChrome'
import { ExtractDropPlaceholders, ExtractGhostPortal } from './MindMapExtractUi'
import { useMindMapExtractDrag } from './useMindMapExtractDrag'
import {
  EDIT_BLUR_GUARD_MS,
  EDIT_FOCUS_RETRY_DELAYS_MS,
  MEASURE_DELTA_PX,
  getElementFeedbackPoint,
  getMouseFeedbackPoint,
  placeContentEditableCaret,
  resolveNodeRawText,
  type EditSnapshot,
  type NodeCardData,
} from './nodeCardModel'
import { useNodeCardLongPress } from './useNodeCardLongPress'

function MindMapNodeCard({ data, id }: NodeProps) {
  const nodeData = data as unknown as NodeCardData
  const metadata = nodeData.metadata ?? {}
  const depth = Number(metadata.depth ?? 0)
  const layoutRole = String(
    metadata.layoutRole ?? (depth === 0 ? 'root' : 'branch'),
  ) as LayoutRole
  const isRoot = layoutRole === 'root'
  const rawNodeText = resolveNodeRawText(nodeData)
  const isRichNode = Boolean(metadata.richText) || hasHighlightMarkup(rawNodeText)
  const displayHtml = isRichNode ? sanitizeMindMapRichHtml(rawNodeText) : ''
  const plainLabel = stripMindMapHtml(nodeData.label) || nodeData.label || ''
  const [localEdit, setLocalEdit] = useState(false)
  const [editText, setEditText] = useState(rawNodeText)
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const lastMeasuredRef = useRef<NodeSize | null>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const editingIsControlled = typeof nodeData.editing === 'boolean'
  // Parent `editing` is authoritative when true; localEdit covers optimistic enter
  // and uncontrolled cards so a lagging host cannot drop the first double-click.
  const isEditing = editingIsControlled
    ? Boolean(nodeData.editing) || localEdit
    : localEdit
  const editValue = editText
  const measureText = stripMindMapHtml(isEditing ? editValue : plainLabel) || plainLabel
  const nodeSize = getNodeSize(layoutRole, measureText)
  const readonly = Boolean(nodeData.readonly)
  const onMeasure = nodeData.onMeasure
  const wasEditingRef = useRef(false)
  const editHistoryRef = useRef<{ past: EditSnapshot[]; future: EditSnapshot[] }>({ past: [], future: [] })
  const pendingInputSnapshotRef = useRef<EditSnapshot | null>(null)
  const compositionStartSnapshotRef = useRef<EditSnapshot | null>(null)
  const isComposingRef = useRef(false)
  const editSessionClosedRef = useRef(false)
  const editStartedAtRef = useRef(0)
  /** True between optimistic startEdit and parent `editing=true` confirmation. */
  const optimisticEditPendingRef = useRef(false)
  const extract = useMindMapExtractDrag({
    nodeId: id,
    editValue,
    inputRef,
    onExtractSelection: nodeData.onExtractSelection,
    onExtractDropPreview: nodeData.onExtractDropPreview,
  })
  const longPress = useNodeCardLongPress({
    nodeId: id,
    readonly,
    onTouchLongPress: nodeData.onTouchLongPress,
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
      // Prefer untransformed layout size. getBoundingClientRect() includes React Flow
      // viewport zoom and can thrash measure→layout→zoom loops during review.
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (width > 0 && height > 0) {
        reportMeasuredSize(width, height)
        return
      }
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
    input.style.height = `${Math.max(input.scrollHeight, nodeSize.height)}px`
  }, [nodeSize.height])

  const restoreEditSnapshot = useCallback((snapshot: EditSnapshot) => {
    setEditText(snapshot.value)
    nodeData.onEditTextChange?.(id, snapshot.value)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      if (hasHighlightMarkup(snapshot.value)) {
        input.innerHTML = sanitizeMindMapRichHtml(snapshot.value)
      } else {
        input.textContent = snapshot.value
      }
      resizeEditor()
      placeContentEditableCaret(input, { selectAll: false })
    })
  }, [id, nodeData, resizeEditor])

  const focusEditorCaret = useCallback(
    (options?: { selectAll?: boolean; value?: string; seedContent?: boolean }) => {
      const input = inputRef.current
      if (!input || editSessionClosedRef.current) return false
      const selectAll = options?.selectAll ?? Boolean(nodeData.selectEditText)
      // Only seed DOM content when entering edit; later focus retries must not clobber typing.
      if (options?.seedContent && typeof options.value === 'string') {
        if (hasHighlightMarkup(options.value)) {
          input.innerHTML = sanitizeMindMapRichHtml(options.value)
        } else {
          input.textContent = options.value
        }
      }
      placeContentEditableCaret(input, { selectAll })
      resizeEditor()
      return document.activeElement === input
    },
    [nodeData.selectEditText, resizeEditor],
  )
  const focusEditorCaretRef = useRef(focusEditorCaret)
  focusEditorCaretRef.current = focusEditorCaret

  // Enter-edit only: put caret at end (or select-all for new nodes). Retry because
  // toolbar teardown / React Flow layout can steal focus right after the first attempt.
  // Must NOT re-run placement when draft text / node height changes mid-session —
  // that used to force the caret to the end and cause accidental end deletes.
  // Depends only on isEditing so resizeEditor/focusEditorCaret identity churn never
  // cancels enter-edit focus retries or re-places the caret while typing.
  useLayoutEffect(() => {
    if (!isEditing) {
      wasEditingRef.current = false
      return undefined
    }

    // Already in an edit session: never re-seed or re-place the caret.
    if (wasEditingRef.current) {
      return undefined
    }

    const initialValue =
      typeof nodeData.editText === 'string' ? nodeData.editText : resolveNodeRawText(nodeData)
    const selectAll = Boolean(nodeData.selectEditText)

    wasEditingRef.current = true
    editStartedAtRef.current = Date.now()
    setEditText(initialValue)
    editHistoryRef.current = { past: [], future: [] }
    pendingInputSnapshotRef.current = null
    compositionStartSnapshotRef.current = null
    isComposingRef.current = false
    editSessionClosedRef.current = false

    // Seed content once on enter-edit.
    focusEditorCaretRef.current({
      selectAll,
      value: initialValue,
      seedContent: true,
    })

    const restoreIfBlurred = () => {
      if (!wasEditingRef.current || editSessionClosedRef.current) return
      const input = inputRef.current
      if (!input) return
      // If focus held, do not clobber caret while the user is already typing.
      if (document.activeElement === input) return
      // Recover focus only. If a live selection still sits inside the editor,
      // keep it — never force the caret to the end after the user moved it.
      const selection = window.getSelection()
      const selectionInside =
        Boolean(selection?.anchorNode) &&
        input.contains(selection!.anchorNode) &&
        Boolean(selection?.focusNode) &&
        input.contains(selection!.focusNode)
      if (selectionInside) {
        input.focus({ preventScroll: true })
        return
      }
      focusEditorCaretRef.current({ selectAll })
    }

    const timers: number[] = []
    for (const delay of EDIT_FOCUS_RETRY_DELAYS_MS) {
      timers.push(window.setTimeout(restoreIfBlurred, delay))
    }

    let nestedRaf = 0
    const rafId = requestAnimationFrame(() => {
      restoreIfBlurred()
      nestedRaf = requestAnimationFrame(restoreIfBlurred)
    })

    return () => {
      cancelAnimationFrame(rafId)
      cancelAnimationFrame(nestedRaf)
      for (const timer of timers) window.clearTimeout(timer)
    }
    // nodeData.editText / label / selectEditText are read only when isEditing flips true.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enter-edit snapshot
  }, [isEditing])

  // Drop optimistic local edit once the host confirms or ends the session.
  // Do not clear while optimisticEditPendingRef is set — that would wipe the
  // same frame's double-click before beginEditing propagates editing=true.
  useLayoutEffect(() => {
    if (!editingIsControlled) return
    if (nodeData.editing) {
      optimisticEditPendingRef.current = false
      return
    }
    if (optimisticEditPendingRef.current) return
    setLocalEdit(false)
  }, [editingIsControlled, nodeData.editing])

  const startEdit = useCallback(
    (event?: MouseEvent) => {
      if (readonly) return
      event?.preventDefault()
      event?.stopPropagation()
      // Clear native word-selection from double-click on yellow emphasis spans.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) selection.removeAllRanges()
      dispatchGlobalFeedback('node_edit_start', {
        point: getMouseFeedbackPoint(event),
        origin: 'node',
      })
      editStartedAtRef.current = Date.now()
      // Always optimistic: controlled path also flips local until parent editing=true.
      optimisticEditPendingRef.current = true
      setLocalEdit(true)
      setEditText(resolveNodeRawText(nodeData))
      nodeData.onStartEdit?.(id)
    },
    [id, nodeData, readonly],
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
        focusEditorCaret()
      })
      return
    }
    if (Date.now() - editStartedAtRef.current < EDIT_BLUR_GUARD_MS) {
      // Toolbar / layout blur right after enter-edit: refocus without clobbering a
      // caret/selection the user already moved (e.g. selecting prefix to delete).
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (!input || editSessionClosedRef.current) return
        if (document.activeElement === input) return
        const selection = window.getSelection()
        const selectionInside =
          Boolean(selection?.anchorNode) &&
          input.contains(selection!.anchorNode) &&
          Boolean(selection?.focusNode) &&
          input.contains(selection!.focusNode)
        if (selectionInside) {
          input.focus({ preventScroll: true })
          return
        }
        focusEditorCaret({
          selectAll: Boolean(nodeData.selectEditText),
          value: editValue,
          seedContent: !(input.textContent || input.innerHTML),
        })
      })
      return
    }
    editSessionClosedRef.current = true
    optimisticEditPendingRef.current = false
    const input = inputRef.current
    const committed = input ? serializeContentEditable(input) : editValue
    const trimmed = committed.trim()
    if (trimmed) {
      dispatchGlobalFeedback('text_commit', {
        point: getElementFeedbackPoint(inputRef.current),
        origin: 'keyboard',
      })
      nodeData.onFinishEdit?.(id, trimmed)
    } else {
      // Empty editor after a failed seed must not cancel when we still have draft text.
      const fallback = (editValue || resolveNodeRawText(nodeData)).trim()
      if (fallback) {
        nodeData.onFinishEdit?.(id, fallback)
      } else {
        nodeData.onCancelEdit?.(id)
      }
    }
    setLocalEdit(false)
  }, [editValue, extract, focusEditorCaret, id, nodeData])

  const updateEditValue = useCallback(
    (nextValue: string) => {
      setEditText(nextValue)
      nodeData.onEditTextChange?.(id, nextValue)
    },
    [id, nodeData],
  )

  const readEditorSnapshot = useCallback((): EditSnapshot => {
    const input = inputRef.current
    const value = input ? serializeContentEditable(input) : editValue
    return {
      value,
      selectionStart: 0,
      selectionEnd: 0,
    }
  }, [editValue])

  const handleToggleHighlight = useCallback(() => {
    const input = inputRef.current
    if (!input || isComposingRef.current) return
    const before = serializeContentEditable(input)
    if (!toggleHighlightOnDomSelection(input)) return
    const after = serializeContentEditable(input)
    if (before !== after) {
      editHistoryRef.current.past.push({ value: before, selectionStart: 0, selectionEnd: 0 })
      editHistoryRef.current.future = []
      updateEditValue(after)
      requestAnimationFrame(resizeEditor)
    }
    extract.syncTextSelection(input)
  }, [extract, resizeEditor, updateEditValue])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const primaryModifier = event.ctrlKey || event.metaKey
      const lowerKey = event.key.toLowerCase()
      if (primaryModifier && (lowerKey === 'z' || lowerKey === 'y')) {
        event.preventDefault()
        event.stopPropagation()
        const history = editHistoryRef.current
        const currentSnapshot = readEditorSnapshot()
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
        optimisticEditPendingRef.current = false
        setLocalEdit(false)
        setEditText(resolveNodeRawText(nodeData))
        nodeData.onCancelEdit?.(id)
        return
      }
      if (
        event.key === 'Tab' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        // Keep Tab inside the card editor (do not steal for structure shortcuts).
        event.preventDefault()
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertText', false, '\t')
        } else {
          const selection = window.getSelection()
          if (selection && selection.rangeCount > 0) {
            selection.getRangeAt(0).insertNode(document.createTextNode('\t'))
            selection.collapseToEnd()
          }
          const input = inputRef.current
          if (input) {
            updateEditValue(serializeContentEditable(input))
          }
        }
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
    [id, nodeData, readEditorSnapshot, restoreEditSnapshot, updateEditValue],
  )

  const handleBeforeInput = useCallback(() => {
    const input = inputRef.current
    if (!input || isComposingRef.current) return
    pendingInputSnapshotRef.current = readEditorSnapshot()
  }, [readEditorSnapshot])

  const handleInput = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const nextValue = serializeContentEditable(input)
    if (!isComposingRef.current) {
      const snapshot = pendingInputSnapshotRef.current ?? { value: editValue, selectionStart: 0, selectionEnd: 0 }
      if (snapshot.value !== nextValue) {
        editHistoryRef.current.past.push(snapshot)
        editHistoryRef.current.future = []
      }
      pendingInputSnapshotRef.current = null
    }
    updateEditValue(nextValue)
    requestAnimationFrame(resizeEditor)
    extract.syncTextSelection(input)
  }, [editValue, extract, resizeEditor, updateEditValue])

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
    compositionStartSnapshotRef.current = readEditorSnapshot()
  }, [readEditorSnapshot])

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false
    const input = inputRef.current
    if (!input) return
    const nextValue = serializeContentEditable(input)
    const snapshot = compositionStartSnapshotRef.current
    compositionStartSnapshotRef.current = null
    if (snapshot && snapshot.value !== nextValue) {
      editHistoryRef.current.past.push(snapshot)
      editHistoryRef.current.future = []
    }
    updateEditValue(nextValue)
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
    // Idle editable text: text cursor + select-none so yellow-emphasis double-click
    // enters edit instead of native word-select / RF drag contention.
    readonly ? 'cursor-default' : 'cursor-text',
    concealed ? 'blur-[3px]' : '',
    concealed || !readonly ? 'select-none' : '',
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
  // getNodeSize already includes a safety margin so short CJK labels do not wrap early.
  const EDIT_BORDER_EXTRA_PX = 3
  const shellWidth = isEditing ? nodeSize.width + EDIT_BORDER_EXTRA_PX : nodeSize.width

  return (
    <div
      ref={shellRef}
      onDoubleClick={handleDoubleClick}
      onPointerDown={longPress.handlePointerDown}
      onPointerMove={longPress.handlePointerMove}
      onPointerUp={longPress.finishPointerInteraction}
      onPointerCancel={longPress.finishPointerInteraction}
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
      {longPress.longPressPending ? (
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
          {extract.textSelection ? (
            <div className="nodrag nopan absolute -top-10 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-amber-300 bg-white px-1.5 py-1 shadow-md">
              <button
                type="button"
                aria-label="黄色底色"
                title="黄色底色（再点取消）"
                className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-100 px-2.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
                onMouseDown={(event) => {
                  // Keep contentEditable focused.
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleToggleHighlight()
                }}
              >
                <Highlighter className="size-3.5" />
                黄色底色
              </button>
            </div>
          ) : null}
          <div
            ref={inputRef}
            role="textbox"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onBeforeInput={handleBeforeInput}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            onKeyUp={(event) => extract.syncTextSelection(event.currentTarget)}
            onMouseUp={(event) => extract.syncTextSelection(event.currentTarget)}
            onBlur={commitEdit}
            aria-label="编辑节点文本"
            data-node-mode="editing"
            className={[
              'nodrag nopan nowheel box-border block w-full overflow-hidden rounded-xl border-[2.5px] border-sky-500 bg-sky-50/90 text-zinc-900 outline-none ring-4 ring-sky-400/30 shadow-[0_0_0_1px_rgba(14,165,233,0.25)]',
              '[&_[data-emphasis=highlight]]:rounded-sm [&_[data-emphasis=highlight]]:bg-[#fef08c]',
              paddingCls,
              editorTextCls,
            ].join(' ')}
            style={{
              height: nodeSize.height,
              minHeight: nodeSize.height,
              width: '100%',
              maxWidth: '100%',
              scrollbarWidth: 'none',
            }}
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
          <NodeCardStatusChrome
            visual={visual}
            isRoot={isRoot}
            nodeId={id}
            onCountBadgeClick={nodeData.onCountBadgeClick}
          />
          <NodeCardTextFace
            textCls={textCls}
            displayHtml={displayHtml}
            concealed={concealed}
            label={nodeData.label}
            isRoot={isRoot}
            onClick={longPress.handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={longPress.handleContextMenu}
          />
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

export default MindMapNodeCard
