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
  onCountBadgeClick?: (nodeId: string) => void
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
}

export const MEASURE_DELTA_PX = 1
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
  options: { selectAll: boolean },
) {
  input.focus({ preventScroll: true })
  const selection = window.getSelection()
  if (!selection) return
  try {
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

export function resolveNodeRawText(nodeData: NodeCardData) {
  const metadata = nodeData.metadata ?? {}
  if (typeof metadata.text === 'string' && metadata.text) return metadata.text
  if (typeof nodeData.editText === 'string') return nodeData.editText
  return nodeData.label || ''
}

export function getMouseFeedbackPoint(event?: MouseEvent) {
  return event
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
  mode: 'display' | 'edit'
}): string {
  const wrap = 'break-words whitespace-pre-wrap'
  const size = options.isRoot
    ? 'text-[14px] font-semibold leading-5'
    : options.depth === 1
      ? 'text-[13px] font-medium leading-[17px]'
      : 'text-[12.5px] font-normal leading-[17px]'
  if (options.mode === 'edit') {
    return [options.isRoot ? 'text-center' : 'text-left', size, wrap].join(' ')
  }
  return [
    'w-full appearance-none border-0 bg-transparent p-0',
    wrap,
    options.englishInteractionActive ? 'cursor-text select-text' : options.readonly ? 'cursor-default' : 'cursor-text',
    options.concealed ? 'blur-[3px]' : '',
    !options.englishInteractionActive && (options.concealed || !options.readonly) ? 'select-none' : '',
    options.isRoot ? `${size} text-zinc-900 text-center` : `text-left ${size}`,
    !options.isRoot && options.depth === 1 ? 'text-zinc-800' : '',
    !options.isRoot && options.depth !== 1 ? 'text-zinc-700' : '',
  ].filter(Boolean).join(' ')
}

export function buildNodeCardContainerClassNames(options: {
  isRoot: boolean
  markFill: string | null
  selectedCls: string
  dropHighlightCls: string
  previewAdopt: boolean
  placeholder: boolean
  outlineTones: Set<string>
}): string {
  return [
    'flex items-center rounded-xl border',
    options.markFill ? '' : 'bg-white',
    'transition-[box-shadow,opacity,transform,background-color,border-color] duration-100',
    options.isRoot ? 'border-zinc-300 shadow-sm justify-center' : 'border-zinc-200 shadow-sm',
    options.selectedCls,
    options.dropHighlightCls,
    options.previewAdopt ? 'ring-1 ring-blue-400/40' : '',
    options.placeholder ? 'ring-2 ring-amber-400/35' : '',
    options.outlineTones.has('danger') ? 'outline outline-2 outline-rose-400/55' : '',
    options.outlineTones.has('info') ? 'outline outline-2 outline-sky-400/70' : '',
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
