import type { MouseEvent } from 'react'
import type { MindMapNode } from './adapter'
import type { NodeSize } from './layout'
import type {
  SelectionToolbarAction,
  SelectionToolbarPreferPosition,
} from './selectionToolbar'

export type NodeCardData = MindMapNode & {
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
  onCountBadgeClick?: (nodeId: string, kind?: 'objective' | 'subjective') => void
  onToggleCollapse?: (nodeId: string) => void
  /** Expand this node and all descendants (multi-level). */
  onExpandSubtree?: (nodeId: string) => void
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
  /**
   * Host-owned English interaction mode: clickable words + long-press selection.
   * Canvas stays free of dictionary/API details; host supplies the word handler.
   */
  englishInteractionActive?: boolean
  onEnglishWordClick?: (word: string, event: MouseEvent<HTMLElement>) => void
  /** Host text-selection / copy mode: native select, no card click. */
  textSelectionModeActive?: boolean
}

export const MEASURE_DELTA_PX = 1
/**
 * Fallback window when the browser never fires `dblclick` (select-none text,
 * especially yellow emphasis). Matches the common Windows default.
 */
export const CARD_DOUBLE_CLICK_MS = 500

const lastCardClickAt = new Map<string, number>()

/**
 * True when this click is the second press of a double-click on the same card.
 * Module-scoped so a select re-render that remounts yellow-emphasis markup
 * cannot drop the gesture.
 */
export function consumeCardDoubleClick(nodeId: string, now = Date.now()): boolean {
  const previous = lastCardClickAt.get(nodeId)
  lastCardClickAt.set(nodeId, now)
  if (previous == null) return false
  const delta = now - previous
  if (delta >= 0 && delta <= CARD_DOUBLE_CLICK_MS) {
    lastCardClickAt.delete(nodeId)
    return true
  }
  return false
}

/** Test isolation: click timestamps must not leak across card mounts. */
export function resetCardDoubleClickTracking() {
  lastCardClickAt.clear()
}
export const LONG_PRESS_DELAY_MS = 550
export const LONG_PRESS_MOVE_TOLERANCE_PX = 18
export const SYNTHETIC_CONTEXT_MENU_WINDOW_MS = 1_000
/** Ignore blur right after entering edit (layout/toolbar teardown can steal focus). */
export const EDIT_BLUR_GUARD_MS = 180
/** Retry focus after enter-edit; RF toolbar teardown / layout can steal it once. */
export const EDIT_FOCUS_RETRY_DELAYS_MS = [0, 16, 50, 120] as const

export interface EditSnapshot {
  value: string
  selectionStart: number
  selectionEnd: number
}

export function placeContentEditableCaret(
  input: HTMLElement,
  options: { selectAll: boolean; plainOffset?: number | null },
) {
  input.focus({ preventScroll: true })
  const selection = window.getSelection()
  if (!selection) return
  try {
    if (
      !options.selectAll
      && options.plainOffset != null
      && options.plainOffset >= 0
      && placePlainTextOffset(input, options.plainOffset, selection)
    ) {
      return
    }
    const range = document.createRange()
    range.selectNodeContents(input)
    if (!options.selectAll) {
      range.collapse(false)
    }
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // Ignore when the node unmounts mid-focus.
  }
}

