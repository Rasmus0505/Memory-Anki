import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Plus, X } from 'lucide-react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNode } from './adapter'
import { getNodeSize, type LayoutRole } from './layout'
import { BRANCH_COLORS } from './branchColors'

type NodeCardData = MindMapNode & {
  depth?: number
  selected?: boolean
  dropHighlight?: boolean
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
}

function getMouseFeedbackPoint(event?: React.MouseEvent) {
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
  const depth = Number(nodeData.metadata?.depth ?? 0)
  const branchColor = String(nodeData.metadata?.branchColor ?? BRANCH_COLORS[depth % BRANCH_COLORS.length])
  const layoutRole = String(nodeData.metadata?.layoutRole ?? (depth === 0 ? 'root' : 'branch')) as LayoutRole
  const isRoot = layoutRole === 'root'
  const isLeaf = layoutRole === 'leaf'
  const nodeSize = getNodeSize(layoutRole, nodeData.label)
  const [localEdit, setLocalEdit] = useState(false)
  const [editText, setEditText] = useState(nodeData.label)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isEditing = localEdit || nodeData.editing
  const readonly = Boolean(nodeData.readonly)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
    }
  }, [isEditing])

  const startEdit = useCallback((e?: React.MouseEvent) => {
    if (readonly) return
    e?.stopPropagation()
    dispatchGlobalFeedback('node_edit_start', {
      point: getMouseFeedbackPoint(e),
      origin: 'node',
    })
    setLocalEdit(true)
    setEditText(nodeData.label)
    nodeData.onStartEdit?.(id)
  }, [id, nodeData, readonly])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    startEdit(e)
  }, [startEdit])

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setLocalEdit(false)
      setEditText(nodeData.label)
    }
  }, [nodeData.label])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }, [])

  const btnClass = 'flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-500 shadow-sm transition-colors hover:text-zinc-950'
  const previewShifted = Boolean(nodeData.previewShifted)
  const previewAdopt = Boolean(nodeData.previewAdopt)
  const previewGhost = Boolean(nodeData.previewGhost)
  const isPrimaryBranch = !isRoot && depth === 1
  const revealState = nodeData.revealState
  const hiddenForRecall = revealState === 'hidden'
  const placeholderForRecall = revealState === 'placeholder'
  const segmentColor = typeof nodeData.segmentColor === 'string' ? nodeData.segmentColor : null
  const focusMarked = Boolean(nodeData.focusMarked)
  const miniPalaceSelected = Boolean(nodeData.miniPalaceSelected)

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={`group relative transition-[opacity,transform] duration-100 ${nodeData.dropHighlight ? 'scale-[1.01]' : ''} ${previewShifted ? 'translate-y-1' : ''} ${previewGhost || nodeData.muted ? 'opacity-82' : ''}`}
      style={{ width: nodeSize.width }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0" />

      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          className="min-h-[42px] w-full resize-none rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-950 outline-none ring-0"
          style={{ minHeight: nodeSize.height }}
          rows={1}
        />
      ) : (
        isRoot ? (
          <div
            className={`flex items-center rounded-lg px-4 py-2 shadow-[0_18px_34px_rgba(24,24,27,0.28)] transition-[box-shadow] ${nodeData.selected ? 'ring-4 ring-zinc-950/15' : ''} ${previewAdopt ? 'ring-4 ring-[#2563eb]/20' : ''}`}
            style={{ backgroundColor: '#18181b', minHeight: nodeSize.height }}
          >
            <button
              type="button"
              onClick={readonly ? undefined : startEdit}
              className="w-full break-words whitespace-pre-wrap pr-8 text-center text-[15px] font-semibold leading-5 text-white"
            >
              {nodeData.label || '未命名主题'}
            </button>
          </div>
        ) : (
          <div
            className={`flex flex-col justify-center rounded-lg border px-2 py-1.5 transition-colors ${
              isPrimaryBranch
                ? 'shadow-[0_16px_30px_rgba(24,24,27,0.18)]'
                : 'border-zinc-200 bg-white shadow-[0_12px_22px_rgba(24,24,27,0.08)]'
            } ${nodeData.selected ? 'ring-2 ring-zinc-950/15' : isPrimaryBranch ? '' : 'hover:bg-zinc-50'} ${previewAdopt ? 'ring-1 ring-[#2563eb]/30' : ''} ${placeholderForRecall ? 'ring-2 ring-amber-400/35' : ''} ${focusMarked ? 'outline outline-2 outline-rose-400/55' : ''} ${miniPalaceSelected ? 'outline outline-2 outline-sky-400/70' : ''}`}
            style={{
              minHeight: nodeSize.height,
              ...(isPrimaryBranch ? { backgroundColor: branchColor, borderColor: branchColor } : {}),
              ...(!isPrimaryBranch && segmentColor ? { borderColor: segmentColor } : {}),
            }}
          >
            <button
              type="button"
              onClick={readonly ? undefined : startEdit}
              className={`w-full break-words whitespace-pre-wrap text-left ${
                isPrimaryBranch ? 'text-white' : 'text-zinc-950'
              } ${hiddenForRecall ? 'blur-[3px] select-none' : ''} ${isLeaf ? 'text-[12px] font-medium leading-4' : 'text-[13px] font-semibold leading-4'} pr-8`}
            >
              {hiddenForRecall ? '待回忆' : nodeData.label || '未命名知识点'}
            </button>
            <div
              className="mt-1 h-[2px] rounded-full"
              style={{
                backgroundColor: isPrimaryBranch ? 'rgba(255,255,255,0.72)' : segmentColor ?? branchColor,
                width: isLeaf ? '48px' : '68px',
              }}
            />
            {nodeData.type === 'chapter' && nodeData.metadata?.palace_count !== undefined && !isLeaf ? (
              <div className={`mt-0.5 text-[10px] leading-3 ${isPrimaryBranch ? 'text-white/80' : 'text-zinc-500'}`}>
                {Number(nodeData.metadata.palace_count)} 宫殿
              </div>
            ) : null}
            <div className={`pointer-events-none mt-0.5 truncate text-[9px] uppercase tracking-[0.16em] ${isPrimaryBranch ? 'text-white/55' : 'text-zinc-400'}`}>
              L{depth + 1}
            </div>
          </div>
        )
      )}

      {!readonly ? (
      <div className="absolute right-1 top-1 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            dispatchGlobalFeedback('node_create', {
              point: getMouseFeedbackPoint(e),
              origin: 'node',
            })
            nodeData.onAddChild?.(id)
          }}
          className={btnClass}
          title="添加子知识点"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            dispatchGlobalFeedback('node_delete', {
              point: getMouseFeedbackPoint(e),
              origin: 'node',
            })
            nodeData.onDelete?.(id)
          }}
          className={`${btnClass} hover:bg-destructive/5 hover:text-destructive`}
          title="删除知识点"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      ) : null}

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0" />
    </div>
  )
}

const nodeTypes = { mindmapNode: memo(MindMapNodeCard) }
export { nodeTypes }
export default MindMapNodeCard
