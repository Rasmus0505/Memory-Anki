import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNode } from './adapter'
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
  readonly?: boolean
  muted?: boolean
  revealState?: 'hidden' | 'placeholder' | 'revealed'
  segmentColor?: string | null
  activeSegment?: boolean
  focusMarked?: boolean
  miniPalaceSelected?: boolean
  onStartEdit?: (nodeId: string) => void
  onFinishEdit?: (nodeId: string, text: string) => void
  onAddChild?: (nodeId: string) => void
  onDelete?: (nodeId: string) => void
  onMeasure?: (nodeId: string, size: NodeSize) => void
}

const MEASURE_DELTA_PX = 1

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
  const nodeSize = getNodeSize(layoutRole, nodeData.label)
  const [localEdit, setLocalEdit] = useState(false)
  const [editText, setEditText] = useState(nodeData.label)
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastMeasuredRef = useRef<NodeSize | null>(null)
  const isEditing = localEdit || nodeData.editing
  const readonly = Boolean(nodeData.readonly)
  const onMeasure = nodeData.onMeasure

  const metadataRevealState = metadata.revealState
  const revealState =
    nodeData.revealState ??
    (metadataRevealState === 'hidden' ||
    metadataRevealState === 'placeholder' ||
    metadataRevealState === 'revealed'
      ? metadataRevealState
      : undefined)
  const hiddenForRecall = revealState === 'hidden'
  const placeholderForRecall = revealState === 'placeholder'
  const segmentColor =
    typeof nodeData.segmentColor === 'string'
      ? nodeData.segmentColor
      : typeof metadata.segmentColor === 'string'
        ? metadata.segmentColor
        : null
  const focusMarked = Boolean(nodeData.focusMarked ?? metadata.focusMarked)
  const miniPalaceSelected = Boolean(
    nodeData.miniPalaceSelected ?? metadata.miniPalaceSelected,
  )
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
    },
    [id, onMeasure],
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

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
    }
  }, [isEditing])

  const startEdit = useCallback(
    (event?: MouseEvent) => {
      if (readonly) return
      event?.stopPropagation()
      dispatchGlobalFeedback('node_edit_start', {
        point: getMouseFeedbackPoint(event),
        origin: 'node',
      })
      setLocalEdit(true)
      setEditText(nodeData.label)
      nodeData.onStartEdit?.(id)
    },
    [id, nodeData, readonly],
  )

  const handleDoubleClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()
      startEdit(event)
    },
    [startEdit],
  )

  const commitEdit = useCallback(() => {
    if (editText.trim()) {
      dispatchGlobalFeedback('text_commit', {
        point: getElementFeedbackPoint(inputRef.current),
        origin: 'keyboard',
      })
      nodeData.onFinishEdit?.(id, editText.trim())
    }
    setLocalEdit(false)
  }, [editText, id, nodeData])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        setLocalEdit(false)
        setEditText(nodeData.label)
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
    [nodeData.label],
  )

  const handleInput = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(event.target.value)
    event.target.style.height = 'auto'
    event.target.style.height = `${event.target.scrollHeight}px`
  }, [])

  const dropHighlightCls = nodeData.dropHighlight
    ? dropMode === 'inside'
      ? 'ring-2 ring-emerald-400/70 bg-emerald-50/20'
      : 'ring-2 ring-blue-400/60'
    : ''

  const containerCls = [
    'flex items-center rounded-xl border bg-white',
    'transition-[box-shadow,opacity,transform] duration-100',
    isRoot ? 'border-zinc-300 shadow-sm justify-center' : 'border-zinc-200 shadow-sm',
    nodeData.selected ? 'ring-2 ring-zinc-800/30' : '',
    dropHighlightCls,
    previewAdopt ? 'ring-1 ring-blue-400/40' : '',
    placeholderForRecall ? 'ring-2 ring-amber-400/35' : '',
    focusMarked ? 'outline outline-2 outline-rose-400/55' : '',
    miniPalaceSelected ? 'outline outline-2 outline-sky-400/70' : '',
  ].filter(Boolean).join(' ')

  const textCls = [
    'w-full appearance-none border-0 bg-transparent p-0 break-words whitespace-pre-wrap',
    readonly ? 'cursor-default' : 'cursor-text',
    hiddenForRecall ? 'blur-[3px] select-none' : '',
    isRoot
      ? 'text-[14px] font-semibold leading-5 text-zinc-900 text-center'
      : depth === 1
        ? 'text-left text-[13px] font-medium leading-[17px] text-zinc-800'
        : 'text-left text-[12.5px] font-normal leading-[17px] text-zinc-700',
  ].filter(Boolean).join(' ')

  const paddingCls = isRoot ? 'px-4 py-2.5' : depth === 1 ? 'px-3 py-2' : 'px-2.5 py-1.5'
  const borderStyle = segmentColor ? { borderColor: segmentColor } : undefined

  return (
    <div
      ref={shellRef}
      onDoubleClick={handleDoubleClick}
      className={[
        'relative transition-[opacity,transform] duration-100',
        previewShifted ? 'translate-y-2' : '',
        previewGhost ? 'opacity-35 scale-[0.97]' : '',
        nodeData.muted && !previewGhost ? 'opacity-60' : '',
      ].filter(Boolean).join(' ')}
      style={{ width: nodeSize.width }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />

      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          aria-label="编辑节点文本"
          className="min-h-[30px] w-full resize-none rounded-xl border border-zinc-300 bg-white px-2.5 py-2 text-sm leading-5 text-zinc-900 outline-none ring-0"
          style={{ minHeight: nodeSize.height }}
          rows={1}
        />
      ) : (
        <div
          className={`${containerCls} ${paddingCls}`}
          style={{ minHeight: nodeSize.height, ...borderStyle }}
        >
          <button
            type="button"
            onClick={readonly ? undefined : startEdit}
            className={textCls}
          >
            {hiddenForRecall
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