function placePlainTextOffset(root: HTMLElement, offset: number, selection: Selection): boolean {
  const placed = textPointAtPlainOffset(root, offset)
  if (!placed) return false
  const range = root.ownerDocument.createRange()
  range.setStart(placed.node, placed.offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

function textPointAtPlainOffset(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let current = walker.nextNode()
  let last: Text | null = null
  while (current) {
    const text = current as Text
    const length = text.textContent?.length ?? 0
    if (remaining <= length) {
      return { node: text, offset: remaining }
    }
    remaining -= length
    last = text
    current = walker.nextNode()
  }
  if (!last) return null
  return { node: last, offset: last.textContent?.length ?? 0 }
}

/**
 * Plain-text offset under a screen point, measured the same way the editor
 * caret is placed (text nodes only). Returns null when the point is not in
 * this card's text, so enter-edit can fall back to the end.
 */
export function plainTextOffsetFromPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null
    caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  const range = doc.caretRangeFromPoint?.(x, y)
  if (range) {
    node = range.startContainer
    offset = range.startOffset
  } else {
    const position = doc.caretPositionFromPoint?.(x, y)
    if (!position) return null
    node = position.offsetNode
    offset = position.offset
  }
  if (!node || !root.contains(node)) return null
  if (node.nodeType !== Node.TEXT_NODE) {
    const child = node.childNodes[offset] ?? node
    const text = child.nodeType === Node.TEXT_NODE ? child : child.firstChild
    if (!text || text.nodeType !== Node.TEXT_NODE || !root.contains(text)) return null
    node = text
    offset = 0
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + Math.min(offset, current.textContent?.length ?? 0)
    total += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  return null
}

export function resolveNodeRawText(nodeData: NodeCardData) {
  const metadata = nodeData.metadata ?? {}
  if (typeof metadata.text === 'string' && metadata.text) return metadata.text
  if (typeof nodeData.editText === 'string') return nodeData.editText
  return nodeData.label || ''
}

export function getMouseFeedbackPoint(event?: { clientX?: number; clientY?: number }) {
  return event && typeof event.clientX === 'number' && typeof event.clientY === 'number'
    ? {
        x: event.clientX,
        y: event.clientY,
      }
    : undefined
}

/** Display/edit text classes shared by NodeCard (English-safe wrapping). */
export function buildNodeCardTextClassNames(options: {
  isRoot: boolean
  depth: number
  readonly: boolean
  concealed: boolean
  englishInteractionActive: boolean
  textSelectionModeActive?: boolean
  mode: 'display' | 'edit'
}): string {
  // Font size / line-height / weight / alignment are identical in every mode
  // (display, edit, english, text-select, concealed) so switching never re-wraps.
  // Keep in sync with getBaseNodeSize in layout.ts.
  const wrap = 'break-words whitespace-pre-wrap'
  const nativeTextSelect = options.englishInteractionActive || Boolean(options.textSelectionModeActive)
  const typography = options.isRoot
    ? 'text-[16px] font-extrabold leading-[25px] text-center text-paper-ink'
    : options.depth === 1
      ? 'text-[14.5px] font-bold leading-[22px] text-left text-paper-ink'
      : 'text-[13.5px] font-medium leading-[21px] text-left text-paper-ink-soft'
  const shared = ['mindmap-node-type', typography, wrap]
  if (options.mode === 'edit') return shared.join(' ')
  return [
    'w-full appearance-none border-0 bg-transparent p-0',
    ...shared,
    nativeTextSelect ? 'cursor-text select-text' : options.readonly ? 'cursor-default' : 'cursor-text',
    !nativeTextSelect && (options.concealed || !options.readonly) ? 'select-none' : '',
  ].filter(Boolean).join(' ')
}

export function buildNodeCardContainerClassNames(options: {
  isRoot: boolean
  markFill: string | null
  selectedCls: string
  dropHighlightCls: string
  previewAdopt: boolean
  placeholder: boolean
  concealed?: boolean
  outlineTones: Set<string>
}): string {
  return [
    'mindmap-node-card flex items-center rounded-[14px] border',
    options.markFill ? '' : options.isRoot ? 'mindmap-node-card--root' : 'bg-paper-card',
    options.concealed && !options.isRoot ? 'mindmap-node-card--concealed' : '',
    options.isRoot ? 'border-paper-line-strong justify-center' : 'border-paper-line',
    options.selectedCls,
    options.dropHighlightCls,
    options.previewAdopt ? 'ring-1 ring-primary/40' : '',
    options.placeholder ? 'ring-2 ring-primary/35' : '',
    options.outlineTones.has('danger') ? 'outline outline-2 outline-destructive/55' : '',
    options.outlineTones.has('info') ? 'outline outline-2 outline-rate-easy/70' : '',
  ].filter(Boolean).join(' ')
}

export function getElementFeedbackPoint(element: HTMLElement | null) {
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}
