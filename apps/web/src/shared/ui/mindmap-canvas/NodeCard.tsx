import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
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
import { getNodeSize, type LayoutRole } from './layout'
import {
  AdaptiveNodeToolbar,
  selectionToolbarButtonClass,
} from './NodeCardToolbar'
import { NodeCardStatusChrome, NodeCardTextFace } from './NodeCardChrome'
import { NodeCardCollapseToggle } from './NodeCardCollapseToggle'
import { ExtractDropPlaceholders, ExtractGhostPortal } from './MindMapExtractUi'
import { useMindMapExtractDrag } from './useMindMapExtractDrag'
import { useNodeCardEditHistory } from './useNodeCardEditHistory'
import { useNodeCardMeasure } from './useNodeCardMeasure'
import {
  EDIT_BLUR_GUARD_MS,
  consumeCardDoubleClick,
  getElementFeedbackPoint,
  getMouseFeedbackPoint,
  placeContentEditableCaret,
  plainTextOffsetFromPoint,
  buildNodeCardContainerClassNames,
  buildNodeCardTextClassNames,
  resolveNodeRawText,
  type NodeCardData,
} from './nodeCardModel'
import { noteCardEditStarted } from './cardEditGesture'
import { useCardEditGesture } from './useCardEditGesture'
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
  const [imeComposing, setImeComposing] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const editingIsControlled = typeof nodeData.editing === 'boolean'
  // Parent `editing` is authoritative when true; localEdit covers optimistic enter
  // and uncontrolled cards so a lagging host cannot drop the first double-click.
  const isEditing = editingIsControlled
    ? Boolean(nodeData.editing) || localEdit
    : localEdit
  const editValue = editText
  const readonly = Boolean(nodeData.readonly)
  const wasEditingRef = useRef(false)
  /** Edit sessions may grow, but deleting must not shrink the shell until commit. */
  const editWidthFloorRef = useRef(0)
  const editSessionOpenRef = useRef(false)

  const updateEditValue = useCallback(
    (nextValue: string) => {
      setEditText(nextValue)
      nodeData.onEditTextChange?.(id, nextValue)
    },
    [id, nodeData],
  )
  const extract = useMindMapExtractDrag({
    nodeId: id,
    editValue,
    inputRef,
    onExtractSelection: nodeData.onExtractSelection,
    onExtractDropPreview: nodeData.onExtractDropPreview,
  })
  const {
    isComposingRef,
    resetEditHistory,
    recordChange,
    handleUndoRedoKey,
    handleBeforeInput,
    handleInput,
    handleCompositionStart,
    handleCompositionEnd,
  } = useNodeCardEditHistory({
    inputRef,
    editValue,
    updateEditValue,
    syncTextSelection: extract.syncTextSelection,
    onCompositionChange: setImeComposing,
  })

  // Opening frame must size from the text the effect will seed, not a leftover draft.
  const openingEdit = isEditing && !editSessionOpenRef.current
  const draftSource = openingEdit
    ? (typeof nodeData.editText === 'string' ? nodeData.editText : rawNodeText)
    : editValue
  const measureText = stripMindMapHtml(isEditing ? draftSource : plainLabel) || plainLabel
  const fittedSize = getNodeSize(layoutRole, measureText)
  if (!isEditing) {
    editSessionOpenRef.current = false
    editWidthFloorRef.current = 0
  } else if (openingEdit) {
    editSessionOpenRef.current = true
    editWidthFloorRef.current = getNodeSize(layoutRole, plainLabel).width
  }
  const composing = isEditing && (imeComposing || isComposingRef.current)
  if (isEditing && !composing) {
    editWidthFloorRef.current = Math.max(editWidthFloorRef.current, fittedSize.width)
  }
  const nodeSize = isEditing
    ? getNodeSize(
        layoutRole,
        measureText,
        composing
          ? { minWidth: editWidthFloorRef.current, maxWidth: editWidthFloorRef.current }
          : { minWidth: editWidthFloorRef.current },
      )
    : fittedSize
  const editSessionClosedRef = useRef(false)
  const editStartedAtRef = useRef(0)
  /** Collapse click+dblclick of one gesture so edit-start sound does not double-fire. */
  const lastEditGestureAtRef = useRef(0)
  /** True between optimistic startEdit and parent `editing=true` confirmation. */
  const optimisticEditPendingRef = useRef(false)
  /** Plain-text offset under the double-click, applied once the editor mounts. */
  const pendingCaretOffsetRef = useRef<number | null>(null)
  const englishInteractionActive = Boolean(nodeData.englishInteractionActive)
  const textSelectionModeActive = Boolean(nodeData.textSelectionModeActive)
  const textInteractionActive = englishInteractionActive || textSelectionModeActive
  const longPress = useNodeCardLongPress({
    nodeId: id,
    // While contentEditable is open, keep native text selection; long-press is for idle cards.
    // English / text-select modes keep native selection; do not steal the press for hide/menu.
    enabled: !isEditing && !textInteractionActive,
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

  useNodeCardMeasure({ id, shellRef, onMeasure: nodeData.onMeasure })

  const focusEditorCaret = useCallback(
    (options?: { selectAll?: boolean; value?: string; seedContent?: boolean; plainOffset?: number | null }) => {
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
      placeContentEditableCaret(input, {
        selectAll,
        plainOffset: selectAll ? null : options?.plainOffset,
      })
      return document.activeElement === input
    },
    [nodeData.selectEditText],
  )
  const focusEditorCaretRef = useRef(focusEditorCaret)
  focusEditorCaretRef.current = focusEditorCaret

  // Enter-edit only: put caret at end (or select-all for new nodes). Retry because
  // toolbar teardown / React Flow layout can steal focus right after the first attempt.
  // Must NOT re-run placement when draft text / node height changes mid-session —
  // that used to force the caret to the end and cause accidental end deletes.
  // Depends only on isEditing so focusEditorCaret identity churn never
  // cancels enter-edit focus retries or re-places the caret while typing.
  useLayoutEffect(() => {
    if (!isEditing) {
      wasEditingRef.current = false
      isComposingRef.current = false
      pendingCaretOffsetRef.current = null
      setImeComposing(false)
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
    resetEditHistory()
    editSessionClosedRef.current = false

    // Seed content once on enter-edit.
    const plainOffset = selectAll ? null : pendingCaretOffsetRef.current
    focusEditorCaretRef.current({
      selectAll,
      value: initialValue,
      seedContent: true,
      plainOffset,
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
      focusEditorCaretRef.current({ selectAll, plainOffset })
    }

    const rafId = requestAnimationFrame(restoreIfBlurred)

    return () => {
      cancelAnimationFrame(rafId)
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
    (event?: { clientX?: number; clientY?: number; preventDefault?: () => void; stopPropagation?: () => void }) => {
      if (readonly) return
      event?.preventDefault?.()
      event?.stopPropagation?.()
      noteCardEditStarted()
      // Clear native word-selection from double-click on yellow emphasis spans.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) selection.removeAllRanges()
      const face = shellRef.current?.querySelector('.mindmap-node-text')
      pendingCaretOffsetRef.current =
        !nodeData.selectEditText
        && event
        && typeof event.clientX === 'number'
        && typeof event.clientY === 'number'
        && face instanceof HTMLElement
          ? plainTextOffsetFromPoint(face, event.clientX, event.clientY)
          : null
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

  const openFromDoubleClick = useCallback(
    (event: { clientX?: number; clientY?: number; preventDefault?: () => void; stopPropagation?: () => void }) => {
      if (textSelectionModeActive) return
      const now = Date.now()
      if (now - lastEditGestureAtRef.current < 80) {
        event.preventDefault?.()
        event.stopPropagation?.()
        return
      }
      lastEditGestureAtRef.current = now
      event.preventDefault?.()
      event.stopPropagation?.()
      if (readonly) {
        nodeData.onReadonlyDoubleClick?.(id)
        return
      }
      startEdit(event)
    },
    [id, nodeData, readonly, startEdit, textSelectionModeActive],
  )

  const handleDoubleClick = openFromDoubleClick

  const handleShellPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      longPress.handlePointerDown(event)
      // Readonly review flips on every press, including the second press inside
      // the OS double-click window. Swallowing that press is what made rapid
      // flips wait until the paper animation (and the 500ms window) ended.
      if (readonly || textSelectionModeActive || event.ctrlKey || event.metaKey) return
      // Real mouse/pen presses are counted in the capture-phase owner. This
      // bubble path is only for events that omit pointerType (jsdom), which
      // that owner ignores so it cannot steal a touch long-press.
      if (event.pointerType) return
      if (event.detail > 1 || consumeCardDoubleClick(id)) {
        event.preventDefault()
        event.stopPropagation()
        openFromDoubleClick(event)
      }
    },
    [id, longPress, openFromDoubleClick, readonly, textSelectionModeActive],
  )

  const handleShellClick = useCallback(
    (event: MouseEvent) => {
      if (readonly || textSelectionModeActive || event.ctrlKey || event.metaKey || event.detail <= 1) return
      openFromDoubleClick(event)
    },
    [openFromDoubleClick, readonly, textSelectionModeActive],
  )

  useCardEditGesture({
    nodeId: id,
    shellRef,
    // Edit-only. In readonly the capture owner used to stopPropagation on the
    // second press and the flip click never reached the canvas.
    enabled: !readonly && !isEditing && !textSelectionModeActive,
    blockNativeTextSelection: !englishInteractionActive && !textSelectionModeActive && !readonly,
    onSecondPress: (point) => {
      openFromDoubleClick({ clientX: point.x, clientY: point.y })
    },
  })

  const stopTextModeCardClick = useCallback((event: MouseEvent) => {
    // Text-select: swallow RF node click so PWA can keep the system Copy bar.
    event.stopPropagation()
  }, [])

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

  const handleToggleHighlight = useCallback(() => {
    const input = inputRef.current
    if (!input || isComposingRef.current) return
    const before = serializeContentEditable(input)
    if (!toggleHighlightOnDomSelection(input)) return
    const after = serializeContentEditable(input)
    if (before !== after) {
      recordChange(before)
      updateEditValue(after)
    }
    extract.syncTextSelection(input)
  }, [extract, isComposingRef, recordChange, updateEditValue])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (handleUndoRedoKey(event)) return
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
    [handleUndoRedoKey, id, nodeData, updateEditValue],
  )

  const effectiveDropMode = extract.localHoverMode ?? dropMode
  const showDropChrome = Boolean(extract.localHoverMode || nodeData.dropHighlight)
  const dropHighlightCls = showDropChrome
    ? effectiveDropMode === 'inside'
      ? 'ring-2 ring-success/70 bg-success/10'
      : 'ring-2 ring-primary/70 bg-primary-soft/40'
    : ''

  const selectedCls =
    nodeData.selected && !isEditing
      ? 'mindmap-node-card--selected border-primary/70'
      : ''

  const markFill = typeof visual.fillColor === 'string' && visual.fillColor.trim()
    ? visual.fillColor.trim()
    : null
  const containerCls = buildNodeCardContainerClassNames({
    isRoot,
    markFill,
    selectedCls,
    dropHighlightCls,
    previewAdopt,
    placeholder,
    concealed,
    outlineTones,
  })
  const nodeMode = isEditing ? 'editing' : nodeData.selected ? 'selected' : 'idle'
  const canStructureDrag = Boolean(!isEditing && !readonly)
  const textOpts = { isRoot, depth, readonly, concealed, englishInteractionActive, textSelectionModeActive } as const
  const textCls = buildNodeCardTextClassNames({ ...textOpts, mode: 'display' })
  const paddingCls = isRoot ? 'px-4 py-2.5' : depth === 1 ? 'px-3 py-2' : 'px-2.5 py-1.5'
  const editorTextCls = buildNodeCardTextClassNames({ ...textOpts, mode: 'edit' })
  const shellStyle = {
    ...(visual.borderColor ? { borderColor: visual.borderColor } : {}),
    ...(markFill ? { backgroundColor: markFill } : {}),
  }
  const borderStyle = Object.keys(shellStyle).length > 0 ? shellStyle : undefined
  // Editing reuses the display card chrome. Width may grow with the draft, but a
  // delete or an open IME composition must not shrink or jump the shell.
  const shellWidth = nodeSize.width

  return (
    <div
      ref={shellRef}
      onClick={
        textSelectionModeActive
          ? stopTextModeCardClick
          : textInteractionActive
            ? undefined
            : handleShellClick
      }
      onDoubleClick={textSelectionModeActive ? undefined : handleDoubleClick}
      onPointerDown={textSelectionModeActive ? longPress.handlePointerDown : handleShellPointerDown}
      onPointerMove={longPress.handlePointerMove}
      onPointerUp={longPress.finishPointerInteraction}
      onPointerCancel={longPress.finishPointerInteraction}
      data-mindmap-node-id={id}
      data-node-mode={nodeMode}
      className={[
        'mindmap-node-shell group relative',
        canStructureDrag ? 'mindmap-node-drag-surface cursor-grab active:cursor-grabbing' : '',
        previewShifted ? 'translate-y-2' : '',
        previewGhost ? 'opacity-35 scale-[0.97]' : '',
        visual.highlighted ? 'ring-4 ring-warning/45 rounded-2xl' : '',
        visual.muted && !previewGhost ? 'opacity-60' : '',
      ].filter(Boolean).join(' ')}
      style={{
        width: shellWidth,
        // Structure long-press: no iOS callout; English / text-select need native Copy.
        WebkitTouchCallout: textInteractionActive ? 'default' : 'none',
      }}
    >
      {longPress.longPressPending ? (
        <span
          aria-hidden="true"
          className="mindmap-node-longpress-ring pointer-events-none absolute inset-[-4px] z-20 rounded-[17px]"
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
              data-mindmap-card-control="true"
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
        <div
          className={`relative ${containerCls} mindmap-node-card--editing ${paddingCls}`}
          style={{ minHeight: nodeSize.height, ...borderStyle }}
        >
          <ExtractDropPlaceholders mode={effectiveDropMode} visible={showDropChrome} />
          {extract.textSelection ? (
            // w-max + nowrap: absolute shrink-to-fit on a narrow card would otherwise
            // use CJK min-content (1 char wide), wrapping「黄色底色」into a tall oval.
            <div className="nodrag nopan absolute -top-10 left-1/2 z-40 flex w-max max-w-none -translate-x-1/2 items-center gap-1 whitespace-nowrap mindmap-pop-in rounded-full border border-primary/30 bg-paper-card px-1.5 py-1 shadow-lift">
              <button
                type="button"
                aria-label="黄色底色"
                title="黄色底色（再点取消）"
                className="inline-flex h-7 min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary-soft px-2.5 text-xs font-medium text-primary-strong transition-colors hover:bg-primary/20"
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
                <Highlighter className="size-3.5 shrink-0" />
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
              'nodrag nopan nowheel mindmap-node-editor block w-full min-w-0 outline-none',
              editorTextCls,
            ].join(' ')}
          />
          <NodeCardStatusChrome
            visual={visual}
            isRoot={isRoot}
            nodeId={id}
            onCountBadgeClick={nodeData.onCountBadgeClick}
          />
          {extract.showExtractHandle ? (
            <button
              type="button"
              data-extract-handle="true"
              aria-label="拖出选中文字为新卡片"
              title="拖到目标卡片：成为其子节点或同级"
              className="nodrag nopan absolute -right-2 -top-2 z-40 flex h-7 w-7 cursor-grab items-center justify-center mindmap-pop-in rounded-full border border-primary/60 bg-paper-card text-primary-strong shadow-lift active:cursor-grabbing"
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
          {Number(metadata.childCount ?? 0) > 0 && nodeData.onToggleCollapse ? (
            <NodeCardCollapseToggle
              nodeId={id}
              collapsed={Boolean(metadata.collapsed)}
              descendantCount={Number(metadata.collapsedDescendantCount ?? 0)}
              onToggleCollapse={nodeData.onToggleCollapse}
              onExpandSubtree={nodeData.onExpandSubtree}
            />
          ) : null}
          <NodeCardTextFace
            textCls={textCls}
            displayHtml={displayHtml}
            articleBody={metadata.articleBody}
            concealed={concealed}
            label={plainLabel}
            isRoot={isRoot}
            onClick={longPress.handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={longPress.handleContextMenu}
            englishInteractionActive={englishInteractionActive}
            onEnglishWordClick={nodeData.onEnglishWordClick}
            textSelectionModeActive={textSelectionModeActive}
            readonly={readonly}
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
