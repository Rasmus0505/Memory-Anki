import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Plus, X } from 'lucide-react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNode } from './adapter'

type NodeCardData = MindMapNode & {
  depth?: number
  selected?: boolean
  dropHighlight?: boolean
  previewShifted?: boolean
  previewAdopt?: boolean
  previewGhost?: boolean
  editing?: boolean
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
  const branchColor = String(nodeData.metadata?.branchColor ?? '#89a89e')
  const layoutRole = String(nodeData.metadata?.layoutRole ?? (depth === 0 ? 'root' : 'branch'))
  const isRoot = layoutRole === 'root'
  const isLeaf = layoutRole === 'leaf'
  const [localEdit, setLocalEdit] = useState(false)
  const [editText, setEditText] = useState(nodeData.label)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isEditing = localEdit || nodeData.editing

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
    }
  }, [isEditing])

  const startEdit = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    dispatchGlobalFeedback('node_edit_start', {
      point: getMouseFeedbackPoint(e),
      origin: 'node',
    })
    setLocalEdit(true)
    setEditText(nodeData.label)
    nodeData.onStartEdit?.(id)
  }, [id, nodeData])

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

  const btnClass = 'flex h-7 w-7 items-center justify-center rounded-xl border border-white/85 bg-white/95 text-slate-500 shadow-sm transition-colors hover:text-slate-900'
  const previewShifted = Boolean(nodeData.previewShifted)
  const previewAdopt = Boolean(nodeData.previewAdopt)
  const previewGhost = Boolean(nodeData.previewGhost)
  const widthClass = isRoot ? 'w-[174px]' : isLeaf ? 'w-[132px]' : 'w-[156px]'

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={`group relative ${widthClass} transition-all duration-150 ${nodeData.dropHighlight ? 'scale-[1.02]' : ''} ${previewShifted ? 'translate-y-1' : ''} ${previewGhost ? 'opacity-82' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0" />

      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          className="min-h-[42px] w-full resize-none rounded-xl border border-primary/30 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none ring-0"
          rows={1}
        />
      ) : (
        isRoot ? (
          <div className={`flex min-h-[54px] items-center rounded-[16px] px-4 py-2 shadow-[0_14px_36px_rgba(201,120,89,0.22)] transition-all ${nodeData.selected ? 'ring-4 ring-[#c97859]/15' : ''} ${previewAdopt ? 'ring-4 ring-blue-200' : ''}`} style={{ backgroundColor: '#c97859' }}>
            <button
              type="button"
              onClick={startEdit}
              className="w-full break-words whitespace-pre-wrap text-center text-[15px] font-semibold leading-5 text-white"
            >
              {nodeData.label || '未命名主题'}
            </button>
          </div>
        ) : (
          <div className={`flex min-h-[52px] flex-col justify-center rounded-xl px-2 py-1.5 transition-colors ${nodeData.selected ? 'bg-slate-900/[0.04]' : 'hover:bg-slate-900/[0.025]'} ${previewAdopt ? 'bg-blue-50/80 ring-1 ring-blue-200' : ''}`}>
            <button
              type="button"
              onClick={startEdit}
              className={`w-full break-words whitespace-pre-wrap text-left text-slate-700 ${isLeaf ? 'text-[12px] font-medium leading-4' : 'text-[13px] font-medium leading-4'}`}
            >
              {nodeData.label || '未命名节点'}
            </button>
            <div className="mt-1 h-[2px] rounded-full" style={{ backgroundColor: branchColor, width: isLeaf ? '48px' : '68px' }} />
            {nodeData.type === 'chapter' && nodeData.metadata?.palace_count !== undefined && !isLeaf ? (
              <div className="mt-0.5 text-[10px] leading-3 text-slate-400">
                {Number(nodeData.metadata.palace_count)} 宫殿
              </div>
            ) : null}
            <div className="pointer-events-none mt-0.5 truncate text-[9px] uppercase tracking-[0.16em] text-slate-300">
              L{depth + 1}
            </div>
          </div>
        )
      )}

      <div className={`absolute flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${isRoot ? '-right-2 -top-2' : '-right-2 -top-1'}`}>
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
          title="添加子节点"
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
          className={`${btnClass} hover:bg-rose-50 hover:text-rose-600`}
          title="删除节点"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0" />
    </div>
  )
}

const nodeTypes = { mindmapNode: memo(MindMapNodeCard) }
export { nodeTypes }
export default MindMapNodeCard
